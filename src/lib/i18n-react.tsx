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
import { createT, DEFAULT_LOCALE, LOCALE_COOKIE, toLocale, type Locale, type TFunc } from './i18n';

// Persist the UI locale into the NEXT_LOCALE cookie (1 year) so the next SSR paint
// seeds the provider in the same language. Client-only.
export function setLocaleCookie(locale: Locale) {
  if (typeof document === 'undefined') return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

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

// Mirror the SERVER-resolved dashboard locale (the signed-in volunteer's saved
// preference, already used to seed the provider server-side) into the NEXT_LOCALE
// cookie on mount. This keeps the browser-global cookie pointing at the CURRENT
// user, so any public page opened right after (/m, /f, …) renders in their
// language and no stale previous-user value lingers. Renders nothing.
export function SyncLocaleCookie({ locale }: { locale: Locale }) {
  useEffect(() => {
    setLocaleCookie(locale);
  }, [locale]);
  return null;
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
        if (active && j?.locale) {
          const loc = toLocale(j.locale);
          setLocale(loc);
          setLocaleCookie(loc); // keep SSR seed in sync with the saved preference
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [setLocale]);
  return null;
}

// Change the active locale everywhere: update the provider, mirror to the cookie,
// and (dashboard) persist to the session volunteer's volunteers.locale. On public
// pages pass persist=false. Returns a promise so callers can await the save.
export function useChangeLocale() {
  const setLocale = useSetLocale();
  return useCallback(
    async (locale: Locale, opts?: { persist?: boolean }) => {
      setLocale(locale);
      setLocaleCookie(locale);
      if (opts?.persist) {
        try {
          await fetch('/api/dashboard/me/locale', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locale }),
          });
        } catch {
          /* cookie already applied; a failed save just won't survive re-login */
        }
      }
    },
    [setLocale]
  );
}
