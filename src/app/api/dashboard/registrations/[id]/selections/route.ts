// src/app/api/dashboard/registrations/[id]/selections/route.ts
// PATCH — edit a registration's selections (events:edit). C0's approved exception to the
// otherwise-immutable snapshot: a registrant's picks may change (esp. the meal grid) up
// to a cutoff. Allowed only while status is pending|approved AND today is before
// starts_on − reg_edit_cutoff_days. Recomputes fee_total + fee_breakdown from the event's
// CURRENT fees (a fresh snapshot), validates meal keys ⊆ offered slots, and audits the
// before/after {selections, fee_total}. No status change, no reg_no change, no delete.
// Unknown selections namespaces on the stored row (e.g. import813) are PRESERVED —
// only the known fee keys are rebuilt from the submission.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { computeFees, parseSelections, type FeeItem } from '@/lib/event-fees';
import { fetchOfferedKeys, invalidMealKeys } from '@/lib/event-slots';
import { regEditOpen, todayMYT } from '@/lib/events';

export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireModuleAccess('events', 'edit');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { selections?: unknown } | null;
  if (!body || typeof body !== 'object' || body.selections === undefined) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Load the registration + its event (dates + cutoff + fees drive validation).
  const { data: reg, error: regErr } = await supabaseAdmin
    .from('registrations')
    .select('id, event_id, status, selections, fee_total')
    .eq('id', id)
    .maybeSingle();
  if (regErr) {
    console.error('[selections] registration fetch failed:', regErr);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
  if (!reg) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!['pending', 'approved'].includes(reg.status)) {
    return NextResponse.json({ error: '只有待处理或已批准的报名可以修改选项' }, { status: 400 });
  }

  const { data: event } = await supabaseAdmin
    .from('events')
    .select('id, starts_on, reg_edit_cutoff_days')
    .eq('id', reg.event_id)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: '活动不存在' }, { status: 404 });

  const cutoffDays = Number(event.reg_edit_cutoff_days) || 0;
  if (!regEditOpen(event.starts_on as string, cutoffDays, todayMYT())) {
    return NextResponse.json({ error: `选项已锁定（活动开始前 ${cutoffDays} 天截止修改）` }, { status: 400 });
  }

  // Parse + recompute against the event's CURRENT fees (a fresh snapshot).
  const selections = parseSelections(body.selections);
  const { data: feeRows } = await supabaseAdmin.from('event_fees').select('item, label_cn, amount, billing').eq('event_id', reg.event_id);
  const fees = ((feeRows ?? []) as { item: string; label_cn: string | null; amount: number; billing: string }[]).map(
    (f) => ({ item: f.item, label_cn: f.label_cn, amount: Number(f.amount), billing: f.billing }) as FeeItem
  );

  const mealPerItem = fees.some((f) => f.item === 'meal' && f.billing === 'per_item');
  if (mealPerItem && selections.meals?.length) {
    const offered = await fetchOfferedKeys(supabaseAdmin, reg.event_id);
    const bad = invalidMealKeys(selections.meals, offered);
    if (bad.length) return NextResponse.json({ error: `餐点选项无效（未供应）：${bad.join('、')}` }, { status: 400 });
  } else if (!mealPerItem) {
    delete selections.meals;
  }

  const { total, breakdown } = computeFees(fees, selections);
  const me = access.volunteer;

  // Preserve unknown namespaces on the stored row (e.g. selections.import813 from the
  // 813 event import): the edit dialog only round-trips the known fee keys, so anything
  // else must survive the rebuild. Known keys always come from the fresh parse; unknown
  // keys in the INCOMING body stay dropped (parseSelections), exactly as before.
  const KNOWN_KEYS = new Set(['meal_days', 'meals', 'nights', 'transfer', 'uniform', 'other_qty']);
  const preserved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries((reg.selections ?? {}) as Record<string, unknown>)) {
    if (!KNOWN_KEYS.has(k)) preserved[k] = v;
  }
  const nextSelections = { ...preserved, ...selections };

  const { data: updated, error } = await supabaseAdmin
    .from('registrations')
    .update({
      selections: nextSelections,
      fee_total: total,
      fee_breakdown: breakdown,
      updated_at: new Date().toISOString(),
      updated_by: me.id,
    })
    .eq('id', id)
    .select('id, selections, fee_total, fee_breakdown, status')
    .single();
  if (error || !updated) {
    console.error('[selections] update failed:', error);
    return NextResponse.json({ error: '保存失败，请重试' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'events',
    action: 'update',
    tableName: 'registrations',
    recordId: id,
    before: { selections: reg.selections ?? {}, fee_total: Number(reg.fee_total) || 0 },
    after: { selections: nextSelections, fee_total: total },
  });

  return NextResponse.json({ registration: updated });
}
