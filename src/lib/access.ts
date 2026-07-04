// src/lib/access.ts
// Client-safe module-permission vocabulary, shared by the server auth layer
// (supabase-server.ts / migrations 013) and client components (nav, pages). Pure
// types + a rank map + a grant check — NO server-only imports (no next/headers), so
// it is safe to import from 'use client' components.

export type ModuleKey = 'care' | 'members' | 'events' | 'finance' | 'duty' | 'settings' | 'audit';
export type AccessLevel = 'none' | 'summary' | 'view' | 'edit' | 'admin';

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
