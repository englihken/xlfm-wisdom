// src/app/api/dashboard/finance/mutual-aid/collect/route.ts
// POST — 归集 the month's per-centre surplus into the fund (finance:ADMIN only). Body { month }.
// For every active centre: surplus = non-void payments(paid_at in month) − non-void expenses
// (spent_at in month). Each centre with surplus > 0 AND no existing 'in' row for (month, centre)
// gets one mutual_aid_entries('in', amount=surplus, month, centre_id, description). This is
// IDEMPOTENT — already-collected centres are SKIPPED and reported (归集 is a manual action, may be
// re-run safely). Returns per-centre results. Audited.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { monthInputToDate } from '@/lib/finance';

export const runtime = 'nodejs';

function nextMonthFirst(firstOfMonth: string): string {
  const [y, m] = firstOfMonth.split('-').map(Number);
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
}

export async function POST(req: Request) {
  const access = await requireModuleAccess('finance', 'admin');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const month = monthInputToDate(typeof body?.month === 'string' ? body.month.slice(0, 7) : '');
  if (!month) return NextResponse.json({ error: '月份无效（格式 2026-07）' }, { status: 400 });
  const preview = body?.preview === true; // dry-run: compute surpluses, insert nothing
  const monthEnd = nextMonthFirst(month);

  const { data: centres } = await supabaseAdmin.from('centres').select('id, name_cn').eq('is_active', true);
  const ids = (centres ?? []).map((c) => c.id);
  if (ids.length === 0) return NextResponse.json({ results: [] });

  const [paysRes, expsRes, existingRes] = await Promise.all([
    supabaseAdmin.from('fee_payments').select('centre_id, amount').is('voided_at', null).gte('paid_at', month).lt('paid_at', monthEnd).in('centre_id', ids),
    supabaseAdmin.from('expenses').select('centre_id, amount').is('voided_at', null).gte('spent_at', month).lt('spent_at', monthEnd).in('centre_id', ids),
    supabaseAdmin.from('mutual_aid_entries').select('centre_id').eq('entry_type', 'in').eq('month', month).in('centre_id', ids),
  ]);
  // FAIL CLOSED (security audit H4): a failed guard read must abort the collection —
  // a silently-empty `existing` would re-insert already-collected centres (fund
  // double-count); a silently-empty `exps` would inflate every surplus.
  if (paysRes.error || expsRes.error || existingRes.error) {
    console.error('[finance/mutual-aid/collect] guard read failed:', paysRes.error ?? expsRes.error ?? existingRes.error);
    return NextResponse.json({ error: '归集失败（读取数据出错，请重试）' }, { status: 500 });
  }
  const { data: pays } = paysRes;
  const { data: exps } = expsRes;
  const { data: existing } = existingRes;

  const collected = new Map<string, number>();
  for (const p of (pays ?? []) as { centre_id: string; amount: number }[]) collected.set(p.centre_id, (collected.get(p.centre_id) ?? 0) + Number(p.amount));
  const spent = new Map<string, number>();
  for (const e of (exps ?? []) as { centre_id: string; amount: number }[]) spent.set(e.centre_id, (spent.get(e.centre_id) ?? 0) + Number(e.amount));
  const alreadyDone = new Set((existing ?? []).map((r) => (r as { centre_id: string }).centre_id));

  const me = access.volunteer;
  const results: { centre: string; surplus: number; status: 'collected' | 'skipped' | 'no_surplus' }[] = [];
  const toInsert: Record<string, unknown>[] = [];
  for (const c of centres ?? []) {
    const surplus = Math.round(((collected.get(c.id) ?? 0) - (spent.get(c.id) ?? 0)) * 100) / 100;
    if (alreadyDone.has(c.id)) {
      results.push({ centre: c.name_cn, surplus, status: 'skipped' });
    } else if (surplus > 0) {
      toInsert.push({ entry_type: 'in', amount: surplus, description: `${month.slice(0, 7)} 结余归集 · ${c.name_cn}`, month, centre_id: c.id, created_by: me.id });
      results.push({ centre: c.name_cn, surplus, status: 'collected' });
    } else {
      results.push({ centre: c.name_cn, surplus, status: 'no_surplus' });
    }
  }

  if (preview) {
    return NextResponse.json({ month: month.slice(0, 7), results, collected: toInsert.length, preview: true });
  }

  if (toInsert.length > 0) {
    const { error: insErr } = await supabaseAdmin.from('mutual_aid_entries').insert(toInsert);
    if (insErr) {
      // 23505 = the pending unique (entry_type, month, centre_id) constraint caught a
      // concurrent 归集 for the same month — a safe stop, not a corruption.
      if (insErr.code === '23505') {
        return NextResponse.json({ error: '该月份正被同时归集（并发操作），请刷新后查看结果' }, { status: 409 });
      }
      console.error('[finance/mutual-aid/collect] insert failed:', insErr);
      return NextResponse.json({ error: '归集失败' }, { status: 500 });
    }
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'create',
    tableName: 'mutual_aid_entries',
    recordId: `collect:${month}`,
    after: { month, collected: toInsert.length, total: toInsert.reduce((s, r) => s + Number(r.amount), 0) },
  });

  return NextResponse.json({ month: month.slice(0, 7), results, collected: toInsert.length });
}
