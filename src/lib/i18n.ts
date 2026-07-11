// src/lib/i18n.ts
// i18n core (E3 primer → E4 three-locale). PURE — no React, no server imports —
// so it is safe to import from BOTH server code (API routes / server components:
// createT(locale)) and client code (via the hooks in i18n-react.tsx: useT()).
//
// zh is the master dictionary (locales/zh.ts). E4 adds en.ts + id.ts, each typed
// Record<keyof typeof zh, string> so the compiler catches any gap. Resolution
// walks a per-locale FALLBACK chain (id → en → zh, en → zh) and finally returns
// the raw key — a missing key is never blank, it shows dev-visibly.

// Merged dictionaries (core zh/en/id + all per-surface parts) — see locales/index.ts.
import { zh, en, id } from './locales';

export type Locale = 'zh' | 'en' | 'id';
export const LOCALES: Locale[] = ['zh', 'en', 'id'];
export const DEFAULT_LOCALE: Locale = 'zh';

// The public/UI locale cookie: SSR seeds the provider from it (public pages read it
// directly; the dashboard also mirrors the session volunteer's saved locale into it
// so subsequent server paints match). Shared by i18n-server.ts and i18n-react.tsx.
export const LOCALE_COOKIE = 'NEXT_LOCALE';

// Language names ALWAYS shown in their own language (switchers).
export const LOCALE_NATIVE_NAME: Record<Locale, string> = {
  zh: '中文',
  en: 'English',
  id: 'Bahasa Indonesia',
};
// Compact label for the public pill.
export const LOCALE_SHORT_NAME: Record<Locale, string> = {
  zh: '中文',
  en: 'EN',
  id: 'ID',
};

type Dict = Record<string, string>;

// zh is the master; en/id are typed Record<keyof typeof zh, string> so gaps are
// compile errors. A locale still missing a key falls back through FALLBACK to zh.
const DICTIONARIES: Record<Locale, Dict> = { zh, en, id };

// First hit wins; every chain ends at zh, then translate() falls back to the raw key.
const FALLBACK: Record<Locale, Locale[]> = {
  zh: ['zh'],
  en: ['en', 'zh'],
  id: ['id', 'en', 'zh'],
};

export function isLocale(v: unknown): v is Locale {
  return v === 'zh' || v === 'en' || v === 'id';
}

// Coerce anything (cookie value, db column, query param) to a valid Locale.
export function toLocale(v: unknown): Locale {
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

// {name}-style interpolation — full-sentence keys with named params (never
// concatenate translated fragments).
function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  for (const loc of FALLBACK[locale] ?? FALLBACK.zh) {
    const v = DICTIONARIES[loc]?.[key];
    if (v != null) return interpolate(v, params);
  }
  return key; // dev-visible gap — never blank
}

export type TFunc = (key: string, params?: Record<string, string | number>) => string;

export function createT(locale: Locale): TFunc {
  return (key, params) => translate(locale, key, params);
}

// Legacy zh-bound export. Kept for non-hook / server callers that don't yet carry
// a per-request locale; client components use useT() from i18n-react.tsx instead.
export const t: TFunc = createT('zh');
