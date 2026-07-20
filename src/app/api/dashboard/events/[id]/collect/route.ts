// src/app/api/dashboard/events/[id]/collect/route.ts
// 现场收款 — the event-day cash counter, same desk crew and same wall as 签到
// (events:edit at a hosting centre, via mayRunCheckin).
//
// GET  ?token= | ?q=  — pull up a person: scan the SAME checkin_token QR, or
//      search name / phone / reg_no. Returns what the counter must see before
//      taking money: 应缴, current status, and whether anything is already paid.
// POST { registration_id, amount } — take cash. Sets verified / cash /
//      paid_amount / verifier, note 'cash@desk'.
//
// Cash rows deliberately do NOT get a finance_transactions row here. The daily
// 日结 close posts ONE summary instead: registrations are the subledger, the
// ledger carries summaries. Posting both would double-count the money.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { eventsScope } from '@/lib/members-scope';
import { mayRunCheckin, CHECKIN_TOKEN_RE } from '@/lib/event-checkin';
import { UUID_RE } from '@/lib/finance-cashbook';
import { normalizePhone } from '@/lib/members';
import { todayMYT } from '@/lib/events';
import { fromCents, toCents, sumCents, isSettled, mytDateOf } from '@/lib/event-payments';

export const runtime = 'nodejs';

const SELECT =
  'id, reg_no, status, fee_total, paid_amount, payment_status, payment_method, payment_note, applicant_name, applicant_phone, ' +
  'member:members!member_id ( name_cn, phone, centre:centres!gyt_centre_id ( name_cn ) )';

type Member = { name_cn: string | null; phone: string | null; centre: { name_cn: string } | { name_cn: string }[] | null };
type Row = {
  id: string; reg_no: string; status: string; fee_total: number | string;
  paid_amount: number | string | null; payment_status: string | null; payment_method: string | null;
  payment_note: string | null; applicant_name: string | null; applicant_phone: string | null;
  member: Member | Member[] | null;
};
const flat = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

