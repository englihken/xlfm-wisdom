// src/lib/centre-name.ts
// Locale-aware centre display name (i18n rule 7): centre NAMES are user/org data,
// not translated — but a centre carries both name_cn and name_en, so for EN/ID we
// show name_en when present, else fall back to name_cn. zh always shows name_cn.
// Pure — safe on server and client.

import type { Locale } from './i18n';

export function centreName(
  centre: { name_cn: string; name_en?: string | null },
  locale: Locale | string
): string {
  if (locale === 'zh') return centre.name_cn;
  return centre.name_en || centre.name_cn;
}
