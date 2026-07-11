// src/app/api/dashboard/finance/stats/route.ts
// GET ?month= (finance:view, SCOPE-AWARE) — the 财务总览 (D1) aggregates. An own_center 财政 sees
// ONLY their centre. Computed from a bounded, batched set of reads (no per-centre N+1):
//   kpis      — collected (non-void fee_payments in month), expenses (non-void in month),
//               surplus, pledgedCount (active, pledge set, not waived), paidCount (of pledged,
//               non-void coverage max(months_to) >= month start).
//   centres[] — per in-scope centre: collected/expenses/surplus, pause state, receipt-book
//               position, and its 财政 (role=centre_finance, centre_id=this) or 未指派.
//   events[]  — read-only aggregate from the events wing (approved-fee, verified-paid,
//               pending-proof, waived) for recent events.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { financeScope, monthInputToDate } from '@/lib/finance';

export const runtime = 'nodejs';

function nextMonthFirst(firstOfMonth: string): string {
  const [y, m] = firstOfMonth.split('-').map(Number);
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
}

export async function GET(req: Request) {
  const access = await requireModuleAccess('finance', 'view');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const monthFirst = monthInputToDate(sp.get('month')) ?? new Date().toISOString().slice(0, 8) + '01';
  const monthEnd = nextMonthFirst(monthFirst);
  const scope = await financeScope(supabaseAdmin, access.volunteer.id);

  let centreQ = supabaseAdmin.from('centres').select('id, code, name_cn, name_en, state, sort').eq('is_active', true);
  if (scope.locked) {
    if (!scope.centreId) return NextResponse.json({ error: '账号未绑定中心，无法访问财务数据' }, { status: 400 });
    centreQ = centreQ.eq('id', scope.centreId);
  }
  // Order by sort (the same key the overview groups by: state band order = min(sort) in group,
  // rows within a group by sort). name_cn is no longer the ordering key.
  const { data: centres, error: cErr } = await centreQ.order('sort', { ascending: true });
  if (cErr) {
    console.error('[finance/stats] centres failed:', cErr);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
  const ids = (centres ?? []).map((c) => c.id);
  const scopeIn = ids.length ? ids : ['00000000-0000-0000-0000-000000000000'];

  const [membersRes, paysRes, expRes, monthsRes, finRes, eventsRes, booksRes] = await Promise.all([
    supabaseAdmin.from('members').select('id, gyt_centre_id, fee_pledge_amount, fee_waived_from').eq('status', 'active').in('gyt_centre_id', scopeIn),
    supabaseAdmin.from('fee_payments').select('centre_id, member_id, amount, paid_at, months_to').is('voided_at', null).in('centre_id', scopeIn),
    supabaseAdmin.from('expenses').select('centre_id, amount, spent_at').is('voided_at', null).in('centre_id', scopeIn),
    supabaseAdmin.from('centre_finance_months').select('centre_id, collection_paused, paused_note').eq('month', monthFirst).in('centre_id', scopeIn),
    supabaseAdmin.from('volunteers').select('centre_id, display_name').eq('role', 'centre_finance').in('centre_id', scopeIn),
    supabaseAdmin.from('events').select('id, code, title, starts_on').order('starts_on', { ascending: false }).limit(6),
    // Receipt-book position = the highest receipt number ever ISSUED, including voided ones —
    // a number is consumed forever (matches the ledger header + the unique constraint).
    supabaseAdmin.from('fee_payments').select('centre_id, receipt_no').in('centre_id', scopeIn),
  ]);

  const members = membersRes.data ?? [];
  const pays = (paysRes.data ?? []) as { centre_id: string; member_id: string; amount: number; paid_at: string; months_to: string }[];
  const exps = (expRes.data ?? []) as { centre_id: string; amount: number; spent_at: string }[];

  // Per-centre collected/expenses (this month).
  const perCentre = new Map<string, { collected: number; expenses: number }>();
  const ensure = (id: string) => {
    let v = perCentre.get(id);
    if (!v) { v = { collected: 0, expenses: 0 }; perCentre.set(id, v); }
    return v;
  };
  for (const p of pays) {
    if (p.paid_at >= monthFirst && p.paid_at < monthEnd) ensure(p.centre_id).collected += Number(p.amount);
  }
  for (const e of exps) {
    if (e.spent_at >= monthFirst && e.spent_at < monthEnd) ensure(e.centre_id).expenses += Number(e.amount);
  }

  // Receipt-book position over ALL rows (voided included) — a consumed number stays the top.
  const bookAt = new Map<string, { no: string; num: number }>();
  for (const b of (booksRes.data ?? []) as { centre_id: string; receipt_no: string }[]) {
    const m = String(b.receipt_no).match(/(\d+)/);
    const num = m ? parseInt(m[1], 10) : 0;
    const cur = bookAt.get(b.centre_id);
    if (!cur || num >= cur.num) bookAt.set(b.centre_id, { no: b.receipt_no, num });
  }

  // Per-member max coverage (non-void) for paidCount.
  const maxTo = new Map<string, string>();
  for (const p of pays) {
    const cur = maxTo.get(p.member_id);
    if (!cur || p.months_to > cur) maxTo.set(p.member_id, p.months_to);
  }
  // Global + per-centre pledged/paid counts (the overview table shows 已缴/认捐 per centre).
  const pledgedByCentre = new Map<string, number>();
  const paidByCentre = new Map<string, number>();
  let pledgedCount = 0;
  let paidCount = 0;
  for (const m of members as { id: string; gyt_centre_id: string; fee_pledge_amount: number | null; fee_waived_from: string | null }[]) {
    if (m.fee_pledge_amount == null || m.fee_waived_from != null) continue;
    pledgedCount += 1;
    pledgedByCentre.set(m.gyt_centre_id, (pledgedByCentre.get(m.gyt_centre_id) ?? 0) + 1);
    const to = maxTo.get(m.id);
    if (to && to >= monthFirst) {
      paidCount += 1;
      paidByCentre.set(m.gyt_centre_id, (paidByCentre.get(m.gyt_centre_id) ?? 0) + 1);
    }
  }

  const pauseMap = new Map<string, { collection_paused: boolean; paused_note: string | null }>();
  for (const r of (monthsRes.data ?? []) as { centre_id: string; collection_paused: boolean; paused_note: string | null }[]) pauseMap.set(r.centre_id, r);
  const finMap = new Map<string, string>();
  for (const v of (finRes.data ?? []) as { centre_id: string; display_name: string | null }[]) if (v.centre_id && v.display_name) finMap.set(v.centre_id, v.display_name);

  const centreCards = (centres ?? []).map((c) => {
    const pc = perCentre.get(c.id);
    return {
      id: c.id,
      code: c.code,
      name_cn: c.name_cn,
      name_en: c.name_en,
      state: c.state,
      sort: c.sort,
      collected: pc?.collected ?? 0,
      expenses: pc?.expenses ?? 0,
      surplus: (pc?.collected ?? 0) - (pc?.expenses ?? 0),
      pledgedCount: pledgedByCentre.get(c.id) ?? 0,
      paidCount: paidByCentre.get(c.id) ?? 0,
      paused: pauseMap.get(c.id)?.collection_paused ?? false,
      pausedNote: pauseMap.get(c.id)?.paused_note ?? null,
      receiptBookAt: bookAt.get(c.id)?.no ?? null,
      financeName: finMap.get(c.id) ?? null,
    };
  });

  const collected = centreCards.reduce((s, c) => s + c.collected, 0);
  const expensesTotal = centreCards.reduce((s, c) => s + c.expenses, 0);

  // Events aggregate (org-level, read-only).
  const evs = (eventsRes.data ?? []) as { id: string; code: string; title: string; starts_on: string }[];
  let eventCards: { code: string; title: string; approvedFee: number; verifiedPaid: number; pendingProof: number; waived: number }[] = [];
  if (evs.length) {
    const { data: regs } = await supabaseAdmin
      .from('registrations')
      .select('event_id, status, fee_total, payment_status, paid_amount')
      .in('event_id', evs.map((e) => e.id));
    const byEvent = new Map<string, { approvedFee: number; verifiedPaid: number; pendingProof: number; waived: number }>();
    for (const r of (regs ?? []) as { event_id: string; status: string; fee_total: number | null; payment_status: string; paid_amount: number | null }[]) {
      const a = byEvent.get(r.event_id) ?? { approvedFee: 0, verifiedPaid: 0, pendingProof: 0, waived: 0 };
      if (r.status === 'approved') a.approvedFee += Number(r.fee_total ?? 0);
      if (r.payment_status === 'verified') a.verifiedPaid += Number(r.paid_amount ?? 0);
      if (r.payment_status === 'proof_submitted') a.pendingProof += 1;
      if (r.payment_status === 'waived') a.waived += 1;
      byEvent.set(r.event_id, a);
    }
    eventCards = evs.map((e) => ({ code: e.code, title: e.title, ...(byEvent.get(e.id) ?? { approvedFee: 0, verifiedPaid: 0, pendingProof: 0, waived: 0 }) }));
  }

  return NextResponse.json({
    month: monthFirst.slice(0, 7),
    scope,
    kpis: { collected, expenses: expensesTotal, surplus: collected - expensesTotal, pledgedCount, paidCount },
    centres: centreCards,
    events: eventCards,
  });
}
