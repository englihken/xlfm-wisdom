// src/app/dashboard/layout.tsx
// Dashboard-wide locale seam — the AUTHORITATIVE per-user locale boundary. The
// browser-global NEXT_LOCALE cookie must NEVER decide the dashboard language.
//
// Two layers, both session-driven, so the cookie never leaks the previous user's
// language onto the dashboard:
//  1. SERVER SEED — getDashboardLocale() resolves the signed-in volunteer's
//     volunteers.locale (the SAME active-volunteer row /api/dashboard/me uses) and
//     seeds a NESTED I18nProvider, so a hard load's first paint is already correct.
//  2. CLIENT CORRECTION — LocaleFromSession fetches /api/dashboard/me (a Route
//     Handler, where the session always resolves) and pushes that locale into the
//     provider + mirrors it to the cookie. This wins even when the server seed can't
//     see the session (e.g. after a client-side login navigation, where this shared
//     layout does not re-run). It reads the SESSION, never the cookie → the cookie is
//     only ever a downstream mirror, never an input to the dashboard provider.
// The login page ALSO sets the provider+cookie the moment it resolves /me, so the
// login→home client transition lands in the user's language with no flash.

import { I18nProvider, LocaleFromSession } from '@/lib/i18n-react';
import { getDashboardLocale } from '@/lib/i18n-server';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const locale = await getDashboardLocale();
  return (
    <I18nProvider initialLocale={locale}>
      <LocaleFromSession />
      {children}
    </I18nProvider>
  );
}
