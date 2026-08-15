// scripts/upload-lujunhong2or.ts
// Parse the committed lujunhong2or snapshots (corpus-sources/lujunhong2or/)
// into Q&A chunks and upsert them to Pinecone (corpus Phase A, Tasks 2+3).
//
// Idempotent: fixed ids letters_{postId}_{n} / fahui_{postId}_{n} — re-running
// upserts the same records (same pattern as canonical_libai_1..8). Snapshots
// are merged by post id (the newest snapshot's copy of a post wins), so
// incremental snapshot files simply layer on top of the full export.
//
// Ranking: deliberately NO boost of any kind. 组织审定 canonical_ruling chunks
// (+0.5 in vector-search.ts) must stay on top — letters are 个案 answers and
// must never outrank the canonical tables on 遍数/张数 policy questions.
//
//   npx tsx scripts/upload-lujunhong2or.ts             # parse + upload
//   npx tsx scripts/upload-lujunhong2or.ts --dry-run   # parse + report only

import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { parsePosts, extractOriginalDate, WpPost, SourceKind } from './lujunhong2or-parse';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const NAMESPACE = 'xlfm-wisdom';
const SRC_DIR = path.join(__dirname, '..', 'corpus-sources', 'lujunhong2or');
const BATCH_SIZE = 90; // Pinecone integrated-inference upsert caps at 96 records
const BATCH_DELAY_MS = 500;

const SOURCES: {
  kind: SourceKind;
  filePrefix: string;
  book: string;
  type: 'letter_qa' | 'fahui_qa';
  category: string;
}[] = [
  {
    kind: 'letters',
    filePrefix: 'letters-',
    book: '解答来信疑惑',
    type: 'letter_qa',
    category: '开示解答来信疑惑',
  },
  {
    kind: 'fahui',
    filePrefix: 'fahui-qa-',
    book: '法会弟子提问',
    type: 'fahui_qa',
    category: '法会弟子提问',
  },
];

interface Snapshot {
  category: string;
  fetched_at: string;
  posts: WpPost[];
}

/** Load every snapshot for a prefix, merged by post id (newest snapshot wins). */
function loadPosts(filePrefix: string): WpPost[] {
  const files = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.startsWith(filePrefix) && f.endsWith('.json'))
    .sort(); // YYYYMMDD in the name → lexicographic = chronological
  if (files.length === 0) throw new Error(`no ${filePrefix}*.json snapshots in ${SRC_DIR} — run fetch-lujunhong2or.ts first`);
  const byId = new Map<number, WpPost>();
  for (const f of files) {
    const snap = JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8')) as Snapshot;
    for (const p of snap.posts) byId.set(p.id, p);
    console.log(`  ${f}: ${snap.posts.length} posts`);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const allRecords: Record<string, unknown>[] = [];
  for (const src of SOURCES) {
    console.log(`\n=== ${src.category} ===`);
    const posts = loadPosts(src.filePrefix);
    const { chunks, unparseable, warnings, perPost } = parsePosts(posts, src.kind);
    console.log(`  posts: ${posts.length} · parsed: ${perPost.size} · pairs: ${chunks.length} · unparseable: ${unparseable.length}`);
    for (const w of warnings) console.warn(`  [warn] ${w}`);
    for (const u of unparseable) console.error(`  [UNPARSEABLE] post ${u.postId} "${u.title}": ${u.reason}`);

    const postById = new Map(posts.map((p) => [p.id, p]));
    for (const c of chunks) {
      const post = postById.get(c.postId)!;
      const originalDate = extractOriginalDate(post.title.rendered);
      allRecords.push({
        _id: c.id,
        text: c.text,
        book: src.book,
        type: src.type,
        source: 'lujunhong2or',
        category: src.category,
        post_title: c.text.slice(1, c.text.indexOf('】')), // decoded title (parser prepends 【title】)
        url: post.link,
        wp_date: post.date,
        // Pinecone metadata rejects null — omit when the title has no 开示 date.
        ...(originalDate ? { original_date: originalDate } : {}),
        chunk_index: c.index,
        excerpt: c.text.slice(1, c.text.indexOf('】')),
        // Deliberately NO page_start/page_end (citation carries 篇号+开示日期,
        // not pages) and NO boost-bearing fields.
      });
    }
  }

  console.log(`\nTotal records to upsert: ${allRecords.length}`);
  if (dryRun) {
    console.log('--dry-run: skipping upload');
    return;
  }

  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const indexName = process.env.PINECONE_INDEX_NAME!;
  const description = await pinecone.describeIndex(indexName);
  const host = description.host;

  for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
    const batch = allRecords.slice(i, i + BATCH_SIZE);
    const response = await fetch(`https://${host}/records/namespaces/${NAMESPACE}/upsert`, {
      method: 'POST',
      headers: {
        'Api-Key': process.env.PINECONE_API_KEY!,
        'Content-Type': 'application/x-ndjson',
        'X-Pinecone-API-Version': '2025-01',
      },
      body: batch.map((r) => JSON.stringify(r)).join('\n'),
    });
    if (!response.ok) {
      throw new Error(`upsert batch @${i} failed: ${response.status} ${await response.text()}`);
    }
    console.log(`  ✓ upserted ${i + batch.length}/${allRecords.length}`);
    if (i + BATCH_SIZE < allRecords.length) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }
  console.log(`\n✓ Upserted ${allRecords.length} records (letter_qa + fahui_qa, no ranking boost)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
