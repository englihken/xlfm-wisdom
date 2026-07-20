// src/app/api/dashboard/events/[id]/fees/assign/route.ts
// 费用分配 — assign the per-person amount for an 'assigned' fee item after room
// allocation. Requires events:edit AND finance:view: this is money, so a plain
// events editor cannot silently price 918 people.
//
// GET  — the grouping preview: this event's registrations bucketed by room type
//        (the pricing key — see event-payments.roomGroupOf), each with a count,
//        the amount currently assigned, and how many rows are settled/blocked.
// POST — write it. { item, label?, groups: {key, amount}[], overrides?: {registration_id, amount}[] }
//
// STATUS FLIP, and what it must never touch:
//   after assignment, fee_total > 0 AND payment_status='waived' → 'unpaid'.
//   Rows already proof_submitted / verified / reconciled keep their status, and
//   a row carrying paid_amount is never re-priced downward — both come back as
//   `needsReview` for a human instead of being silently changed.
//
// Audited as ONE row per batch (reg.fee_assign) with the counts, not 918 rows.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { eventsScope } from '@/lib/members-scope';
import { mayRunCheckin } from '@/lib/event-checkin';
import { UUID_RE } from '@/lib/finance-cashbook';
import { assignedLines, type BreakdownLine } from '@/lib/event-fees';
import { roomGroupOf, assignedLine, toCents, fromCents, isSettled, UNASSIGNED_ROOM_TYPE, ROOM_TYPE_PAX } from '@/lib/event-payments';

export const runtime = 'nodejs';

const REG_SELECT = 'id, reg_no, status, selections, fee_total, fee_breakdown, payment_status, paid_amount';

type Reg = {
  id: string; reg_no: string; status: string; selections: unknown;
  fee_total: number | string; fee_breakdown: unknown;
  payment_status: string | null; paid_amount: number | string | null;
};

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

