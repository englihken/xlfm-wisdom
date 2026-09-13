// scripts/wisdom-resync.ts — re-upsert APPROVED 智库 entries to Pinecone after
// their content was edited outside the dashboard (SQL). The approve action is a
// no-op on an already-approved entry, so this is the resync path until the
// wisdom route learns "approved entry edited → resync" (09-13 prayer-form §2).
// Uses the exact production sync function (upsertWisdomRecord) and prints the
// Pinecone text before/after so the change is visible.
//   npx tsx scripts/wisdom-resync.ts <entry-id-or-prefix> [--dry-run]

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import { buildWisdomRecord, upsertWisdomRecord, wisdomRecordId, type WisdomEntryForSync } from '../src/lib/wisdom-sync';

async function pineconeText(id: string): Promise<string | null> {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const { host } = await pc.describeIndex(process.env.PINECONE_INDEX_NAME!);
  const params = new URLSearchParams({ ids: wisdomRecordId(id), namespace: 'xlfm-wisdom' });
  const res = await fetch(`https://${host}/vectors/fetch?${params}`, {
    headers: { 'Api-Key': process.env.PINECONE_API_KEY!, 'X-Pinecone-API-Version': '2025-01' },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { vectors?: Record<string, { metadata?: { text?: string } }> };
  return json.vectors?.[wisdomRecordId(id)]?.metadata?.text ?? null;
}

async function main() {
  const prefix = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!prefix) throw new Error('usage: npx tsx scripts/wisdom-resync.ts <entry-id-or-prefix> [--dry-run]');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await db
    .from('wisdom_entries')
    .select('id, canonical_question, variants, keywords, answer_guidance, language, pinned, status')
    .eq('status', 'approved');
  if (error) throw error;
  const entries = (data ?? []).filter((e) => (e.id as string).startsWith(prefix));
  if (entries.length !== 1) throw new Error(`expected exactly one approved entry for ${prefix}, found ${entries.length}`);
  const entry = entries[0] as WisdomEntryForSync & { status: string };

  const before = await pineconeText(entry.id);
  const after = buildWisdomRecord(entry).text as string;
  console.log(`entry ${entry.id} (pinned=${entry.pinned === true})`);
  console.log(`--- Pinecone now ---\n${before ?? '(absent)'}`);
  console.log(`--- Supabase (will upsert) ---\n${after}`);
  console.log(before === after ? 'identical — nothing to do' : 'differs');
  if (dryRun || before === after) return;

  await upsertWisdomRecord(entry);
  // Integrated-embedding upserts are eventually consistent; poll briefly.
  for (let i = 0; i < 10; i++) {
    const now = await pineconeText(entry.id);
    if (now === after) {
      console.log(`resynced ✓ (after ${i} polls)`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('upsert sent but Pinecone text still differs after 20 s');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
