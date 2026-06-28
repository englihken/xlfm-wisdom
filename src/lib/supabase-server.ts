import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';

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
