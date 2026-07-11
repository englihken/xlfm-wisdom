// src/lib/org-settings.ts
// Server-only helpers for the generic org_settings keys added in E3 (migration
// 032). Every reader here is FAIL-SAFE with an explicit default: a missing key
// or an unreachable table must never break a public page or the care pipeline
// (brief §3.3/§3.5 — public routes fail-OPEN, classifier falls back to the
// built-in list). Every failure is logged — no silently discarded errors.

import { supabaseAdmin } from './supabase';

// The HARD allowlist for GET/PATCH /api/dashboard/org-settings (brief §3).
// value kind drives PATCH validation.
export const ORG_SETTING_ALLOWLIST: Record<string, 'string_array' | 'boolean' | 'number' | 'string'> = {
  'care.categories': 'string_array',
  'care.ai_draft_enabled': 'boolean',
  'outreach.event_window_days': 'number',
  'public.fee_check_enabled': 'boolean',
  'public.inbox_form_enabled': 'boolean',
  'public.inbox_form_notice': 'string',
};

async function readSetting(key: string): Promise<unknown | undefined> {
  if (!supabaseAdmin) return undefined;
  const { data, error } = await supabaseAdmin
    .from('org_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) {
    console.error(`[org-settings] read ${key} failed:`, error);
    return undefined;
  }
  return data?.value;
}

// 渡人 funnel / 活动效果 rolling window (days). Default 90.
export async function loadEventWindowDays(): Promise<number> {
  const v = await readSetting('outreach.event_window_days');
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 90;
}

// Care classifier category list. Returns null when the key is missing or
// unreachable — the CALLER falls back to its built-in list (avoids a circular
// import with care-pipeline).
export async function loadCareCategories(): Promise<string[] | null> {
  const v = await readSetting('care.categories');
  if (Array.isArray(v)) {
    const list = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    if (list.length > 0) return list;
  }
  return null;
}

// AI drafting master switch. Missing/unreachable → true (today's behavior).
export async function isAiDraftEnabled(): Promise<boolean> {
  const v = await readSetting('care.ai_draft_enabled');
  return typeof v === 'boolean' ? v : true;
}

// Public page switches (/f · /m). FAIL-OPEN: missing key/unreachable → enabled.
export async function isPublicPageEnabled(
  key: 'public.fee_check_enabled' | 'public.inbox_form_enabled'
): Promise<boolean> {
  const v = await readSetting(key);
  return typeof v === 'boolean' ? v : true;
}

// Optional notice shown at the top of /m when set (empty/missing → null).
export async function loadInboxFormNotice(): Promise<string | null> {
  const v = await readSetting('public.inbox_form_notice');
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
