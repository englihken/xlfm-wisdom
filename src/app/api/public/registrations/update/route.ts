// src/app/api/public/registrations/update/route.ts
// PUBLIC ANONYMOUS ROUTE — no login; gate is proof-of-ownership (reg_no + matching
// phone, same as /api/public/lookup); touches only the ONE matched registration.
//
// POST { reg_no, phone, meals?, stay? } — the status-page-v2 self-edit. Only while the
// SHARED edit window is open (regEditOpen — the exact rule the staff selections PATCH
// enforces; the UI hiding buttons is not the gate, THIS 403 is). Two editable sections:
//   • meals — same validation + fee recompute as the staff PATCH: keys ⊆ offered slots,
//     parseSelections/computeFees, fresh fee snapshot. Writes selections.meals.
//   • stay  — needs_accommodation / room_type / check_in / check_out written to the
//     selections.stay namespace (NEVER into selections.import813 — that snapshot is
//     immutable; readers resolve stay ?? import813 via resolveStay). Dates must sit in
//     the event's meal-slot span with check_out > check_in. room_assign (同房) is
//     centrally planned and NOT editable here.
// Unknown selections namespaces on the stored row (import813, anything future) are
// PRESERVED — only the known fee keys are rebuilt (same contract as commit 166975d).
// Every successful edit writes an audit_log row (actor null / 'public').

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { normalizePhone } from '@/lib/members';
import { computeFees, parseSelections, type FeeItem } from '@/lib/event-fees';
import { fetchOfferedKeys, invalidMealKeys } from '@/lib/event-slots';
import { regEditOpen, todayMYT, isValidDate } from '@/lib/events';
import { STAY_ROOM_TYPES } from '@/lib/stay';
import {
  sameOrigin, rateLimit, clientIp, readJsonCapped, hasUnknownKeys,
  matchOwnedRegistration, buildOwnedRegistrationDetail,
} from '@/lib/public-event';

export const runtime = 'nodejs';

