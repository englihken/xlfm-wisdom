// src/lib/access.ts
// Client-safe module-permission vocabulary, shared by the server auth layer
// (supabase-server.ts / migrations 013) and client components (nav, pages). Pure
// types + a rank map + a grant check — NO server-only imports (no next/headers), so
// it is safe to import from 'use client' components.

export type ModuleKey =
  | 'care'
  | 'members'
  | 'events'
  | 'finance'
  | 'duty'
  | 'inventory'
  | 'reports'
  | 'settings'
  | 'audit';
export type AccessLevel = 'none' | 'summary' | 'view' | 'edit' | 'admin';

// The second permission dimension (migrations/015). all_centers = platform-wide;
// own_center = only the volunteer's own centre_id (fail-closed default).
export type CentreScope = 'all_centers' | 'own_center';

// Mirrors public.access_rank() in SQL. Higher = more capable.
export const ACCESS_RANK: Record<AccessLevel, number> = {
  none: 0,
  summary: 1,
  view: 2,
  edit: 3,
  admin: 4,
};

// The caller's granted access level per module (only granted modules are present),
// as returned by /api/dashboard/me under `grants`.
export type Grants = Partial<Record<ModuleKey, AccessLevel>>;

// Does the grant set clear the bar for (module, min)?
export function grantAllows(
  grants: Grants | undefined,
  module: ModuleKey,
  min: AccessLevel
): boolean {
  const level = grants?.[module] ?? 'none';
  return ACCESS_RANK[level] >= ACCESS_RANK[min];
}

// A "door" the caller can enter — a module page with a real destination. The care
// door is the inbox at /dashboard. (Hub 'home' is not a door — it's the chooser.)
export type ModuleDoor = 'inbox' | 'members' | 'events' | 'inventory' | 'reports' | 'settings';

// THE single source of truth for door visibility, used by BOTH the nav rail and the
// hub. Returns only the doors the caller can actually enter, in display order.
// NEVER emit a door the caller can't open (privacy rule). Grows as modules ship.
export function visibleModules(me: { role: string; grants?: Grants }): ModuleDoor[] {
  const doors: ModuleDoor[] = [];
  if (grantAllows(me.grants, 'care', 'view')) doors.push('inbox'); // 人文关怀 → /dashboard
  if (grantAllows(me.grants, 'members', 'view')) doors.push('members');
  if (grantAllows(me.grants, 'events', 'view')) doors.push('events'); // 活动 → /dashboard/events
  if (grantAllows(me.grants, 'inventory', 'view')) doors.push('inventory'); // 库存 → /dashboard/inventory
  if (me.role === 'admin') doors.push('reports'); // care analytics — admin-only for now
  if (me.role === 'admin') doors.push('settings'); // account mgmt — admin-only until A6
  return doors;
}
