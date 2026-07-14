import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabase';
import { ACCESS_RANK, type ModuleKey, type AccessLevel } from './access';

// Re-export the permission vocabulary (now sourced from the client-safe ./access
// module) so existing importers of these from '@/lib/supabase-server' keep working.
export { ACCESS_RANK };
export type { ModuleKey, AccessLevel };

// Server-side Supabase client bound to the request's cookies, using the public
// ANON key. Its ONLY job here is to read the logged-in volunteer's auth session
// from cookies (set by the browser client on login) — NOT to query data. Data
// access goes through supabaseAdmin (service role) in ./supabase.ts after the
// session has been verified. Must be called from a Route Handler or Server
// Component (it awaits next/headers cookies()).
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Supabase may rotate the auth token and write refreshed cookies.
          // Writable in Route Handlers; ignore if called where cookies are
          // read-only (e.g. a Server Component render pass).
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            /* read-only context — safe to ignore */
          }
        },
      },
    }
  );
}

// Returns the logged-in volunteer, or null if there is no valid session.
// Dashboard API routes call this first and return 401 when it is null, giving a
// session check on top of RLS (defense in depth).
export async function getAuthenticatedUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

// Platform roles across both wings (widened in migrations/013; 030 added centre_head —
// the DB CHECK on volunteers.role now permits these values).
export type Role = 'admin' | 'volunteer' | 'erp_admin' | 'committee' | 'centre_head';

// A row from the `volunteers` table (migrations/006). `role` gates admin-only
// features; `active` gates dashboard access. scope/centre_id/locale ride along on
// the SAME single read (perf: Sydney round trips are expensive) so the scope
// resolvers and locale helpers never re-query volunteers within a request.
export type Volunteer = {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  active: boolean;
  must_change_password: boolean;
  scope: 'all_centers' | 'own_center' | null;
  centre_id: string | null;
  locale: string | null;
};

const VOLUNTEER_SELECT =
  'id, email, display_name, role, active, must_change_password, scope, centre_id, locale';

// Returns the logged-in user together with their volunteers row, but ONLY when
// that row exists and is active — otherwise null. This is the role-aware gate for
// the dashboard: routes distinguish 401 (no session) from 403 (logged in but not
// an active volunteer) by checking getAuthenticatedUser() first, then this.
export async function getActiveVolunteer(): Promise<
  { user: User; volunteer: Volunteer } | null
> {
  const user = await getAuthenticatedUser();
  if (!user) return null;
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from('volunteers')
    .select(VOLUNTEER_SELECT)
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[auth] volunteer lookup failed:', error);
    return null;
  }
  if (!data || !data.active) return null;

  return { user, volunteer: data as Volunteer };
}

// Module-permission gate for API routes. Returns the caller's user + volunteer when
// they hold at least `min` access to `module` per the DB-only grant matrix
// (public.role_grants, migrations/013); otherwise a discriminated failure with the
// HTTP status the route should return:
//   401 — no active volunteer session (no login, or inactive/missing volunteer row)
//   403 — active account, but insufficient (or no) grant for this module
// Grants live in the database ONLY — there is deliberately no hardcoded TS fallback
// matrix, so the SQL seed in 013 is the single source of truth.
export async function requireModuleAccess(
  module: ModuleKey,
  min: AccessLevel
): Promise<{ ok: true; user: User; volunteer: Volunteer } | { ok: false; status: 401 | 403 }> {
  const user = await getAuthenticatedUser();
  if (!user || !supabaseAdmin) return { ok: false, status: 401 };

  // PERF: the volunteers row and the module's grant rows don't depend on each
  // other, so fetch them in ONE parallel round trip instead of two serial ones
  // (role_grants per module is ≤ a handful of rows; the caller's grant is picked
  // out in JS). Semantics identical: missing/inactive volunteer → 401, missing
  // grant → 'none' → 403 when below `min`.
  const [volRes, grantsRes] = await Promise.all([
    supabaseAdmin.from('volunteers').select(VOLUNTEER_SELECT).eq('id', user.id).maybeSingle(),
    supabaseAdmin.from('role_grants').select('role, access').eq('module', module),
  ]);

  if (volRes.error) {
    console.error('[auth] volunteer lookup failed:', volRes.error);
    return { ok: false, status: 401 };
  }
  const volunteer = volRes.data as Volunteer | null;
  if (!volunteer || !volunteer.active) return { ok: false, status: 401 };

  const grantRow = (grantsRes.data ?? []).find((g) => g.role === volunteer.role);
  const granted = ((grantRow?.access as AccessLevel | undefined) ?? 'none') as AccessLevel;
  if (ACCESS_RANK[granted] < ACCESS_RANK[min]) {
    return { ok: false, status: 403 };
  }

  return { ok: true, user, volunteer };
}
