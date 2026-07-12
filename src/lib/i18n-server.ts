// src/lib/i18n-server.ts
// Server-side locale resolution (server components + API routes). Reads the
// NEXT_LOCALE cookie so public pages render SSR in the right language with no
// flash. The dashboard's durable per-user preference lives in volunteers.locale
// and is mirrored into this cookie on login/switch, so this single cookie is a
// correct SSR seed for BOTH surfaces. Import ONLY from server code (uses
// next/headers); client code uses the hooks in i18n-react.tsx.

import { cookies } from 'next/headers';
import { createT, LOCALE_COOKIE, toLocale, type Locale, type TFunc } from './i18n';
import { getActiveVolunteer } from './supabase-server';
import { supabaseAdmin } from './supabase';

// The NEXT_LOCALE cookie is BROWSER-GLOBAL — correct only for anonymous/public
// surfaces (public pages + the language pill). It must NEVER decide the dashboard
// language: on a shared browser it holds whoever was here last. The dashboard's
// authoritative source is the signed-in volunteer's volunteers.locale (below).
export async function getRequestLocale(): Promise<Locale> {
  try {
    const jar = await cookies();
    return toLocale(jar.get(LOCALE_COOKIE)?.value);
  } catch {
    return 'zh';
  }
}

// Bound translator for the request COOKIE locale — anonymous/public surfaces only.
export async function getServerT(): Promise<TFunc> {
  return createT(await getRequestLocale());
}

// Read one volunteer's saved UI locale (volunteers.locale, migration 034). Falls
// back to the cookie on a genuine miss, but WARNS first so a lookup miss is never
// silent again (the previous silent fallback hid this exact bug).
export async function getVolunteerLocale(volunteerId: string): Promise<Locale> {
  if (!supabaseAdmin) return getRequestLocale();
  const { data, error } = await supabaseAdmin
    .from('volunteers')
    .select('locale')
    .eq('id', volunteerId)
    .maybeSingle();
  if (!error && isLocaleValue(data?.locale)) return data.locale;
  console.warn(
    `[i18n] volunteer ${volunteerId} locale unresolved (locale=${JSON.stringify(data?.locale)}${error ? `, error=${error.message}` : ''}) — falling back to cookie`
  );
  return getRequestLocale();
}

// AUTHORITATIVE dashboard/session locale. Resolves the SAME active-volunteer row
// that /api/dashboard/me uses (getActiveVolunteer → volunteers by auth id) and reads
// its locale. ONLY a genuinely anonymous caller (no active session) falls back to the
// browser cookie. Used to seed the dashboard provider (server) AND to localize every
// dashboard-facing API route (never getRequestLocale for those).
export async function getSessionLocale(): Promise<Locale> {
  try {
    const access = await getActiveVolunteer();
    if (access) return await getVolunteerLocale(access.volunteer.id);
  } catch (e) {
    // cookies()/auth throw Next's DynamicServerError during the build's static probe
    // to opt the route into dynamic rendering — let that propagate (it's not a real
    // locale-resolution failure and must not be swallowed or it pollutes the warn).
    if (isDynamicServerError(e)) throw e;
    console.warn('[i18n] getSessionLocale failed — falling back to cookie', e);
  }
  return getRequestLocale(); // anonymous / no active volunteer
}

function isDynamicServerError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { digest?: unknown }).digest === 'DYNAMIC_SERVER_USAGE'
  );
}

// Bound translator for the signed-in volunteer — use in dashboard-facing API routes.
export async function getSessionT(): Promise<TFunc> {
  return createT(await getSessionLocale());
}

// The dashboard server-component seed IS the session locale.
export const getDashboardLocale = getSessionLocale;

function isLocaleValue(v: unknown): v is Locale {
  return v === 'zh' || v === 'en' || v === 'id';
}
