// src/lib/wisdom-sync.ts
// 智库 (wisdom_entries, migration 044) ↔ Pinecone sync (P2 §3).
//
// An APPROVED entry is upserted as id wisdom_{entryId} with
// type='canonical_ruling' and book='组织审定' — deliberately the SAME tier as
// the canonical 组织审定 docs, so it inherits the +0.5 rerank boost, the
// guaranteed canonical parallel query, the verbatim-guard "canonical numbers
// only" rule, and the 组织审定 citation label with ZERO pipeline changes.
// On retire (or edit of an approved entry) the record is deleted; re-approval
// re-upserts. Draft/retired entries therefore can never inject.
//
// This module touches ONLY Pinecone env (PINECONE_API_KEY / PINECONE_INDEX_NAME)
// so regression scripts can exercise the exact production sync path locally;
// the DB side (status flips, use_count) lives in the API routes.

import { Pinecone } from '@pinecone-database/pinecone';

const NAMESPACE = 'xlfm-wisdom';

export interface WisdomEntryForSync {
  id: string;
  canonical_question: string;
  variants: string | null;
  keywords: string | null;
  answer_guidance: string | null;
  language: string;
}

let cachedHost: string | null = null;
async function getHost(): Promise<string> {
  if (cachedHost) return cachedHost;
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const description = await pinecone.describeIndex(process.env.PINECONE_INDEX_NAME!);
  cachedHost = description.host;
  return cachedHost;
}

export function wisdomRecordId(entryId: string): string {
  return `wisdom_${entryId}`;
}

/** The exact Pinecone record an approved entry becomes (also used by tests). */
export function buildWisdomRecord(entry: WisdomEntryForSync): Record<string, unknown> {
  const parts = [
    `【组织审定 · 智库】${entry.canonical_question}`,
    entry.variants?.trim() ? `其他问法：${entry.variants.trim()}` : null,
    entry.answer_guidance?.trim() ?? '',
  ].filter(Boolean);
  return {
    _id: wisdomRecordId(entry.id),
    text: parts.join('\n'),
    book: '组织审定',
    type: 'canonical_ruling',
    level: 'canonical',
    source: 'wisdom_entry',
    entry_id: entry.id,
    language: entry.language,
    // keywords feed the categories field (retrieval hints, same as canonical docs)
    categories: ['组织审定', '智库', entry.keywords?.trim() || null].filter(Boolean).join(','),
    excerpt: `组织审定 · 智库：${entry.canonical_question}`.slice(0, 200),
    // Deliberately NO page_start/page_end — citation label is 组织审定 only.
  };
}

export async function upsertWisdomRecord(entry: WisdomEntryForSync): Promise<void> {
  const host = await getHost();
  const record = buildWisdomRecord(entry);
  const response = await fetch(`https://${host}/records/namespaces/${NAMESPACE}/upsert`, {
    method: 'POST',
    headers: {
      'Api-Key': process.env.PINECONE_API_KEY!,
      'Content-Type': 'application/x-ndjson',
      'X-Pinecone-API-Version': '2025-01',
    },
    body: JSON.stringify(record),
  });
  if (!response.ok) {
    throw new Error(`wisdom upsert failed: ${response.status} ${await response.text()}`);
  }
}

export async function deleteWisdomRecord(entryId: string): Promise<void> {
  // Raw REST, not the SDK: pinecone-js v7's deleteMany 400s against this
  // serverless host (API-version mismatch), while POST /vectors/delete with
  // the 2025-01 header succeeds — verified live. Deleting an absent id is a
  // no-op 200, so the call is idempotent.
  const host = await getHost();
  const response = await fetch(`https://${host}/vectors/delete`, {
    method: 'POST',
    headers: {
      'Api-Key': process.env.PINECONE_API_KEY!,
      'Content-Type': 'application/json',
      'X-Pinecone-API-Version': '2025-01',
    },
    body: JSON.stringify({ ids: [wisdomRecordId(entryId)], namespace: NAMESPACE }),
  });
  if (!response.ok) {
    throw new Error(`wisdom delete failed: ${response.status} ${await response.text()}`);
  }
}

// ── use_count (P2 §3) ────────────────────────────────────────────────────────

const WISDOM_ID_PREFIX = 'wisdom_';

/** Entry ids of any wisdom_ chunks among a reply's retrieved passages. */
export function wisdomEntryIdsInPassages(passages: { id: string }[]): string[] {
  return passages
    .filter((p) => p.id.startsWith(WISDOM_ID_PREFIX))
    .map((p) => p.id.slice(WISDOM_ID_PREFIX.length));
}

// Minimal client surface so the caller passes supabaseAdmin without this
// module importing server-only code.
type QueryDb = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Fire-and-forget use_count increment (service role). Read-then-write per
 * entry — no DB function available for a relative bump (no migrations), and a
 * rare lost increment on a usage COUNTER is acceptable.
 */
export async function incrementWisdomUseCounts(db: QueryDb, entryIds: string[]): Promise<void> {
  for (const id of entryIds) {
    try {
      const { data } = await db.from('wisdom_entries').select('use_count').eq('id', id).maybeSingle();
      if (!data) continue;
      await db
        .from('wisdom_entries')
        .update({ use_count: (data.use_count as number) + 1 })
        .eq('id', id);
    } catch (e) {
      console.error(`[wisdom] use_count increment failed for ${id}:`, e);
    }
  }
}
