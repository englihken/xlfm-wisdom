// src/app/dashboard/layout.tsx
// Dashboard-wide locale seam. There is no server layout for /dashboard/* (each page
// runs its own client auth gate), so this thin client layout mounts once and keeps
// the whole dashboard in the SESSION volunteer's saved locale (volunteers.locale) —
// LocaleFromSession fetches /api/dashboard/me, pushes the locale into the provider,
// and mirrors it into the NEXT_LOCALE cookie so later SSR paints match. Renders its
// children untouched otherwise.

'use client';

import { LocaleFromSession } from '@/lib/i18n-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LocaleFromSession />
      {children}
    </>
  );
}
