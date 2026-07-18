// src/app/api/dashboard/finance/accounts/[id]/route.ts
// PATCH (finance:edit, SCOPE-FORCED) — edit an account: name, kind, opening_balance,
// opening_as_of, is_active. Record-first scoping: the wall is checked against the
// ROW's centre_id, not a caller-supplied param, so an own_center 财政 cannot reach
// another centre's wallet by guessing its id. centre_id itself is NOT editable —
// moving a wallet between centres would silently re-home its whole transaction
// history. Accounts are never deleted (transactions FK them); deactivate instead.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { financeScope, enforceScope } from '@/lib/finance';
import { isAccountKind, DATE_RE } from '@/lib/finance-cashbook';

export const runtime = 'nodejs';

const ACCOUNT_SELECT = 'id, centre_id, kind, name, opening_balance, opening_as_of, is_active, sort, created_at';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('finance', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { data: existing } = await supabaseAdmin
    .from('finance_accounts')
    .select('id, centre_id, kind, name, opening_balance, opening_as_of, is_active')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: '账户不存在' }, { status: 404 });

  const enforced = enforceScope(financeScope(access.volunteer), existing.centre_id);
  if (!enforced.ok) return NextResponse.json({ error: enforced.error }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: '请填写账户名称' }, { status: 400 });
    patch.name = name;
  }
  if (body.kind !== undefined) {
    if (!isAccountKind(body.kind)) return NextResponse.json({ error: '账户类型无效' }, { status: 400 });
    patch.kind = body.kind;
  }
  if (body.opening_balance !== undefined) {
    const opening = body.opening_balance === '' || body.opening_balance == null ? 0 : Number(body.opening_balance);
    if (!Number.isFinite(opening)) return NextResponse.json({ error: '期初余额无效' }, { status: 400 });
    patch.opening_balance = opening;
  }
  if (body.opening_as_of !== undefined) {
    if (body.opening_as_of === null || body.opening_as_of === '') patch.opening_as_of = null;
    else if (typeof body.opening_as_of === 'string' && DATE_RE.test(body.opening_as_of)) patch.opening_as_of = body.opening_as_of;
    else return NextResponse.json({ error: '期初日期无效' }, { status: 400 });
  }
  if (body.is_active !== undefined) patch.is_active = !!body.is_active;

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '没有要更新的内容' }, { status: 400 });

  const me = access.volunteer;
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('finance_accounts')
    .update(patch)
    .eq('id', id)
    .select(ACCOUNT_SELECT)
    .single();
  if (updErr || !updated) {
    console.error('[finance/accounts] update failed:', updErr);
    return NextResponse.json({ error: '保存账户失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'update',
    tableName: 'finance_accounts',
    recordId: id,
    before: {
      name: existing.name,
      kind: existing.kind,
      opening_balance: existing.opening_balance,
      opening_as_of: existing.opening_as_of,
      is_active: existing.is_active,
    },
    after: patch,
  });

  return NextResponse.json({ account: updated });
}