const ALLOWED = ['reg_no', 'phone', 'meals', 'stay'] as const;
const STAY_KEYS = ['needs_accommodation', 'room_type', 'check_in', 'check_out'] as const;
const REG_NO_RE = /^[A-Za-z0-9-]{1,40}$/;
// The known fee-engine keys the staff PATCH also rebuilds; everything else is preserved.
const KNOWN_KEYS = new Set(['meal_days', 'meals', 'nights', 'transfer', 'uniform', 'other_qty']);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!rateLimit(`pub:regupdate:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = await readJsonCapped(req);
  if (!body || hasUnknownKeys(body, ALLOWED)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  if (body.meals === undefined && body.stay === undefined) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // ── ownership gate (identical to lookup: wrong phone == unknown reg_no == 404) ──────
  const regNo = typeof body.reg_no === 'string' ? body.reg_no.trim() : '';
  if (!regNo || !REG_NO_RE.test(regNo)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { phone, error } = normalizePhone(String(body.phone ?? ''));
  if (error || !phone) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const reg = await matchOwnedRegistration(regNo, phone);
  if (!reg || !reg.event) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!['pending', 'approved'].includes(reg.status)) {
    return NextResponse.json({ error: '此报名状态不可修改' }, { status: 400 });
  }

  // ── the SHARED cutoff rule, enforced server-side (the UI is not the gate) ────────────
  const cutoffDays = Number(reg.event.reg_edit_cutoff_days) || 0;
  if (!regEditOpen(reg.event.starts_on, cutoffDays, todayMYT())) {
    return NextResponse.json({ error: `修改期已截止（活动开始前 ${cutoffDays} 天）` }, { status: 403 });
  }

  const current = (reg.selections ?? {}) as Record<string, unknown>;
  const preserved: Record<string, unknown> = {};
  const knownCurrent: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(current)) (KNOWN_KEYS.has(k) ? knownCurrent : preserved)[k] = v;

  // ── meals section ────────────────────────────────────────────────────────────────────
  if (body.meals !== undefined) {
    if (!Array.isArray(body.meals) || body.meals.some((m) => typeof m !== 'string') || body.meals.length > 400) {
      return NextResponse.json({ error: '餐点选项无效' }, { status: 400 });
    }
    knownCurrent.meals = body.meals;
  }
  const parsed = parseSelections(knownCurrent);

  const { data: feeRows } = await supabaseAdmin
    .from('event_fees').select('item, label_cn, amount, billing').eq('event_id', reg.event.id);
  const fees = ((feeRows ?? []) as { item: string; label_cn: string | null; amount: number; billing: string }[]).map(
    (f) => ({ item: f.item, label_cn: f.label_cn, amount: Number(f.amount), billing: f.billing }) as FeeItem
  );
  const mealPerItem = fees.some((f) => f.item === 'meal' && f.billing === 'per_item');
  if (mealPerItem && parsed.meals?.length) {
    const offered = await fetchOfferedKeys(supabaseAdmin, reg.event.id);
    const bad = invalidMealKeys(parsed.meals, offered);
    if (bad.length) return NextResponse.json({ error: `餐点选项无效（未供应）：${bad.join('、')}` }, { status: 400 });
  } else if (!mealPerItem) {
    delete parsed.meals;
  }
  const { total, breakdown } = computeFees(fees, parsed);

  const nextSelections: Record<string, unknown> = { ...preserved, ...parsed };

  // ── stay section (selections.stay namespace; import813 stays byte-identical) ────────
  if (body.stay !== undefined) {
    const raw = body.stay;
    if (!raw || typeof raw !== 'object' || hasUnknownKeys(raw as Record<string, unknown>, STAY_KEYS)) {
      return NextResponse.json({ error: '住宿选项无效' }, { status: 400 });
    }
    const st = raw as Record<string, unknown>;
    if (typeof st.needs_accommodation !== 'boolean') {
      return NextResponse.json({ error: '住宿选项无效' }, { status: 400 });
    }
    let stay: Record<string, unknown>;
    if (st.needs_accommodation === false) {
      stay = { needs_accommodation: false, room_type: null, check_in: null, check_out: null };
    } else {
      const roomType = st.room_type === null || st.room_type === undefined || st.room_type === ''
        ? null
        : String(st.room_type);
      if (roomType !== null && !(STAY_ROOM_TYPES as readonly string[]).includes(roomType)) {
        return NextResponse.json({ error: '房型无效' }, { status: 400 });
      }
      if (!isValidDate(st.check_in) || !isValidDate(st.check_out)) {
        return NextResponse.json({ error: '请选择入住与退房日期' }, { status: 400 });
      }
      const checkIn = st.check_in as string;
      const checkOut = st.check_out as string;
      if (checkOut <= checkIn) {
        return NextResponse.json({ error: '退房日期须晚于入住日期' }, { status: 400 });
      }
      // accommodation window = the event's meal-slot span (derived, not hardcoded)
      const { data: slotRows } = await supabaseAdmin
        .from('event_meal_slots').select('slot_date').eq('event_id', reg.event.id);
      const dates = [...new Set(((slotRows ?? []) as { slot_date: string }[]).map((s) => s.slot_date))].sort();
      if (!dates.length || checkIn < dates[0] || checkOut > dates[dates.length - 1]) {
        return NextResponse.json({ error: `入住/退房日期须在 ${dates[0] ?? '—'} 至 ${dates[dates.length - 1] ?? '—'} 之间` }, { status: 400 });
      }
      stay = { needs_accommodation: true, room_type: roomType, check_in: checkIn, check_out: checkOut };
    }
    nextSelections.stay = stay;
  }

  const { error: upErr } = await supabaseAdmin
    .from('registrations')
    .update({
      selections: nextSelections,
      fee_total: total,
      fee_breakdown: breakdown,
      updated_at: new Date().toISOString(),
      updated_by: null, // public self-edit — no volunteer actor
    })
    .eq('id', reg.id);
  if (upErr) {
    console.error('[public/reg-update] update failed:', upErr);
    return NextResponse.json({ error: '保存失败，请重试' }, { status: 500 });
  }

  await writeAudit({
    actorId: null,
    actorEmail: 'public',
    module: 'events',
    action: 'reg.self_update',
    tableName: 'registrations',
    recordId: reg.id,
    before: { meals: (current.meals as unknown) ?? null, stay: (current.stay as unknown) ?? null, fee_total: reg.fee_total },
    after: { meals: (nextSelections.meals as unknown) ?? null, stay: (nextSelections.stay as unknown) ?? null, fee_total: total },
  });

  // Fresh owner view (same shape the lookup returns) so the page can re-render in place.
  const updated = await matchOwnedRegistration(regNo, phone);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const detail = await buildOwnedRegistrationDetail(updated);
  return NextResponse.json({
    reg_no: updated.reg_no,
    status: updated.status,
    fee_total: updated.fee_total,
    payment_status: updated.payment_status,
    has_proof: !!updated.payment_proof_path,
    event: updated.event
      ? { title: updated.event.title, code: updated.event.code, starts_on: updated.event.starts_on, ends_on: updated.event.ends_on }
      : null,
    detail,
  });
}
