// src/app/api/dashboard/finance/event-payments/route.ts
// 分会对人 — the branch payment board.
//
// GET  ?event_id=&tab=&centre_id= (finance:view) — this caller's collectable
//      registrations for one event, bucketed: 未付 / 已上传证明 / 已核实 / 现金已收.
// POST (finance:edit) — { action:'verify', registration_id, paid_amount?, note? }
//      Verifies a TRANSFER proof: status 'verified', method 'transfer'.
//
// THE BRANCH WALL. A locked finance user sees and may act on only registrations
// whose member's centre is theirs; registrations with no member belong to the HQ
// bucket. The wall is re-proven on POST against the row's own centre — a
// registration id from another centre is rejected there even though the list
// would never have shown it. That check returns 403 (not the events-side 404):
// the caller already holds finance access and got the id from a scoped list, so
// there is no enumeration to protect against, and a flat "forbidden" is the
// honest answer to "I know this exists but it is not mine".

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { financeScope } from '@/lib/finance';
import { UUID_RE } from '@/lib/finance-cashbook';
import { isHqFinance, mayActOnRegistration, sumCents, fromCents, toCents } from '@/lib/event-payments';

export const runtime = 'nodejs';

const SELECT =
  'id, reg_no, status, fee_total, paid_amount, payment_status, payment_method, payment_proof_path, payment_note, ' +
  'payment_verified_at, payment_reconciled_at, applicant_name, applicant_phone, member_id, ' +
  'member:members!member_id ( name_cn, phone, gyt_centre_id, centre:centres!gyt_centre_id ( name_cn ) )';

type Member = { name_cn: string | null; phone: string | null; gyt_centre_id: string | null; centre: { name_cn: string } | { name_cn: string }[] | null };
type Row = {
  id: string; reg_no: string; status: string; fee_total: number | string;
  paid_amount: number | string | null; payment_status: string | null; payment_method: string | null;
  payment_proof_path: string | null; payment_note: string | null;
  payment_verified_at: string | null; payment_reconciled_at: string | null;
  applicant_name: string | null; applicant_phone: string | null; member_id: string | null;
  member: Member | Member[] | null;
};
const flat = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

