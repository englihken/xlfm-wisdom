// src/lib/test-traffic.ts
// Synthetic traffic (chip warm-ups, test suites) in ONE place.
//
// Why this exists (2026-09-12): scripts/warm-chips-prod.ts posts all six chip
// questions of a language with the SAME browserId (`chip-warm:<lang>`), so the
// six questions folded into one contact and the nightly profile engine — which
// evolves a profile across a contact's conversations — honestly described a
// person with 家庭冲突 + 子女教养 + 工作困顿 + 家人患病 all at once. The profile
// is volunteer-facing only (it never enters a reply prompt), so no visitor ever
// got a wrong answer; but the care inbox, the unanswered counts, the nightly
// summaries and the reviews were all counting 52 synthetic conversations.
//
// The fix is a flag on the contact (migration 050 `contacts.is_test`) set at
// find-or-create time, plus these helpers so every read filters the same way.
// The conversations are NOT deleted — they are the samples behind the chip
// answers, and chip_answers tooling still points at them.

import type { SupabaseClient } from '@supabase/supabase-js';

/** A browserId with any of these prefixes is synthetic, not a visitor. */
export const TEST_BROWSER_ID_PREFIXES = ['chip-warm:', 'test:', 'test-suite:'] as const;

export function isTestBrowserId(browserId?: string | null): boolean {
  if (!browserId) return false;
  return TEST_BROWSER_ID_PREFIXES.some((p) => browserId.startsWith(p));
}

// Minimal client surface so callers can pass supabaseAdmin without this module
// importing server-only code, and so tests can pass a stub.
type Db = Pick<SupabaseClient, 'from'>;

// The id list is tiny (3 rows today) and changes only when a new test prefix is
// first used, so a short process-local cache keeps every dashboard read at one
// extra query per 5 minutes. Fail-open: on error we return the last known list
// (or none), which shows synthetic rows rather than hiding real ones.
const TTL_MS = 5 * 60_000;
let cache: { at: number; ids: string[] } | null = null;

export function invalidateTestContactCache(): void {
  cache = null;
}

export async function testContactIds(db: Db): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ids;
  try {
    const { data, error } = await db.from('contacts').select('id').eq('is_test', true);
    if (error) throw error;
    const ids = (data ?? []).map((r) => r.id as string);
    cache = { at: Date.now(), ids };
    return ids;
  } catch (e) {
    console.error('[test-traffic] test contact lookup failed:', e);
    return cache?.ids ?? [];
  }
}

/**
 * Exclude synthetic contacts from a `conversations` query.
 *
 * NOT a plain `.not('contact_id','in',…)`: SQL three-valued logic makes
 * `NULL NOT IN (…)` evaluate to NULL, so a bare NOT IN silently drops every
 * conversation with no contact at all. Measured against production on
 * 2026-09-12: 2,680 conversations, 52 synthetic, 124 orphans — a bare NOT IN
 * kept 2,504 (it ate all 124 orphans); `is null OR not in` keeps 2,628, which
 * is the 2,680 − 52 we want. Orphans are real traffic (a visitor whose browser
 * sent no browserId) and must stay in the inbox.
 *
 * With no test contacts the query is returned untouched — PostgREST cannot
 * build an empty `in.()`.
 */
export function excludeTestContacts<Q extends { or: (filter: string) => Q }>(
  query: Q,
  ids: string[],
  column = 'contact_id'
): Q {
  if (ids.length === 0) return query;
  return query.or(`${column}.is.null,${column}.not.in.(${ids.join(',')})`);
}

/** In-memory variant for rows already fetched. */
export function isTestContact(contactId: string | null | undefined, ids: string[]): boolean {
  return Boolean(contactId) && ids.includes(contactId as string);
}

/** Fixed profile text for a synthetic contact — the nightly engine never rewrites it. */
export const TEST_CONTACT_SUMMARY = '（系统预热账号，非真实访客）';
