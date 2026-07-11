// src/lib/display-maps.ts
// Locale-aware DISPLAY maps for KNOWN enumerated values (i18n rule 6): stage keys,
// source_type labels, and the seeded care categories. Each resolver looks the value
// up in the dictionary under a namespace and falls back to the RAW value when the
// key is unknown (legacy rows, off-list categories) — never blank, never a bare key.
// Pure — safe on server (createT(locale)) and client (useT()).

import { createT, type Locale, type TFunc } from './i18n';

// Generic: t('<ns>.<value>') with raw-value fallback (t returns the key on a miss).
export function mapLabel(t: TFunc, ns: string, value: string | null | undefined): string {
  if (value == null || value === '') return '';
  const key = `${ns}.${value}`;
  const r = t(key);
  return r === key ? value : r;
}

// Stage / rung (contacts.stage + milestone keys). Legacy Chinese values fall through
// as-is until the architect's data migration (033) rewrites them to keys.
export function stageLabelT(t: TFunc, value: string | null | undefined): string {
  return mapLabel(t, 'stage', value);
}
export function stageLabelFor(locale: Locale, value: string | null | undefined): string {
  return stageLabelT(createT(locale), value);
}

// source_type (智慧问答 / 表单 / 活动 / …). '—' when absent, matching the old sourceLabel.
export function sourceLabelT(t: TFunc, value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  return mapLabel(t, 'source', value);
}
export function sourceLabelFor(locale: Locale, value: string | null | undefined): string {
  return sourceLabelT(createT(locale), value);
}

// Care conversation categories (values are stored as Chinese strings; the dictionary
// maps each known Chinese value to its localized label, unknown → raw).
export function careCategoryLabelT(t: TFunc, value: string | null | undefined): string {
  return mapLabel(t, 'careCat', value);
}
export function careCategoryLabelFor(locale: Locale, value: string | null | undefined): string {
  return careCategoryLabelT(createT(locale), value);
}
