// src/app/api/dashboard/events/[id]/route.ts
// GET   — event + fees (sorted) + team needs (with team name + approved count) +
//         registration stats (counts by status + approved fee sum). events:view.
// PATCH — partial CORE update; code/status are NOT patchable here (status has its own
//         route). fees[] and team_needs[] are accepted as FULL desired sets and
//         set-diffed. Deleting a fee row NEVER touches existing registrations'
//         fee_breakdown — that snapshot was locked at submission. events:edit; audited.

import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { EVENT_TYPES, MEALS, isValidDate, validateFees, validateNeeds, type NormalizedFee, type NormalizedNeed } from '@/lib/events';
import { normalizeSlotOverrides, syncMealSlots } from '@/lib/event-slots';

export const runtime = 'nodejs';

function gate401or403(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}
const feeKey = (f: NormalizedFee) => `${f.item}|${f.label_cn ?? ''}|${f.amount}|${f.billing}|${f.sort}`;
const needKey = (n: NormalizedNeed) => `${n.team_id}|${n.needed}`;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireModuleAccess('events', 'view');
  if (!access.ok) return gate401or403(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { data: event, error } = await supabaseAdmin
    .from('events')
    .select('*, organizing_centre:centres!organizing_centre_id ( id, code, name_cn, name_en )')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[events] detail fetch failed:', error);
    return NextResponse.json({ error: 'Failed to load event' }, { status: 500 });
  }
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [{ data: fees }, { data: needRows }, { data: regs }, { data: slotRows }, { count: checkedInCount }] = await Promise.all([
    supabaseAdmin.from('event_fees').select('item, label_cn, amount, billing, sort').eq('event_id', id).order('sort', { ascending: true }),
    supabaseAdmin.from('event_team_needs').select('team_id, needed, team:teams ( name_cn )').eq('event_id', id),
    supabaseAdmin.from('registrations').select('status, fee_total, volunteer_team_id, selections, payment_status, paid_amount').eq('event_id', id),
    supabaseAdmin.from('event_meal_slots').select('slot_date, meal, offered').eq('event_id', id),
    // 活动签到: head-only count of live (non-voided) attendance — the detail page
    // shows the number, the desk page owns the breakdown.
    supabaseAdmin.from('event_attendance').select('id', { count: 'exact', head: true }).eq('event_id', id).is('voided_at', null),
  ]);

  const counts = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  const approvedByTeam = new Map<string, number>();
  let approvedFeeSum = 0;
  // Gentle payment tallies (C3) — no target, no shaming; data for the future finance module.
  let paidSum = 0, verifiedCount = 0, waivedCount = 0, proofCount = 0;
  type RegLite = { status: string; fee_total: number; volunteer_team_id: string | null; selections: { meals?: unknown } | null; payment_status: string | null; paid_amount: number | null };
  const regList = (regs ?? []) as RegLite[];
  for (const r of regList) {
    if (r.status in counts) counts[r.status as keyof typeof counts]++;
    if (r.status === 'approved') {
      approvedFeeSum += Number(r.fee_total) || 0;
      if (r.volunteer_team_id) approvedByTeam.set(r.volunteer_team_id, (approvedByTeam.get(r.volunteer_team_id) ?? 0) + 1);
    }
    // payment tallies span all non-cancelled registrations (approval-independent by design)
    if (r.status !== 'cancelled') {
      if (r.payment_status === 'verified') { verifiedCount++; paidSum += Number(r.paid_amount) || 0; }
      else if (r.payment_status === 'waived') waivedCount++;
      else if (r.payment_status === 'proof_submitted') proofCount++;
    }
  }

  // meal slots (sorted date → meal-order), + kitchen stats (per_item meal events only).
  const mealOrder = new Map<string, number>(MEALS.map((m, i) => [m, i]));
  const mealSlots = ((slotRows ?? []) as { slot_date: string; meal: string; offered: boolean }[])
    .slice()
    .sort((a, b) => (a.slot_date === b.slot_date ? (mealOrder.get(a.meal) ?? 9) - (mealOrder.get(b.meal) ?? 9) : a.slot_date < b.slot_date ? -1 : 1));

  const feeRows = (fees ?? []) as { item: string; billing: string }[];
  const mealPerItem = feeRows.some((f) => f.item === 'meal' && f.billing === 'per_item');
  let mealCounts: { perCell: Record<string, number>; perDay: Record<string, number>; total: number } | null = null;
  if (mealPerItem) {
    const perCell: Record<string, number> = {};
    const perDay: Record<string, number> = {};
    let total = 0;
    for (const r of regList) {
      if (r.status !== 'approved') continue;
      const meals = Array.isArray(r.selections?.meals) ? (r.selections!.meals as unknown[]) : [];
      for (const raw of meals) {
        if (typeof raw !== 'string') continue;
        const day = raw.split(':')[0];
        perCell[raw] = (perCell[raw] ?? 0) + 1;
        perDay[day] = (perDay[day] ?? 0) + 1;
        total++;
      }
    }
    mealCounts = { perCell, perDay, total };
  }

  const teamNeeds = ((needRows ?? []) as {
    team_id: string;
    needed: number;
    team: { name_cn: string } | { name_cn: string }[] | null;
  }[]).map((n) => {
    const team = Array.isArray(n.team) ? n.team[0] : n.team;
    return { team_id: n.team_id, name_cn: team?.name_cn ?? '', needed: n.needed, approved: approvedByTeam.get(n.team_id) ?? 0 };
  });

  return NextResponse.json({
    event,
    fees: fees ?? [],
    teamNeeds,
    mealSlots,
    mealCounts,
    regStats: {
      counts,
      approvedFeeSum: Math.round(approvedFeeSum * 100) / 100,
      payment: { paidSum: Math.round(paidSum * 100) / 100, verifiedCount, waivedCount, proofCount },
      checkedIn: checkedInCount ?? 0,
    },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireModuleAccess('events', 'edit');
  if (!access.ok) return gate401or403(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { data: current, error: curErr } = await supabaseAdmin.from('events').select('*').eq('id', id).maybeSingle();
  if (curErr) {
    console.error('[events] update pre-fetch failed:', curErr);
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ── core fields (code + status intentionally NOT patchable here) ──────────────
  const update: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return NextResponse.json({ error: '请填写活动名称' }, { status: 400 });
    update.title = title;
  }
  if (body.event_type !== undefined) {
    if (!(EVENT_TYPES as readonly string[]).includes(String(body.event_type))) {
      return NextResponse.json({ error: '活动类型无效' }, { status: 400 });
    }
    update.event_type = body.event_type;
  }
  if (body.organizing_centre_id !== undefined) {
    const cid = typeof body.organizing_centre_id === 'string' ? body.organizing_centre_id : '';
    const { data: c, error: cErr } = await supabaseAdmin.from('centres').select('id').eq('id', cid).maybeSingle();
    if (cErr || !c) return NextResponse.json({ error: '主办中心无效' }, { status: 400 });
    update.organizing_centre_id = cid;
  }
  if (body.starts_on !== undefined) {
    if (!isValidDate(body.starts_on)) return NextResponse.json({ error: '开始日期无效' }, { status: 400 });
    update.starts_on = body.starts_on;
  }
  if (body.ends_on !== undefined) {
    if (body.ends_on === null || body.ends_on === '') {
      update.ends_on = null;
    } else if (isValidDate(body.ends_on)) {
      update.ends_on = body.ends_on;
    } else {
      return NextResponse.json({ error: '结束日期无效' }, { status: 400 });
    }
  }
  // ends_on >= starts_on (effective values after this patch)
  const effStarts = (update.starts_on ?? current.starts_on) as string;
  const effEnds = ('ends_on' in update ? update.ends_on : current.ends_on) as string | null;
  if (effEnds && effStarts && effEnds < effStarts) {
    return NextResponse.json({ error: '结束日期不能早于开始日期' }, { status: 400 });
  }
  if (body.location !== undefined) update.location = typeof body.location === 'string' ? body.location.trim() || null : null;
  if (body.capacity !== undefined) {
    update.capacity = Number.isInteger(Number(body.capacity)) && Number(body.capacity) > 0 ? Number(body.capacity) : null;
  }
  if (body.reg_deadline !== undefined) update.reg_deadline = isValidDate(body.reg_deadline) ? body.reg_deadline : null;
  if (body.requires_approval !== undefined) update.requires_approval = body.requires_approval === true;
  if (body.reg_edit_cutoff_days !== undefined) {
    const n = Number(body.reg_edit_cutoff_days);
    if (!Number.isInteger(n) || n < 0) return NextResponse.json({ error: '选项修改截止天数无效（须为 ≥ 0 的整数）' }, { status: 400 });
    update.reg_edit_cutoff_days = n;
  }
  if (body.description !== undefined) update.description = typeof body.description === 'string' ? body.description.trim() || null : null;
  // Public self-registration (C1). Enabling for the first time mints an unguessable token
  // for /r/<token>; disabling KEEPS the token so re-enabling reuses the same URL/QR. Being
  // open is not enough — the public gate also requires enabled=true AND a token (see 018).
  if (body.public_registration_enabled !== undefined) {
    if (typeof body.public_registration_enabled !== 'boolean') {
      return NextResponse.json({ error: '公开报名开关无效' }, { status: 400 });
    }
    update.public_registration_enabled = body.public_registration_enabled;
    if (body.public_registration_enabled === true && !current.public_token) {
      update.public_token = randomBytes(12).toString('base64url'); // ~16 urlsafe chars
    }
  }
  if (body.co_centre_ids !== undefined) {
    update.co_centre_ids = Array.isArray(body.co_centre_ids)
      ? (body.co_centre_ids as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
  }

  // ── fees / needs desired sets ─────────────────────────────────────────────────
  const feesProvided = body.fees !== undefined;
  const needsProvided = body.team_needs !== undefined;
  const feesRes = feesProvided ? validateFees(body.fees) : { fees: [] as NormalizedFee[] };
  if ('error' in feesRes) return NextResponse.json({ error: feesRes.error }, { status: 400 });
  const needsRes = needsProvided ? validateNeeds(body.team_needs) : { needs: [] as NormalizedNeed[] };
  if ('error' in needsRes) return NextResponse.json({ error: needsRes.error }, { status: 400 });
  if (needsProvided && needsRes.needs.length) {
    const { data: teamRows } = await supabaseAdmin.from('teams').select('id').in('id', needsRes.needs.map((n) => n.team_id));
    const found = new Set((teamRows ?? []).map((t) => t.id));
    if (needsRes.needs.some((n) => !found.has(n.team_id))) return NextResponse.json({ error: '组别无效' }, { status: 400 });
  }

  const me = access.volunteer;

  // Apply the core update (always bump updated_at/by so the touch is recorded).
  const { data: updated, error: upErr } = await supabaseAdmin
    .from('events')
    .update({ ...update, updated_at: new Date().toISOString(), updated_by: me.id })
    .eq('id', id)
    .select('*')
    .single();
  if (upErr || !updated) {
    console.error('[events] core update failed:', upErr);
    return NextResponse.json({ error: '更新失败，请重试' }, { status: 500 });
  }

  // ── fee set-diff (deleting a fee NEVER rewrites past registrations' snapshots) ──
  let feesBefore: NormalizedFee[] = [];
  if (feesProvided) {
    const { data: existing } = await supabaseAdmin
      .from('event_fees')
      .select('item, label_cn, amount, billing, sort')
      .eq('event_id', id);
    feesBefore = ((existing ?? []) as NormalizedFee[]);
    const desired = feesRes.fees;
    const desiredItems = new Set(desired.map((f) => f.item));
    const existingByItem = new Map(feesBefore.map((f) => [f.item, f]));
    const toUpsert = desired.filter((f) => feeKey(existingByItem.get(f.item) ?? ({} as NormalizedFee)) !== feeKey(f));
    const toDelete = feesBefore.filter((f) => !desiredItems.has(f.item)).map((f) => f.item);
    if (toUpsert.length) {
      const { error } = await supabaseAdmin
        .from('event_fees')
        .upsert(toUpsert.map((f) => ({ ...f, event_id: id })), { onConflict: 'event_id,item' });
      if (error) { console.error('[events] fees upsert failed:', error); return NextResponse.json({ error: '更新收费失败' }, { status: 500 }); }
    }
    if (toDelete.length) {
      const { error } = await supabaseAdmin.from('event_fees').delete().eq('event_id', id).in('item', toDelete);
      if (error) { console.error('[events] fees delete failed:', error); return NextResponse.json({ error: '更新收费失败' }, { status: 500 }); }
    }
  }

  // ── need set-diff ──────────────────────────────────────────────────────────────
  let needsBefore: NormalizedNeed[] = [];
  if (needsProvided) {
    const { data: existing } = await supabaseAdmin.from('event_team_needs').select('team_id, needed').eq('event_id', id);
    needsBefore = ((existing ?? []) as NormalizedNeed[]);
    const desired = needsRes.needs;
    const desiredTeams = new Set(desired.map((n) => n.team_id));
    const existingByTeam = new Map(needsBefore.map((n) => [n.team_id, n]));
    const toUpsert = desired.filter((n) => needKey(existingByTeam.get(n.team_id) ?? ({} as NormalizedNeed)) !== needKey(n));
    const toDelete = needsBefore.filter((n) => !desiredTeams.has(n.team_id)).map((n) => n.team_id);
    if (toUpsert.length) {
      const { error } = await supabaseAdmin
        .from('event_team_needs')
        .upsert(toUpsert.map((n) => ({ ...n, event_id: id })), { onConflict: 'event_id,team_id' });
      if (error) { console.error('[events] needs upsert failed:', error); return NextResponse.json({ error: '更新组别需求失败' }, { status: 500 }); }
    }
    if (toDelete.length) {
      const { error } = await supabaseAdmin.from('event_team_needs').delete().eq('event_id', id).in('team_id', toDelete);
      if (error) { console.error('[events] needs delete failed:', error); return NextResponse.json({ error: '更新组别需求失败' }, { status: 500 }); }
    }
  }

  // ── meal-slot sync: regenerate the grid when dates change, apply kitchen toggles ──
  // Date-driven regeneration is covered by the starts_on/ends_on audit above; only an
  // EXPLICIT meal_slots payload (kitchen closed/opened cells) is audited here.
  const datesChanged = 'starts_on' in update || 'ends_on' in update;
  const slotsProvided = body.meal_slots !== undefined;
  const closedKeys = (rows: { slot_date: string; meal: string; offered: boolean }[]) =>
    rows.filter((r) => !r.offered).map((r) => `${r.slot_date}:${r.meal}`).sort();
  let slotsClosedBefore: string[] = [];
  let slotsClosedAfter: string[] = [];
  if (datesChanged || slotsProvided) {
    if (slotsProvided) {
      const { data } = await supabaseAdmin.from('event_meal_slots').select('slot_date, meal, offered').eq('event_id', id);
      slotsClosedBefore = closedKeys((data ?? []) as { slot_date: string; meal: string; offered: boolean }[]);
    }
    const { error } = await syncMealSlots(supabaseAdmin, id, effStarts, effEnds, normalizeSlotOverrides(body.meal_slots));
    if (error) { console.error('[events] meal-slot sync failed:', error); return NextResponse.json({ error: '更新餐点供应失败' }, { status: 500 }); }
    if (slotsProvided) {
      const { data } = await supabaseAdmin.from('event_meal_slots').select('slot_date, meal, offered').eq('event_id', id);
      slotsClosedAfter = closedKeys((data ?? []) as { slot_date: string; meal: string; offered: boolean }[]);
    }
  }

  // ── audit: changed core fields + before/after fee & need sets when they changed ─
  const cur = current as Record<string, unknown>;
  const nxt = updated as Record<string, unknown>;
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of Object.keys(update)) {
    if (JSON.stringify(cur[k]) !== JSON.stringify(nxt[k])) { before[k] = cur[k]; after[k] = nxt[k]; }
  }
  const norm = <T,>(a: T[], key: (x: T) => string) => a.map(key).sort();
  if (feesProvided && JSON.stringify(norm(feesBefore, feeKey)) !== JSON.stringify(norm(feesRes.fees, feeKey))) {
    before.fees = feesBefore;
    after.fees = feesRes.fees;
  }
  if (needsProvided && JSON.stringify(norm(needsBefore, needKey)) !== JSON.stringify(norm(needsRes.needs, needKey))) {
    before.needs = needsBefore;
    after.needs = needsRes.needs;
  }
  if (slotsProvided && JSON.stringify(slotsClosedBefore) !== JSON.stringify(slotsClosedAfter)) {
    before.meal_slots_closed = slotsClosedBefore;
    after.meal_slots_closed = slotsClosedAfter;
  }
  if (Object.keys(after).length > 0) {
    await writeAudit({
      actorId: me.id,
      actorEmail: me.email,
      module: 'events',
      action: 'update',
      tableName: 'events',
      recordId: id,
      before,
      after,
    });
  }

  return NextResponse.json({ event: updated, fees: feesProvided ? feesRes.fees : undefined, team_needs: needsProvided ? needsRes.needs : undefined });
}
