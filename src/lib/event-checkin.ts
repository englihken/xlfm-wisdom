// src/lib/event-checkin.ts
// Server-side helpers for 活动签到 (event check-in, Phase 1).
//
// THE SCOPE WALL. These routes run as service-role and bypass RLS, so the
// app-level check here IS the boundary. Unlike every other events route — which
// compares organizing_centre_id ONLY — check-in also honours co_centre_ids: a
// joint 法会 is staffed by volunteers from every hosting centre, and the desk
// must work for all of them. That is NEW behaviour, deliberately scoped to
// check-in; no other events wall was changed.
//
// The checkin_token is a LOOKUP KEY, not a credential: it names a registration
// and grants nothing. Write authority is the scanning volunteer's session plus
// the wall below — which is exactly why there is no self-serve check-in path.

import type { EventsScope } from './members-scope';

// 64 hex chars, as backfilled by migration 041. Shape-checked before it reaches a
// query so a malformed scan is a cheap 400, never a DB round trip.
export const CHECKIN_TOKEN_RE = /^[0-9a-f]{64}$/i;

export const CHECKIN_METHODS = ['qr', 'search', 'walkin'] as const;
export type CheckinMethod = (typeof CHECKIN_METHODS)[number];

export type EventCentres = {
  organizing_centre_id: string | null;
  co_centre_ids: string[] | null;
};

// Every centre that co-hosts this event. Duplicates and nulls are dropped so a
// sloppy co_centre_ids array cannot widen or break the comparison.
export function hostingCentreIds(ev: EventCentres): string[] {
  const ids = [ev.organizing_centre_id, ...(ev.co_centre_ids ?? [])];
  return [...new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0))];
}

// May this caller run the check-in desk for this event?
// Unlocked (admin / erp_admin / committee, or an explicit all_centers scope) → yes.
// Locked → only if their centre hosts or co-hosts it. A caller with no centre
// bound fails closed.
export function mayRunCheckin(scope: EventsScope, ev: EventCentres): boolean {
  if (!scope.locked) return true;
  if (!scope.centreId) return false;
  return hostingCentreIds(ev).includes(scope.centreId);
}

// Postgres unique_violation. The partial unique index
// event_attendance_reg_uniq (event_id, registration_id) WHERE registration_id
// IS NOT NULL AND voided_at IS NULL is what makes check-in idempotent under a
// double-tap or two desks scanning the same person at once; hitting it is the
// NORMAL "already checked in" path, not an error.
export const PG_UNIQUE_VIOLATION = '23505';

// A walk-in must carry no registration_id and a real name — mirrors the DB's
// ea_walkin_shape CHECK so a bad payload gets a friendly message instead of a
// constraint error.
export function validWalkinName(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 120;
}