// events:edit for the event itself, finance:view because this prices people.
async function guard(id: string) {
  const access = await requireModuleAccess('events', 'edit');
  if (!access.ok) return { err: gate(access.status) };
  const fin = await requireModuleAccess('finance', 'view');
  if (!fin.ok) return { err: gate(fin.status) };
  if (!supabaseAdmin) return { err: NextResponse.json({ error: 'Storage unavailable' }, { status: 503 }) };
  if (!UUID_RE.test(id)) return { err: NextResponse.json({ error: 'Not found' }, { status: 404 }) };

  const { data: ev } = await supabaseAdmin
    .from('events')
    .select('id, code, organizing_centre_id, co_centre_ids')
    .eq('id', id)
    .maybeSingle();
  if (!ev || !mayRunCheckin(eventsScope(access.volunteer), ev)) {
    return { err: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { access, ev };
}

// Cancelled/rejected people are not priced — they are not coming.
const priceable = (r: Reg) => r.status === 'pending' || r.status === 'approved';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.err) return g.err;

  const [{ data: feeRows }, { data: regRows, error }] = await Promise.all([
    supabaseAdmin!.from('event_fees').select('item, label_cn, amount, billing, sort').eq('event_id', id).order('sort', { ascending: true }),
    supabaseAdmin!.from('registrations').select(REG_SELECT).eq('event_id', id).limit(20000),
  ]);
  if (error) {
    console.error('[fees/assign] load failed:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  const assignedItems = ((feeRows ?? []) as { item: string; label_cn: string | null; amount: number; billing: string }[])
    .filter((f) => f.billing === 'assigned')
    .map((f) => ({ item: f.item, label: f.label_cn, amount: Number(f.amount) }));

  const regs = ((regRows ?? []) as unknown as Reg[]).filter(priceable);

  // Bucket by room type. `amounts` collects the DISTINCT assigned amounts already
  // on rows in the group, so the UI can show "mixed" instead of pretending one
  // number applies when a per-person override is in play.
  const groups = new Map<string, { count: number; settled: number; amountCents: Set<number> }>();
  for (const r of regs) {
    const key = roomGroupOf(r.selections);
    if (!key) continue;
    const g2 = groups.get(key) ?? { count: 0, settled: 0, amountCents: new Set<number>() };
    g2.count++;
    if (isSettled(r.payment_status)) g2.settled++;
    for (const l of assignedLines(r.fee_breakdown)) g2.amountCents.add(toCents(l.subtotal));
    groups.set(key, g2);
  }

  const out = [...groups.entries()]
    .map(([key, g2]) => ({
      key,
      pax: ROOM_TYPE_PAX[key] ?? null,
      count: g2.count,
      settled: g2.settled,
      amounts: [...g2.amountCents].sort((a, b) => a - b).map(fromCents),
    }))
    // 未指定 last; the rest by size so the big buckets are priced first.
    .sort((a, b) => (a.key === UNASSIGNED_ROOM_TYPE ? 1 : b.key === UNASSIGNED_ROOM_TYPE ? -1 : b.count - a.count));

  return NextResponse.json({
    assignedItems,
    groups: out,
    totalPriceable: regs.length,
    // A free event (no fee rows at all) renders as an empty screen, not an error.
    hasAssignedItem: assignedItems.length > 0,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.err) return g.err;
  const me = g.access!.volunteer;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const item = typeof body.item === 'string' ? body.item.trim() : '';
  if (!item) return NextResponse.json({ error: '请选择费用项目' }, { status: 400 });

  // The item must actually be an 'assigned' row on this event — otherwise this
  // endpoint could inject a line the event never configured.
  const { data: feeRow } = await supabaseAdmin!
    .from('event_fees')
    .select('item, label_cn, billing')
    .eq('event_id', id)
    .eq('item', item)
    .eq('billing', 'assigned')
    .maybeSingle();
  if (!feeRow) return NextResponse.json({ error: '该费用项目不是「按分配」计费' }, { status: 400 });
  const label = (typeof body.label === 'string' && body.label.trim()) || feeRow.label_cn || item;

  const amountByGroup = new Map<string, number>();
  for (const raw of Array.isArray(body.groups) ? body.groups : []) {
    const gr = raw as Record<string, unknown>;
    const key = typeof gr.key === 'string' ? gr.key : '';
    const amt = Number(gr.amount);
    if (!key) continue;
    if (!Number.isFinite(amt) || amt < 0) return NextResponse.json({ error: '金额无效' }, { status: 400 });
    amountByGroup.set(key, amt);
  }
  const overrideByReg = new Map<string, number>();
  for (const raw of Array.isArray(body.overrides) ? body.overrides : []) {
    const o = raw as Record<string, unknown>;
    const rid = typeof o.registration_id === 'string' ? o.registration_id : '';
    const amt = Number(o.amount);
    if (!rid || !UUID_RE.test(rid)) return NextResponse.json({ error: '报名记录无效' }, { status: 400 });
    if (!Number.isFinite(amt) || amt < 0) return NextResponse.json({ error: '金额无效' }, { status: 400 });
    overrideByReg.set(rid, amt);
  }
  if (amountByGroup.size === 0 && overrideByReg.size === 0) {
    return NextResponse.json({ error: '没有要分配的金额' }, { status: 400 });
  }

  const { data: regRows, error: regErr } = await supabaseAdmin!
    .from('registrations')
    .select(REG_SELECT)
    .eq('event_id', id)
    .limit(20000);
  if (regErr) {
    console.error('[fees/assign] regs load failed:', regErr);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  let updated = 0;
  let flipped = 0;
  let skippedSettled = 0;
  const needsReview: { registration_id: string; reg_no: string; reason: string }[] = [];

  for (const r of ((regRows ?? []) as unknown as Reg[]).filter(priceable)) {
    const key = roomGroupOf(r.selections);
    const amount = overrideByReg.has(r.id) ? overrideByReg.get(r.id)! : key ? amountByGroup.get(key) : undefined;
    if (amount === undefined) continue; // group not priced in this batch

    const prevAssigned = assignedLines(r.fee_breakdown).find((l) => l.item === item);
    const prevCents = prevAssigned ? toCents(prevAssigned.subtotal) : 0;
    const nextCents = toCents(amount);
    if (prevCents === nextCents) continue; // nothing to do — keep the write log honest

    // Money already acknowledged: never silently re-price it.
    if (isSettled(r.payment_status)) {
      skippedSettled++;
      needsReview.push({ registration_id: r.id, reg_no: r.reg_no, reason: 'settled' });
      continue;
    }
    // A row carrying paid_amount must not be lowered under what was paid.
    if (r.paid_amount != null && nextCents < prevCents) {
      needsReview.push({ registration_id: r.id, reg_no: r.reg_no, reason: 'paid_would_lower' });
      continue;
    }

    // Rebuild the breakdown: keep every non-assigned line and every OTHER
    // assigned item, replace only this item's line.
    const prev = Array.isArray(r.fee_breakdown) ? (r.fee_breakdown as BreakdownLine[]) : [];
    const kept = prev.filter((l) => !(l && l.assigned === true && l.item === item));
    const nextBreakdown = nextCents > 0 ? [...kept, assignedLine(item, label, amount)] : kept;
    const totalCents = nextBreakdown.reduce((s, l) => s + toCents(l.subtotal), 0);

    const update: Record<string, unknown> = {
      fee_breakdown: nextBreakdown,
      fee_total: fromCents(totalCents),
      updated_at: new Date().toISOString(),
      updated_by: me.id,
    };
    // The flip: a waived row that now owes money becomes payable. Only waived —
    // unpaid stays unpaid, and settled never reaches here.
    if (totalCents > 0 && r.payment_status === 'waived') {
      update.payment_status = 'unpaid';
      update.paid_amount = null;
      flipped++;
    }

    const { error: updErr } = await supabaseAdmin!.from('registrations').update(update).eq('id', r.id);
    if (updErr) {
      console.error('[fees/assign] update failed for', r.reg_no, updErr);
      needsReview.push({ registration_id: r.id, reg_no: r.reg_no, reason: 'update_failed' });
      continue;
    }
    updated++;
  }

  // ONE audit row for the batch — 918 rows of noise would bury the signal.
  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'events',
    action: 'reg.fee_assign',
    tableName: 'registrations',
    recordId: id, // the EVENT — this is a batch acting on it
    after: {
      event_id: id,
      item,
      groups: [...amountByGroup.entries()].map(([k, v]) => ({ key: k, amount: v })),
      overrides: overrideByReg.size,
      updated,
      flippedToUnpaid: flipped,
      skippedSettled,
      needsReview: needsReview.length,
    },
  });

  return NextResponse.json({ updated, flipped, skippedSettled, needsReview });
}
