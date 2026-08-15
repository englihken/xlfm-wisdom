// scripts/test-wisdom-live.ts
// P2 §6 live regression for the 智库 Pinecone cycle, using the EXACT
// production sync functions (src/lib/wisdom-sync.ts):
//
//   --phase up    draft never injects (pre-check) → approve-sync (upsert) →
//                 chunk retrievable → live guarded reply grounds in the entry
//                 with the 组织审定 label. Leaves the record LIVE so the
//                 production use_count check can run in between.
//   --phase down  retire-sync (delete) → chunk gone → retired never injects.
//
// The entry content is a clearly-marked TEST fixture (deliberately absurd
// subject so no real visitor query lands on it; retired minutes later).
//   npx tsx scripts/test-wisdom-live.ts --phase up
//   npx tsx scripts/test-wisdom-live.ts --phase down

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import {
  upsertWisdomRecord,
  deleteWisdomRecord,
  wisdomRecordId,
  type WisdomEntryForSync,
} from '../src/lib/wisdom-sync';

export const TEST_ENTRY: WisdomEntryForSync = {
  id: 'feedfeed-dead-4bee-8fee-feedfeedfeed',
  canonical_question: '测试专用：智库回归测试的莲花水晶塔一共有几层？',
  variants: '智库测试塔有几层；莲花水晶塔层数（回归测试）',
  keywords: '测试,智库回归测试,莲花水晶塔',
  answer_guidance:
    '【测试条目 · TEST ONLY】智库回归测试专用内容：莲花水晶塔一共有七层，这是质量回归测试用的虚构数据，测试完成后本条目将被退役。',
  language: 'zh',
};

const TEST_QUESTION = '智库回归测试：莲花水晶塔一共有几层？';
const RECORD_ID = wisdomRecordId(TEST_ENTRY.id);

let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}

async function retrievalIds(): Promise<{ ids: string[]; passages: import('../src/lib/vector-search').RetrievedPassage[] }> {
  const { searchRelevantTeachings } = await import('../src/lib/vector-search');
  const passages = await searchRelevantTeachings(TEST_QUESTION, undefined, 'zh');
  return { ids: passages.map((p) => p.id), passages };
}

async function waitFor(predicate: () => Promise<boolean>, label: string, tries = 12): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return true;
    process.stdout.write(`  (waiting for ${label}… ${i + 1}/${tries})\n`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

async function phaseUp() {
  console.log('═══ phase up: draft → approve-sync → live answer ═══');

  // 1. Draft state (no sync has happened) must not inject.
  const before = await retrievalIds();
  check('draft entry NOT retrievable before approve-sync', !before.ids.includes(RECORD_ID));

  // 2. Approve → the production upsert.
  await upsertWisdomRecord(TEST_ENTRY);
  console.log(`  upserted ${RECORD_ID}`);

  // 3. Retrievable (integrated-inference indexing lag tolerated).
  const indexed = await waitFor(async () => (await retrievalIds()).ids.includes(RECORD_ID), 'indexing');
  check('approved entry retrievable', indexed);

  // 4. Live guarded reply grounds in the entry with the 组织审定 label.
  const { searchRelevantTeachings, formatPassagesAsContext } = await import('../src/lib/vector-search');
  const { generateGuardedReplyText, buildSources } = await import('../src/lib/care-pipeline');
  const passages = await searchRelevantTeachings(TEST_QUESTION, undefined, 'zh');
  const wisdomPassage = passages.find((p) => p.id === RECORD_ID);
  check('wisdom passage present in reply retrieval', Boolean(wisdomPassage));
  check('passage type is canonical_ruling (组织审定 tier)', wisdomPassage?.type === 'canonical_ruling');
  check('passage ranked FIRST (canonical boost)', passages[0]?.id === RECORD_ID);

  const { fullText } = await generateGuardedReplyText({
    messages: [{ role: 'user', content: TEST_QUESTION }],
    language: 'zh',
    passages,
    contextBlock: formatPassagesAsContext(passages),
    conversationId: 'wisdom-regression-test',
  });
  const books = buildSources(passages).map((s) => s.book);
  console.log(`--- reply ---\n${fullText}\n---`);
  check('reply carries the guidance (七层)', fullText.includes('七层'));
  check('sources carry the 组织审定 label', books.includes('组织审定'));

  console.log(failed === 0 ? '\nPHASE UP PASS (record left LIVE for prod use_count check)' : `\n${failed} CHECKS FAILED`);
  if (failed > 0) process.exit(1);
}

async function phaseDown() {
  console.log('═══ phase down: retire-sync → gone ═══');
  await deleteWisdomRecord(TEST_ENTRY.id);
  console.log(`  deleted ${RECORD_ID}`);
  const gone = await waitFor(async () => !(await retrievalIds()).ids.includes(RECORD_ID), 'delete propagation');
  check('retired entry no longer retrievable', gone);
  console.log(failed === 0 ? '\nPHASE DOWN PASS' : `\n${failed} CHECKS FAILED`);
  if (failed > 0) process.exit(1);
}

const phase = process.argv.includes('--phase')
  ? process.argv[process.argv.indexOf('--phase') + 1]
  : process.argv.find((a) => a.startsWith('--phase='))?.split('=')[1];

(phase === 'down' ? phaseDown() : phase === 'up' ? phaseUp() : Promise.reject(new Error('pass --phase up|down'))).catch(
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
