// scripts/fix-xfz-p2-chunk.ts — brief 2026-09-13-xfz-retrieval-and-prayer-guard §1.1.
// The 《小房子念诵指南》 chunk that carries printed p2 「小房子的组成」
// (xiaofangzi_guide_w2b2_14, PDF p11) was extracted with the numbers broken
// away from 遍 — 「《大悲咒》 27\n\n遍 、 《心经》 49\n\n遍 、…《七佛灭罪真言》 87\n\n遍」.
// The guard re-joins such lines on its side (joinBrokenEnumerations) but the
// model reads the raw text. This re-upserts that one record with the same id
// and metadata and the enumeration lines joined, then polls until Pinecone
// serves the new text.
//   npx tsx scripts/fix-xfz-p2-chunk.ts [--dry-run]

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { joinBrokenEnumerations } from '../src/lib/verbatim-guard-pairs';

const ID = 'xiaofangzi_guide_w2b2_14';
const NAMESPACE = 'xlfm-wisdom';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const H = { 'Api-Key': process.env.PINECONE_API_KEY!, 'X-Pinecone-API-Version': '2025-01' };
  const host = (await (await fetch(`https://api.pinecone.io/indexes/${process.env.PINECONE_INDEX_NAME}`, { headers: H })).json()).host as string;
  const fetchText = async (): Promise<Record<string, unknown> | null> => {
    const res = await fetch(`https://${host}/vectors/fetch?ids=${ID}&namespace=${NAMESPACE}`, { headers: H });
    if (!res.ok) throw new Error(`fetch failed: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { vectors?: Record<string, { metadata?: Record<string, unknown> }> }).vectors?.[ID]?.metadata ?? null;
  };

  const meta = await fetchText();
  if (!meta) throw new Error(`${ID} not found`);
  const before = String(meta.text ?? '');
  const after = joinBrokenEnumerations(before);
  const paired = (t: string) => ['27遍', '49遍', '84遍', '87遍'].map((n) => t.replace(/\s+/g, '').includes(n));
  console.log(`${ID} book=${meta.book} p${meta.page_start}-${meta.page_end}`);
  console.log(`numbers directly followed by 遍 (no line break) — before: ${[/27\s{0,2}遍/, /49\s{0,2}遍/, /84\s{0,2}遍/, /87\s{0,2}遍/].map((r) => r.test(before))} · after: ${[/27 ?遍/, /49 ?遍/, /84 +遍/, /87 ?遍/].map((r) => r.test(after))}`);
  console.log(`whitespace-free pairs after: ${paired(after)}`);
  if (before === after) {
    console.log('already joined — nothing to do');
    return;
  }
  if (dryRun) {
    console.log(JSON.stringify(after.slice(0, 300)));
    return;
  }

  // Same id and metadata; only `text` changes (integrated embedding re-embeds it).
  const record = { ...meta, _id: ID, text: after };
  const res = await fetch(`https://${host}/records/namespaces/${NAMESPACE}/upsert`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/x-ndjson' },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`upsert failed: ${res.status} ${await res.text()}`);
  for (let i = 0; i < 15; i++) {
    const now = await fetchText();
    if (now && now.text === after) {
      console.log(`re-upserted ✓ (after ${i} polls)`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('upsert sent but Pinecone still serves the old text after 30 s');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
