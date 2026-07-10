import { createBrowserClient } from '@supabase/ssr';

// Browser-side Supabase client using the public ANON key. Safe to use in
// client components — it respects Row Level Security (unlike supabaseAdmin in
// ./supabase.ts, which uses the service-role key and must stay server-only).
// Used for volunteer auth (sign in / get user / sign out) on the dashboard.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Sign out reliably. The session lives in httpOnly cookies owned by the SERVER client, so a
// client-only signOut() is a no-op (fires no request, session persists — the E2 logout bug).
// We hit the server logout route (which clears those cookies) and also run the client signOut
// best-effort to drop any non-httpOnly remnants. Callers should router.replace('/dashboard/login')
// afterwards. Never throws.
export async function signOutEverywhere(): Promise<void> {
  try {
    await createSupabaseBrowserClient().auth.signOut();
  } catch {
    /* client had no readable session — expected when cookies are httpOnly */
  }
  try {
    await fetch('/api/dashboard/logout', { method: 'POST' });
  } catch {
    /* best-effort; the redirect + server gate still protect the app */
  }
}
