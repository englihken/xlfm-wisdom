// src/app/dashboard/layout.tsx
// Dashboard-wide locale seam — the AUTHORITATIVE per-user locale boundary.
//
// The shared NEXT_LOCALE cookie is browser-global, so on a shared machine it can
// hold the PREVIOUS user's language. This layout therefore resolves the locale from
// the SESSION (getDashboardLocale → the signed-in volunteer's volunteers.locale)
// server-side and seeds a NESTED I18nProvider with it, so the dashboard's very first
// paint is already the logged-in user's language — no cookie-driven flash (fixes the
// shared-browser bleed where user B saw user A's language). SyncLocaleCookie then
// mirrors that locale into the cookie so any public page opened next stays in sync.
// Anonymous callers (no session) fall back to the cookie inside getDashboardLocale.

import { I18nProvider, SyncLocaleCookie } from '@/lib/i18n-react';
import { getDashboardLocale } from '@/lib/i18n-server';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const locale = await getDashboardLocale();
  return (
    <I18nProvider initialLocale={locale}>
      <SyncLocaleCookie locale={locale} />
      {children}
    </I18nProvider>
  );
}
