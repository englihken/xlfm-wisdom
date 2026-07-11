// src/lib/i18n-react.tsx
// Client-side i18n: the React context that carries the active Locale plus the
// useT() hook every client component uses. Server code never imports this — it
// calls createT(locale) from i18n.ts directly.
//
// The provider is seeded with an SSR-resolved locale (public pages: NEXT_LOCALE
// cookie; dashboard: the session volunteer's volunteers.locale) so the first
// paint is already correct (no flash). It also exposes setLocale so the dashboard
// can update the locale in place after a switch, and a small self-fetch updater
// (LocaleFromSession) keeps client-gated dashboard pages in sync with the user's
// saved preference.

'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createT, DEFAULT_LOCALE, toLocale, type Locale, type TFunc } from './i18n';

type Ctx = { locale: Locale; setLocale: (l: Locale) => void };
const I18nContext = createContext<Ctx>({ locale: DEFAULT_LOCALE, setLocale: () => {} });

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale?: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE);
  const value = useMemo(() => ({ locale, setLocale }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

export function useSetLocale(): (l: Locale) => void {
  return useContext(I18nContext).setLocale;
}

export function useT(): TFunc {
  const { locale } = useContext(I18nContext);
  return useMemo(() => createT(locale), [locale]);
}

// Drop-in for client-gated dashboard subtrees: once /api/dashboard/me resolves,
// push the session volunteer's saved locale into the provider so the whole
// dashboard follows the user's preference (survives logout/login). Renders
// nothing. Safe to mount more than once.
export function LocaleFromSession() {
  const setLocale = useSetLocale();
  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j?.locale) setLocale(toLocale(j.locale));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [setLocale]);
  return null;
}

// Convenience for imperatively binding a t at an event handler etc.
export function useBoundT() {
  const t = useT();
  return useCallback(t, [t]);
}
