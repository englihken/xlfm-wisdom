// src/lib/i18n.ts
// E3 i18n primer (§0): every NEW user-facing string goes through t(). Locale is
// hardcoded 'zh' this phase; E4 adds en/id dictionaries + a switcher without
// touching call sites. A missing key returns the key itself — deliberately
// dev-visible so gaps surface in the UI instead of failing silently.
// Client-safe: pure lookup, no server imports.

import { zh } from './locales/zh';

const LOCALE: 'zh' = 'zh';

const DICTIONARIES: Record<typeof LOCALE, Record<string, string>> = { zh };

export function t(key: string): string {
  return DICTIONARIES[LOCALE][key] ?? key;
}
