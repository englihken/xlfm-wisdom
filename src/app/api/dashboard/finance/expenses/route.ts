// src/app/api/dashboard/finance/expenses/route.ts
// GET  ?centre_id=&month= (finance:view, SCOPE-FORCED) — the centre's expenses for a month
//      (voided rows included so the UI can show them struck-through and exclude them from 合计).
// POST (finance:edit, SCOPE-FORCED) — record an expense: spent_at, category (enum), description,
//      amount>0. receipt_path stays NULL in this batch (photo wiring = 025B). Audited.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { financeScope, enforceScope, monthInputToDate, EXPENSE_CATEGORIES } from '@/lib/finance';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXPENSE_SELECT =
  'id, spent_at, category, description, amount, receipt_path, voided_at, void_reason, ' +
  'enterer:volunteers!entered_by ( display_name, email )';

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}
function nextMonthFirst(firstOfMonth: string): string {
  const [y, m] = firstOfMonth.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

export async function GET(req: Request) {
  const access = await requireModuleAccess('finance', 'view');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const scope = await financeScope(supabaseAdmin, access.volunteer.id);
  const enforced = enforceScope(scope, sp.get('centre_id'));
  if (!enforced.ok) return NextResponse.json({ error: enforced.error }, { status: 400 });
  const centreId = enforced.centreId;
  if (!centreId) return NextResponse.json({ error: '请选择中心' }, { status: 400 });

  const monthFirst = monthInputToDate(sp.get('month')) ?? new Date().toISOString().slice(0, 8) + '01';

  const { data, error } = await supabaseAdmin
    .from('expenses')
    .select(EXPENSE_SELECT)
    .eq('centre_id', centreId)
    .gte('spent_at', monthFirst)
    .lt('spent_at', nextMonthFirst(monthFirst))
    .order('spent_at', { ascending: true });
  if (error) {
    console.error('[finance/expenses] list failed:', error);
    return NextResponse.json({ error: 'Failed to load expenses' }, { status: 500 });
  }
  return NextResponse.json({ centreId, month: monthFirst.slice(0, 7), expenses: data ?? [] });
}

export async function POST(req: Request) {
  const access = await requireModuleAccess('finance', 'edit');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const scope = await financeScope(supabaseAdmin, access.volunteer.id);
  const enforced = enforceScope(scope, typeof body.centre_id === 'string' ? body.centre_id : null);
  if (!enforced.ok) return NextResponse.json({ error: enforced.error }, { status: 400 });
  const centreId = enforced.centreId;
  if (!centreId) return NextResponse.json({ error: '请选择中心' }, { status: 400 });

  const spentAt = typeof body.spent_at === 'string' && DATE_RE.test(body.spent_at) ? body.spent_at : '';
  if (!spentAt) return NextResponse.json({ error: '支出日期无效' }, { status: 400 });
  const category = typeof body.category === 'string' ? body.category : '';
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(category)) return NextResponse.json({ error: '类别无效' }, { status: 400 });
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) return NextResponse.json({ error: '请填写说明' }, { status: 400 });
  const amount = Number(body.amount);
  if (!(amount > 0)) return NextResponse.json({ error: '金额须大于 0' }, { status: 400 });

  let receiptPath: string | null = null;
  if (typeof body.receipt_path === 'string' && body.receipt_path.trim()) {
    const p = body.receipt_path.trim();
    if (!/^receipts\/[A-Za-z0-9._-]+$/.test(p)) return NextResponse.json({ error: '单据照片无效' }, { status: 400 });
    receiptPath = p;
  }

  const me = access.volunteer;
  const { data: expense, error: insErr } = await supabaseAdmin
    .from('expenses')
    .insert({ centre_id: centreId, spent_at: spentAt, category, description, amount, receipt_path: receiptPath, entered_by: me.id })
    .select(EXPENSE_SELECT)
    .single();
  if (insErr || !expense) {
    console.error('[finance/expenses] insert failed:', insErr);
    return NextResponse.json({ error: '保存支出失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'create',
    tableName: 'expenses',
    recordId: (expense as unknown as { id: string }).id,
    after: { centre_id: centreId, spent_at: spentAt, category, description, amount },
  });

  return NextResponse.json({ expense }, { status: 201 });
}