async function guard(id: string, level: 'view' | 'edit') {
  const access = await requireModuleAccess('events', level);
  if (!access.ok) return { err: gate(access.status) };
  if (!supabaseAdmin) return { err: NextResponse.json({ error: 'Storage unavailable' }, { status: 503 }) };
  if (!UUID_RE.test(id)) return { err: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  const { data: ev } = await supabaseAdmin
    .from('events')
    .select('id, code, title, organizing_centre_id, co_centre_ids')
    .eq('id', id)
    .maybeSingle();
  if (!ev || !mayRunCheckin(eventsScope(access.volunteer), ev)) {
    return { err: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { access, ev };
}

function present(r: Row) {
  const m = flat(r.member);
  const fee = Number(r.fee_total) || 0;
  const status = r.payment_status ?? 'unpaid';
  return {
    id: r.id,
    reg_no: r.reg_no,
    name: m?.name_cn || r.applicant_name || '',
    centre_name: flat(m?.centre ?? null)?.name_cn ?? null,
    fee_total: fee,
    paid_amount: r.paid_amount == null ? null : Number(r.paid_amount),
    payment_status: status,
    payment_method: r.payment_method,
    // What the counter should DO, decided server-side so the desk cannot take
    // money twice on a stale screen.
    action: isSettled(status) ? 'settled' : fee <= 0 ? 'nothing_due' : 'collect',
  };
}

// Today's cash take for this event — the number the cash box must match.
async function todayCash(eventId: string, day: string) {
  const { data } = await supabaseAdmin!
    .from('registrations')
    .select('paid_amount, payment_verified_at')
    .eq('event_id', eventId)
    .eq('payment_method', 'cash')
    .in('payment_status', ['verified', 'reconciled'])
    .limit(20000);
  const rows = ((data ?? []) as { paid_amount: number | string | null; payment_verified_at: string | null }[]).filter(
    (r) => r.payment_verified_at && mytDateOf(r.payment_verified_at) === day
  );
  return { cents: sumCents(rows.map((r) => r.paid_amount ?? 0)), count: rows.length };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id, 'view');
  if (g.err) return g.err;

  const sp = new URL(req.url).searchParams;
  const token = (sp.get('token') ?? '').trim();
  const raw = (sp.get('q') ?? '').trim();
  const day = todayMYT();
  const cash = await todayCash(id, day);
  const header = { day, todayCashCents: cash.cents, todayCash: fromCents(cash.cents), todayCashCount: cash.count, event: { id: g.ev!.id, code: g.ev!.code, title: g.ev!.title } };

  if (token) {
    if (!CHECKIN_TOKEN_RE.test(token)) return NextResponse.json({ error: '二维码无效', ...header }, { status: 400 });
    const { data } = await supabaseAdmin!.from('registrations').select(SELECT).eq('checkin_token', token).maybeSingle();
    const row = data as unknown as (Row & { event_id?: string }) | null;
    if (!row) return NextResponse.json({ error: '此二维码不属于本活动', ...header }, { status: 404 });
    // Prove it belongs to THIS event before showing anything about the person.
    const { data: owns } = await supabaseAdmin!
      .from('registrations')
      .select('id')
      .eq('id', row.id)
      .eq('event_id', id)
      .maybeSingle();
    if (!owns) return NextResponse.json({ error: '此二维码不属于本活动', ...header }, { status: 404 });
    return NextResponse.json({ ...header, results: [present(row)] });
  }

  if (raw.length < 2) return NextResponse.json({ ...header, results: [] });
  // The .or() grammar is not value-encoded — strip its delimiters first.
  const safe = raw.replace(/[,.()%*"\\]/g, ' ').trim();
  if (!safe) return NextResponse.json({ ...header, results: [] });
  const ors = [`reg_no.ilike.%${safe}%`, `applicant_name.ilike.%${safe}%`, `applicant_phone.ilike.%${safe}%`];
  const norm = normalizePhone(safe);
  if (!norm.error && norm.phone) ors.push(`applicant_phone.ilike.%${norm.phone}%`);
  const { data: mem } = await supabaseAdmin!
    .from('members')
    .select('id')
    .or(`name_cn.ilike.%${safe}%,name_en.ilike.%${safe}%,phone.ilike.%${norm.phone ?? safe}%`)
    .limit(200);
  const memberIds = (mem ?? []).map((m) => m.id as string).filter((x) => UUID_RE.test(x));
  if (memberIds.length) ors.push(`member_id.in.(${memberIds.join(',')})`);

  const { data, error } = await supabaseAdmin!
    .from('registrations')
    .select(SELECT)
    .eq('event_id', id)
    .or(ors.join(','))
    .order('reg_no', { ascending: true })
    .limit(25);
  if (error) {
    console.error('[collect] search failed:', error);
    return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
  }
  return NextResponse.json({ ...header, results: ((data ?? []) as unknown as Row[]).map(present) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id, 'edit');
  if (g.err) return g.err;
  const me = g.access!.volunteer;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const regId = typeof body?.registration_id === 'string' ? body.registration_id : '';
  if (!regId || !UUID_RE.test(regId)) return NextResponse.json({ error: '报名记录无效' }, { status: 400 });

  const { data: reg } = await supabaseAdmin!
    .from('registrations')
    .select('id, reg_no, event_id, fee_total, paid_amount, payment_status')
    .eq('id', regId)
    .maybeSingle();
  if (!reg || reg.event_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Re-check server-side: a desk on a stale screen must not take money twice.
  if (isSettled(reg.payment_status)) {
    return NextResponse.json({ error: '该笔已收款', already: true }, { status: 400 });
  }

  let amount = Number(reg.fee_total) || 0;
  if (body?.amount !== undefined && body?.amount !== null && body?.amount !== '') {
    const a = Number(body.amount);
    if (!Number.isFinite(a) || a <= 0) return NextResponse.json({ error: '金额无效' }, { status: 400 });
    amount = fromCents(toCents(a));
  }
  if (amount <= 0) return NextResponse.json({ error: '此报名无需缴费' }, { status: 400 });

  const nowIso = new Date().toISOString();
  const { data: updated, error } = await supabaseAdmin!
    .from('registrations')
    .update({
      payment_status: 'verified',
      payment_method: 'cash',
      paid_amount: amount,
      payment_note: 'cash@desk',
      payment_verified_by: me.id,
      payment_verified_at: nowIso,
      updated_at: nowIso,
      updated_by: me.id,
    })
    .eq('id', regId)
    .select('id, payment_status, payment_method, paid_amount, payment_verified_at')
    .single();
  if (error || !updated) {
    console.error('[collect] update failed:', error);
    return NextResponse.json({ error: '收款失败，请重试' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'reg.pay_cash',
    tableName: 'registrations',
    recordId: regId,
    before: { payment_status: reg.payment_status, paid_amount: reg.paid_amount ?? null },
    after: { payment_status: 'verified', payment_method: 'cash', paid_amount: amount, event_id: id, reg_no: reg.reg_no },
  });

  const day = todayMYT();
  const cash = await todayCash(id, day);
  return NextResponse.json({ registration: updated, todayCash: fromCents(cash.cents), todayCashCount: cash.count });
}
