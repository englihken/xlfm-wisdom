// src/app/api/public/fee-lookup/route.ts
// PUBLIC ANONYMOUS ROUTE (D5 会员自查) — no login; the ONLY key is a phone number. Returns a
// MASKED, minimal self-view: for each ACTIVE member bound to the phone — masked name (陈＊＊,
// the C1 pattern), centre name, pledge, paidThrough, last 12 non-void payments, and the centre's
// CURRENT-month transparency block (collected / expenses / surplus + pause). NO ids, NO unmasked
// names, NO other members' data. sameOrigin + rateLimit; an unknown phone returns an EMPTY result
// (uniform — no enumeration signal). Mirrors public/lookup's protections.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizePhone } from '@/lib/members';
import { sameOrigin, rateLimit, clientIp, readJsonCapped, hasUnknownKeys, maskName } from '@/lib/public-event';

export const runtime = 'nodejs';

const ALLOWED = ['phone'] as const;

function nextMonthFirst(firstOfMonth: string): string {
  const [y, m] = firstOfMonth.split('-').map(Number);
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!rateLimit(`pub:fee:${clientIp(req)}`, 20, 60_000)) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = await readJsonCapped(req);
  if (!body || hasUnknownKeys(body, ALLOWED)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { phone } = normalizePhone(String(body.phone ?? ''));
  if (!phone) return NextResponse.json({ members: [] }); // uniform empty — no enumeration signal

  const { data: members } = await supabaseAdmin
    .from('members')
    .select('id, name_cn, name_en, gyt_centre_id, fee_pledge_amount, fee_pledge_period, fee_waived_from')
    .eq('phone', phone)
    .eq('status', 'active');
  if (!members || members.length === 0) return NextResponse.json({ members: [] });

  const memberIds = members.map((m) => m.id);
  const centreIds = [...new Set(members.map((m) => m.gyt_centre_id).filter(Boolean) as string[])];
  const monthFirst = new Date().toISOString().slice(0, 8) + '01';
  const monthEnd = nextMonthFirst(monthFirst);

  const [{ data: centres }, { data: pays }, { data: centrePays }, { data: centreExps }, { data: pauses }] = await Promise.all([
    supabaseAdmin.from('centres').select('id, name_cn').in('id', centreIds.length ? centreIds : ['x']),
    supabaseAdmin.from('fee_payments').select('member_id, receipt_no, paid_at, amount, months_from, months_to').is('voided_at', null).in('member_id', memberIds).order('paid_at', { ascending: false }),
    supabaseAdmin.from('fee_payments').select('centre_id, amount').is('voided_at', null).gte('paid_at', monthFirst).lt('paid_at', monthEnd).in('centre_id', centreIds.length ? centreIds : ['x']),
    supabaseAdmin.from('expenses').select('centre_id, amount').is('voided_at', null).gte('spent_at', monthFirst).lt('spent_at', monthEnd).in('centre_id', centreIds.length ? centreIds : ['x']),
    supabaseAdmin.from('centre_finance_months').select('centre_id, collection_paused, paused_note').eq('month', monthFirst).in('centre_id', centreIds.length ? centreIds : ['x']),
  ]);

  const centreName = new Map<string, string>();
  for (const c of (centres ?? []) as { id: string; name_cn: string }[]) centreName.set(c.id, c.name_cn);
  const payByMember = new Map<string, { receipt_no: string; paid_at: string; amount: number; months_from: string; months_to: string }[]>();
  for (const p of (pays ?? []) as { member_id: string; receipt_no: string; paid_at: string; amount: number; months_from: string; months_to: string }[]) {
    const arr = payByMember.get(p.member_id) ?? [];
    arr.push(p);
    payByMember.set(p.member_id, arr);
  }
  const collected = new Map<string, number>();
  for (const p of (centrePays ?? []) as { centre_id: string; amount: number }[]) collected.set(p.centre_id, (collected.get(p.centre_id) ?? 0) + Number(p.amount));
  const spent = new Map<string, number>();
  for (const e of (centreExps ?? []) as { centre_id: string; amount: number }[]) spent.set(e.centre_id, (spent.get(e.centre_id) ?? 0) + Number(e.amount));
  const pauseMap = new Map<string, { collection_paused: boolean; paused_note: string | null }>();
  for (const r of (pauses ?? []) as { centre_id: string; collection_paused: boolean; paused_note: string | null }[]) pauseMap.set(r.centre_id, r);

  const out = members.map((m) => {
    const ps = (payByMember.get(m.id) ?? []).slice(0, 12);
    const paidThrough = ps.length ? ps.reduce((mx, p) => (p.months_to > mx ? p.months_to : mx), ps[0].months_to).slice(0, 7) : null;
    const cid = m.gyt_centre_id as string | null;
    const col = cid ? collected.get(cid) ?? 0 : 0;
    const exp = cid ? spent.get(cid) ?? 0 : 0;
    return {
      maskedName: maskName(m.name_cn, m.name_en),
      centre: cid ? centreName.get(cid) ?? null : null,
      pledge: { fee_pledge_amount: m.fee_pledge_amount, fee_pledge_period: m.fee_pledge_period, fee_waived_from: m.fee_waived_from },
      paidThrough,
      payments: ps.map((p) => ({ receipt_no: p.receipt_no, paid_at: p.paid_at, amount: p.amount, months_from: p.months_from.slice(0, 7), months_to: p.months_to.slice(0, 7) })),
      transparency: cid ? { collected: col, expenses: exp, surplus: col - exp, paused: pauseMap.get(cid)?.collection_paused ?? false, pausedNote: pauseMap.get(cid)?.paused_note ?? null } : null,
    };
  });

  return NextResponse.json({ members: out });
}
