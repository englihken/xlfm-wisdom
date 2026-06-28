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