export async function GET(req: Request) {
  const access = await requireModuleAccess('finance', 'view');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const eventId = sp.get('event_id') ?? '';
  if (!eventId || !UUID_RE.test(eventId)) return NextResponse.json({ error: '活动无效' }, { status: 400 });

  const scope = financeScope(access.volunteer);
  const hq = isHqFinance(scope);
  // HQ may narrow to one centre; a branch user is pinned to theirs regardless.
  const wanted = sp.get('centre_id');
  if (wanted && wanted !== '__hq' && !UUID_RE.test(wanted)) {
    return NextResponse.json({ error: '中心无效' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('registrations')
    .select(SELECT)
    .eq('event_id', eventId)
    .in('status', ['pending', 'approved'])
    .order('reg_no', { ascending: true })
    .limit(20000);
  if (error) {
    console.error('[event-payments] list failed:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  const all = (data ?? []) as unknown as Row[];
  // Filtering in JS rather than SQL because the centre lives on the EMBEDDED
  // member row; PostgREST cannot filter the base table by an embedded column
  // and also return the no-member (HQ bucket) rows in the same query.
  const mine = all.filter((r) => {
    const centreId = flat(r.member)?.gyt_centre_id ?? null;
    if (!mayActOnRegistration(scope, centreId)) return false;
    if (hq && wanted) return wanted === '__hq' ? centreId === null : centreId === wanted;
    return true;
  });

  const rows = mine.map((r) => {
    const m = flat(r.member);
    return {
      id: r.id,
      reg_no: r.reg_no,
      name: m?.name_cn || r.applicant_name || '',
      phone: m?.phone || r.applicant_phone || null,
      centre_id: m?.gyt_centre_id ?? null,
      centre_name: flat(m?.centre ?? null)?.name_cn ?? null,
      fee_total: Number(r.fee_total) || 0,
      paid_amount: r.paid_amount == null ? null : Number(r.paid_amount),
      payment_status: r.payment_status ?? 'unpaid',
      payment_method: r.payment_method,
      has_proof: !!r.payment_proof_path,
      payment_note: r.payment_note,
      verified_at: r.payment_verified_at,
      reconciled_at: r.payment_reconciled_at,
    };
  });

  // Tabs. 现金已收 is a slice of verified, not a separate status — the method is
  // what distinguishes it, and HQ reconciles transfers only.
  const unpaid = rows.filter((r) => r.payment_status === 'unpaid' && r.fee_total > 0);
  const proof = rows.filter((r) => r.payment_status === 'proof_submitted');
  const verified = rows.filter((r) => (r.payment_status === 'verified' || r.payment_status === 'reconciled') && r.payment_method !== 'cash');
  const cash = rows.filter((r) => r.payment_method === 'cash');

  return NextResponse.json({
    scope: { locked: scope.locked, centreId: scope.centreId, hq },
    tabs: { unpaid, proof, verified, cash },
    totals: {
      unpaidCount: unpaid.length,
      unpaidDue: fromCents(sumCents(unpaid.map((r) => r.fee_total))),
      proofCount: proof.length,
      verifiedCount: verified.length,
      verifiedPaid: fromCents(sumCents(verified.map((r) => r.paid_amount ?? 0))),
      cashCount: cash.length,
      cashPaid: fromCents(sumCents(cash.map((r) => r.paid_amount ?? 0))),
    },
  });
}

export async function POST(req: Request) {
  const access = await requireModuleAccess('finance', 'edit');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  if (body.action !== 'verify') return NextResponse.json({ error: '操作无效' }, { status: 400 });

  const regId = typeof body.registration_id === 'string' ? body.registration_id : '';
  if (!regId || !UUID_RE.test(regId)) return NextResponse.json({ error: '报名记录无效' }, { status: 400 });

  const { data: reg } = await supabaseAdmin
    .from('registrations')
    .select('id, reg_no, fee_total, paid_amount, payment_status, payment_proof_path, member:members!member_id ( gyt_centre_id )')
    .eq('id', regId)
    .maybeSingle();
  if (!reg) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // THE WALL, re-proven on the row itself.
  const scope = financeScope(access.volunteer);
  const regCentre = (flat((reg as unknown as Row).member) as { gyt_centre_id: string | null } | null)?.gyt_centre_id ?? null;
  if (!mayActOnRegistration(scope, regCentre)) {
    return NextResponse.json({ error: '无权核实其他中心的报名' }, { status: 403 });
  }

  // Reconciled is HQ's terminal state — a branch may not reopen it.
  if (reg.payment_status === 'reconciled') {
    return NextResponse.json({ error: '该笔已由总会对账，无法再核实' }, { status: 400 });
  }

  let paid = Number(reg.fee_total) || 0;
  if (body.paid_amount !== undefined && body.paid_amount !== null && body.paid_amount !== '') {
    const p = Number(body.paid_amount);
    if (!Number.isFinite(p) || p < 0) return NextResponse.json({ error: '金额无效' }, { status: 400 });
    paid = fromCents(toCents(p)); // partial payments are legitimate — no equality check
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

  const me = access.volunteer;
  const nowIso = new Date().toISOString();
  const { data: updated, error } = await supabaseAdmin
    .from('registrations')
    .update({
      payment_status: 'verified',
      payment_method: 'transfer',
      paid_amount: paid,
      payment_note: note,
      payment_verified_by: me.id,
      payment_verified_at: nowIso,
      updated_at: nowIso,
      updated_by: me.id,
    })
    .eq('id', regId)
    .select('id, payment_status, payment_method, paid_amount, payment_verified_at')
    .single();
  if (error || !updated) {
    console.error('[event-payments] verify failed:', error);
    return NextResponse.json({ error: '核实失败，请重试' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'reg.pay_verify',
    tableName: 'registrations',
    recordId: regId,
    before: { payment_status: reg.payment_status, paid_amount: reg.paid_amount ?? null },
    after: { payment_status: 'verified', payment_method: 'transfer', paid_amount: paid, centre_id: regCentre },
  });

  return NextResponse.json({ registration: updated });
}
