// src/lib/members-scope.ts
// Server-side centre-scope wall for the 会员 (members) and 活动 (events/registrations)
// routes — the third instance of the finance/outreach pattern (financeScope /
// outreachScope). These routes run as service-role (bypassing RLS), so this resolver
// IS the wall: an own_center account (centre_head) may only see its own centre's
// members, events, and registrations. The client's ?centre= param can only NARROW
// within that scope, never widen it.
//
// PERF: the resolver is now SYNCHRONOUS — it reads the volunteer row that
// requireModuleAccess already fetched this request (scope/centre_id/role ride on the
// same select), so no second volunteers round trip. Fail-CLOSED as before: a missing
// row (never expected — the gate 401s first) is treated as locked with NO centre.

export type MembersScope = { centreId: string | null; locked: boolean };

// The columns the resolver needs from the per-request volunteer row.
export type VolunteerScopeRow = {
  role: string | null;
  scope: string | null;
  centre_id: string | null;
};

// Roles that are national for members/events. centre_head is deliberately absent
// (locks the day it exists). 'volunteer' (care) holds no members/events grant at
// all, so leaving it out costs nothing and stays fail-closed.
const NATIONAL_ROLES = new Set(['admin', 'erp_admin', 'committee']);

export function membersScope(v: VolunteerScopeRow | null | undefined): MembersScope {
  if (!v) return { centreId: null, locked: true }; // fail closed
  const scope = v.scope ?? 'own_center';
  const role = v.role ?? 'volunteer';
  const allCentres = scope === 'all_centers' || NATIONAL_ROLES.has(role);
  if (allCentres) return { centreId: null, locked: false };
  return { centreId: v.centre_id ?? null, locked: true };
}

// The events/registrations wall is the same resolver — one scope, two module names.
export const eventsScope = membersScope;
