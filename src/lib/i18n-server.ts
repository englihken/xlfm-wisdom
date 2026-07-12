// src/lib/i18n-server.ts
// Server-side locale resolution (server components + API routes). Reads the
// NEXT_LOCALE cookie so public pages render SSR in the right language with no
// flash. The dashboard's durable per-user preference lives in volunteers.locale
// and is mirrored into this cookie on login/switch, so this single cookie is a
// correct SSR seed for BOTH surfaces. Import ONLY from server code (uses
// next/headers); client code uses the hooks in i18n-react.tsx.

import { cookies } from 'next/headers';
import { createT, LOCALE_COOKIE, toLocale, type Locale, type TFunc } from './i18n';
import { getAuthenticatedUser } from './supabase-server';
import { supabaseAdmin } from './supabase';

export async function getRequestLocale(): Promise<Locale> {
  try {
    const jar = await cookies();
    return toLocale(jar.get(LOCALE_COOKIE)?.value);
  } catch {
    return 'zh';
  }
}

// Bound translator for the current request's locale.
export async function getServerT(): Promise<TFunc> {
  return createT(await getRequestLocale());
}

// AUTHORITATIVE dashboard locale (fixes shared-browser bleed). The NEXT_LOCALE
// cookie is browser-global, so on a shared machine it may hold the PREVIOUS user's
// language — never trust it to seed a signed-in dashboard. Instead resolve from the
// SESSION: the logged-in volunteer's own volunteers.locale. Only when there is no
// valid session (anonymous) do we fall back to the cookie. Any DB hiccup falls back
// to the cookie too, so this can never throw during a dashboard render.
export async function getDashboardLocale(): Promise<Locale> {
  try {
    const user = await getAuthenticatedUser();
    if (user && supabaseAdmin) {
      const { data } = await supabaseAdmin
        .from('volunteers')
        .select('locale, active')
        .eq('id', user.id)
        .maybeSingle();
      if (data?.active && isLocaleValue(data.locale)) return data.locale;
    }
  } catch {
    /* fall through to the cookie */
  }
  return getRequestLocale();
}

function isLocaleValue(v: unknown): v is Locale {
  return v === 'zh' || v === 'en' || v === 'id';
}
