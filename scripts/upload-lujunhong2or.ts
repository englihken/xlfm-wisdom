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
//   npx tsx scripts/upload-lujunhong2or.ts --only=wenda,zongshu
//     Upload only the named sources (skips re-embedding the others). ALL
//     sources are still parsed first so the cross-category id-dedupe stays
//     identical to a full run.

import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
  parsePosts,
  parseTranscriptPosts,
  extractOriginalDate,
  extractDateLoose,
  WpPost,
  SourceKind,
} from './lujunhong2or-parse';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const NAMESPACE = 'xlfm-wisdom';
const SRC_DIR = path.join(__dirname, '..', 'corpus-sources', 'lujunhong2or');
const BATCH_SIZE = 90; // Pinecone integrated-inference upsert caps at 96 records
const BATCH_DELAY_MS = 500;

// Order matters: dedupe precedence. 玄艺问答/玄艺综述 contain many posts
// CROSS-FILED from the letters/fahui categories (same WP post id) — a post is
// uploaded ONLY under the first source that carries it, so cross-filed posts
// keep their letters_/fahui_ ids and are skipped (logged) in wenda/zongshu.
const SOURCES: {
  kind: SourceKind;
  filePrefix: string;
  book: string;
  type: 'letter_qa' | 'fahui_qa' | 'case_qa';
  category: string;
  mode: 'letters' | 'transcript';
  dateOf: (title: string) => string | null;
}[] = [
  {
    kind: 'letters',
    filePrefix: 'letters-',
    book: '解答来信疑惑',
    type: 'letter_qa',
    category: '开示解答来信疑惑',
    mode: 'letters',
    dateOf: extractOriginalDate,
  },
  {
    kind: 'fahui',
    filePrefix: 'fahui-qa-',
    book: '法会弟子提问',
    type: 'fahui_qa',
    category: '法会弟子提问',
    mode: 'letters',
    dateOf: extractOriginalDate,
  },
  // Phase B — radio-program transcripts; type='case_qa' for BOTH (brief 2.3).
  // Broadcast date comes loose from the title (《玄艺问答》节目2010年6月11日).
  {
    kind: 'wenda',
    filePrefix: 'wenda-',
    book: '玄艺问答',
    type: 'case_qa',
    category: '玄艺问答',
    mode: 'transcript',
    dateOf: extractDateLoose,
  },
  {
    kind: 'zongshu',
    filePrefix: 'zongshu-',
    book: '玄艺综述',
    type: 'case_qa',
    category: '玄艺综述',
    mode: 'transcript',
    dateOf: extractDateLoose,
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
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;

  const allRecords: Record<string, unknown>[] = [];
  const seenPostIds = new Set<number>(); // cross-category dedupe (precedence = SOURCES order)
  for (const src of SOURCES) {
    console.log(`\n=== ${src.category} ===`);
    const allPosts = loadPosts(src.filePrefix);
    const posts = allPosts.filter((p) => !seenPostIds.has(p.id));
    const crossFiled = allPosts.length - posts.length;
    for (const p of posts) seenPostIds.add(p.id);
    const parse = src.mode === 'transcript' ? parseTranscriptPosts : parsePosts;
    const { chunks, unparseable, warnings, perPost } = parse(posts, src.kind);
    console.log(
      `  posts: ${allPosts.length} · cross-filed skipped: ${crossFiled} · parsed: ${perPost.size} · pairs: ${chunks.length} · unparseable: ${unparseable.length}`
    );
    for (const w of warnings) console.warn(`  [warn] ${w}`);
    for (const u of unparseable) console.error(`  [UNPARSEABLE] post ${u.postId} "${u.title}": ${u.reason}`);

    if (only && !only.has(src.kind)) {
      console.log(`  (--only: parsed for dedupe, records skipped)`);
      continue;
    }

    const postById = new Map(posts.map((p) => [p.id, p]));
    for (const c of chunks) {
      const post = postById.get(c.postId)!;
      const originalDate = src.dateOf(post.title.rendered);
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
