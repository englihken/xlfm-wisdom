// src/lib/event-slots.ts
// Server-side lifecycle for event_meal_slots (the kitchen's per-day-per-meal offering
// grid). Kept out of the route files so create (POST) and edit (PATCH) share the same
// idempotent sync. Service-role only — never import into a client component.

import type { SupabaseClient } from '@supabase/supabase-js';
import { MEALS, datesInRange, mealSlotKey } from '@/lib/events';

type Db = SupabaseClient;

export type SlotOverride = { slot_date: string; meal: string; offered: boolean };

// Parse a body.meal_slots payload into a key→offered map (invalid meals dropped). Dates
// outside the event range are ignored by syncMealSlots, so no range check needed here.
export function normalizeSlotOverrides(raw: unknown): Map<string, boolean> {
  const out = new Map<string, boolean>();
  if (!Array.isArray(raw)) return out;
  for (const r of raw as Record<string, unknown>[]) {
    const date = typeof r?.slot_date === 'string' ? r.slot_date : '';
    const meal = typeof r?.meal === 'string' ? r.meal : '';
    if (!date || !(MEALS as readonly string[]).includes(meal)) continue;
    out.set(mealSlotKey(date, meal), r.offered !== false); // default offered=true
  }
  return out;
}

// Reconcile the slot grid to [startsOn, endsOn] × MEALS. offered = override, else the
// existing flag (PRESERVED for dates that remain), else true. Slots outside the new range
// are deleted. Idempotent: safe to call on create, on a date change, or on a toggle-only
// edit. Returns { error } on the first failing write, else {}.
export async function syncMealSlots(
  db: Db,
  eventId: string,
  startsOn: string,
  endsOn: string | null,
  overrides: Map<string, boolean>
): Promise<{ error?: string }> {
  const dates = datesInRange(startsOn, endsOn);
  const targetKeys = new Set<string>();
  for (const d of dates) for (const m of MEALS) targetKeys.add(mealSlotKey(d, m));

  const { data: existing, error: exErr } = await db
    .from('event_meal_slots')
    .select('slot_date, meal, offered')
    .eq('event_id', eventId);
  if (exErr) return { error: exErr.message };

  const existingOffered = new Map<string, boolean>();
  for (const s of (existing ?? []) as { slot_date: string; meal: string; offered: boolean }[]) {
    existingOffered.set(mealSlotKey(s.slot_date, s.meal), s.offered);
  }

  const rows: { event_id: string; slot_date: string; meal: string; offered: boolean }[] = [];
  for (const d of dates) {
    for (const m of MEALS) {
      const key = mealSlotKey(d, m);
      const offered = overrides.has(key) ? (overrides.get(key) as boolean) : existingOffered.get(key) ?? true;
      rows.push({ event_id: eventId, slot_date: d, meal: m, offered });
    }
  }

  if (rows.length) {
    const { error } = await db.from('event_meal_slots').upsert(rows, { onConflict: 'event_id,slot_date,meal' });
    if (error) return { error: error.message };
  }

  // Delete slots for dates no longer in range (existing keys not in the target grid).
  const stale = [...existingOffered.keys()].filter((k) => !targetKeys.has(k));
  if (stale.length) {
    const staleDates = [...new Set(stale.map((k) => k.split(':')[0]))];
    const { error } = await db.from('event_meal_slots').delete().eq('event_id', eventId).in('slot_date', staleDates);
    if (error) return { error: error.message };
  }
  return {};
}

// The set of OFFERED slot keys ('YYYY-MM-DD:meal') for an event — used to validate that
// submitted selections.meals reference cells the kitchen actually offers.
export async function fetchOfferedKeys(db: Db, eventId: string): Promise<Set<string>> {
  const { data } = await db
    .from('event_meal_slots')
    .select('slot_date, meal, offered')
    .eq('event_id', eventId)
    .eq('offered', true);
  const set = new Set<string>();
  for (const s of (data ?? []) as { slot_date: string; meal: string }[]) set.add(mealSlotKey(s.slot_date, s.meal));
  return set;
}

// Which of the given meal keys are NOT offered slots (empty = all valid).
export function invalidMealKeys(keys: string[], offered: Set<string>): string[] {
  return keys.filter((k) => !offered.has(k));
}
