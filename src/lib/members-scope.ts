// src/lib/members-scope.ts
// Server-side centre-scope wall for the 会员 (members) and 活动 (events/registrations)
// routes — the third instance of the finance/outreach pattern (financeScope /
// outreachScope). These routes run as service-role (bypassing RLS), so this resolver
// IS the wall: an own_center account (centre_head) may only see its own centre's
// members, events, and registrations. The client's ?centre= param can only NARROW
// within that scope, never widen it.
//
// Fail-CLOSED by design: if the volunteers read errors (or the row is missing), the
// caller is treated as locked with NO centre — sees nothing — never as national.

import type { SupabaseClient } from '@supabase/supabase-js';

export type MembersScope = { centreId: string | null; locked: boolean };

// Roles that are national for members/events. centre_head is deliberately absent
// (locks the day it exists). 'volunteer' (care) holds no members/events grant at
// all, so leaving it out costs nothing and stays fail-closed.
const NATIONAL_ROLES = new Set(['admin', 'erp_admin', 'committee']);

export async function membersScope(db: SupabaseClient, volunteerId: string): Promise<MembersScope> {
  const { data, error } = await db
    .from('volunteers')
    .select('scope, centre_id, role')
    .eq('id', volunteerId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error('[members-scope] volunteer read failed — failing closed:', error);
    return { centreId: null, locked: true };
  }
  const scope = (data.scope as string | undefined) ?? 'own_center';
  const role = (data.role as string | undefined) ?? 'volunteer';
  const allCentres = scope === 'all_centers' || NATIONAL_ROLES.has(role);
  if (allCentres) return { centreId: null, locked: false };
  return { centreId: (data.centre_id as string | null) ?? null, locked: true };
}

// The events/registrations wall is the same resolver — one scope, two module names.
export const eventsScope = membersScope;
