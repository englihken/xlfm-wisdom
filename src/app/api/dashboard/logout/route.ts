// src/app/api/dashboard/logout/route.ts
// Server-side sign-out. The auth session lives in httpOnly cookies written/refreshed by the
// @supabase/ssr SERVER client — the browser client cannot read or clear them, so a client-only
// supabase.auth.signOut() fires nothing and the session survives (E2 logout bug). This route
// runs signOut() through the server client, whose cookie adapter expires the sb-* cookies, and
// belt-and-braces deletes any lingering auth cookies. Idempotent; always returns ok.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut(); // clears the httpOnly auth cookies via the server cookie adapter
  } catch (e) {
    console.error('[logout] server signOut failed (clearing cookies anyway):', e);
  }
  // Belt-and-braces: expire any remaining Supabase auth cookies (sb-*-auth-token, chunked …).
  try {
    const store = await cookies();
    for (const c of store.getAll()) {
      if (c.name.startsWith('sb-')) store.delete(c.name);
    }
  } catch (e) {
    console.error('[logout] cookie cleanup failed:', e);
  }
  return NextResponse.json({ ok: true });
}
