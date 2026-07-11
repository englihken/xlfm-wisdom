// src/lib/i18n-server.ts
// Server-side locale resolution (server components + API routes). Reads the
// NEXT_LOCALE cookie so public pages render SSR in the right language with no
// flash. The dashboard's durable per-user preference lives in volunteers.locale
// and is mirrored into this cookie on login/switch, so this single cookie is a
// correct SSR seed for BOTH surfaces. Import ONLY from server code (uses
// next/headers); client code uses the hooks in i18n-react.tsx.

import { cookies } from 'next/headers';
import { createT, LOCALE_COOKIE, toLocale, type Locale, type TFunc } from './i18n';

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
