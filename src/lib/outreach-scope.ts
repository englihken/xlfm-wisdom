// src/lib/outreach-scope.ts
// Server-side centre-scope wall for the 渡人 routes — mirrors the finance pattern
// (financeScope/enforceScope). The outreach routes run as service-role (bypassing RLS), so this
// check IS the wall. all_centers accounts see every centre's 善缘 (incl. the national chat pool
// where centre_id IS NULL); a locked own_center account sees ONLY contacts whose centre_id equals
// its own centre — NULL-centre contacts are invisible to it, and its centre picker is pinned.
//
// Which roles are national: admin / erp_admin / committee / 关怀义工(volunteer). The future
// 分会负责人 (own_center) role is deliberately NOT in this set, so it locks the day it exists —
// today there are no own_center outreach accounts, so nothing changes for current users.

import type { SupabaseClient } from '@supabase/supabase-js';

export type OutreachScope = { centreId: string | null; locked: boolean };

const NATIONAL_ROLES = new Set(['admin', 'erp_admin', 'committee', 'volunteer']);

export async function outreachScope(db: SupabaseClient, volunteerId: string): Promise<OutreachScope> {
  const { data } = await db.from('volunteers').select('scope, centre_id, role').eq('id', volunteerId).maybeSingle();
  const scope = (data?.scope as string | undefined) ?? 'own_center';
  const role = (data?.role as string | undefined) ?? 'volunteer';
  const allCentres = scope === 'all_centers' || NATIONAL_ROLES.has(role);
  if (allCentres) return { centreId: null, locked: false };
  return { centreId: (data?.centre_id as string | null) ?? null, locked: true };
}

// May a locked account touch a contact with this centre_id? all_centers → always; locked → only
// its own centre (NULL-centre contacts are never visible to a locked account).
export function scopeAllowsContact(scope: OutreachScope, contactCentreId: string | null | undefined): boolean {
  if (!scope.locked) return true;
  return contactCentreId != null && contactCentreId === scope.centreId;
}
