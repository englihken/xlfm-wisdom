// scripts/test-test-traffic.ts
// Checks the synthetic-traffic filter (migration 050 + src/lib/test-traffic.ts)
// against the LIVE database: the prefix predicate, the cached id lookup, and —
// the part that actually matters — that `excludeTestContacts` really removes the
// chip-warm conversations from the same queries the inbox / counts / crons run,
// while keeping orphan conversations (contact_id IS NULL) and real visitors.
//   SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/test-test-traffic.ts
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail ?? ''); }
}

async function main() {
  const { isTestBrowserId, TEST_BROWSER_ID_PREFIXES, testContactIds, excludeTestContacts, invalidateTestContactCache } =
    await import('../src/lib/test-traffic');

  console.log('— prefix predicate (no DB) —');
  for (const p of TEST_BROWSER_ID_PREFIXES) assert(`「${p}…」 is test`, isTestBrowserId(`${p}zh`));
  assert('a real browserId is not test', !isTestBrowserId('b3f0c2e1-8a4d-4f2b-9c77-1e2d3f4a5b6c'));
  assert('undefined is not test', !isTestBrowserId(undefined));
  assert('empty string is not test', !isTestBrowserId(''));
  assert('「mytest:」 does not match 「test:」 (prefix, not substring)', !isTestBrowserId('mytest:1'));
  assert('「chip-warmup」 without the colon does not match', !isTestBrowserId('chip-warmup'));

  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('\n(no Supabase credentials in this environment — DB checks skipped)');
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
    return;
  }
  const db = createClient(url, key);

  console.log('\n— live database —');
  invalidateTestContactCache();
  const ids = await testContactIds(db);
  console.log(`  test contacts: ${ids.length}`);
  assert('at least one test contact is flagged (migration 050 backfill)', ids.length > 0, ids);

  const { data: flagged } = await db.from('contacts').select('browser_id, display_name, summary').eq('is_test', true);
  assert('every flagged contact has a test prefix', (flagged ?? []).every((c) => isTestBrowserId(c.browser_id as string)), flagged);
  assert('…and carries the fixed profile line', (flagged ?? []).every((c) => (c.summary as string) === '（系统预热账号，非真实访客）'), flagged);
  const { data: unflagged } = await db.from('contacts').select('browser_id').eq('is_test', false).limit(2000);
  const missed = (unflagged ?? []).filter((c) => isTestBrowserId(c.browser_id as string));
  assert('no test-prefixed contact is left unflagged', missed.length === 0, missed);

  // The query shape the inbox / counts / crons use.
  const all = await db.from('conversations').select('id, contact_id');
  const filtered = await excludeTestContacts(db.from('conversations').select('id, contact_id'), ids);
  const allRows = all.data ?? [];
  const keptRows = filtered.data ?? [];
  const testConvIds = new Set(allRows.filter((r) => ids.includes(r.contact_id as string)).map((r) => r.id as string));
  const orphans = allRows.filter((r) => r.contact_id === null).length;
  console.log(`  conversations: ${allRows.length} total · ${testConvIds.size} synthetic · ${orphans} orphan (contact_id null)`);
  assert('the filter removes every synthetic conversation', !keptRows.some((r) => testConvIds.has(r.id as string)));
  assert('…and removes exactly those, nothing else', keptRows.length === allRows.length - testConvIds.size, { all: allRows.length, kept: keptRows.length, test: testConvIds.size });
  // The NULL trap: a bare `not.in` would drop every contact-less conversation
  // (NULL NOT IN (…) is NULL, not TRUE). Measured 2026-09-12: 124 such rows.
  assert(`orphan conversations survive the filter (${orphans} rows with contact_id NULL)`,
    keptRows.filter((r) => r.contact_id === null).length === orphans,
    { expected: orphans, got: keptRows.filter((r) => r.contact_id === null).length });

  // With no test contacts the query must be untouched (empty `in ()` is invalid SQL).
  const none = await excludeTestContacts(db.from('conversations').select('id'), []);
  assert('empty id list leaves the query working', !none.error && (none.data ?? []).length === allRows.length, none.error);

  // Review / summarize eligibility: no synthetic conversation should carry a review.
  const { data: testReviews } = await db
    .from('conversation_reviews')
    .select('conversation_id')
    .in('conversation_id', [...testConvIds].slice(0, 200));
  assert('no synthetic conversation has a review row', (testReviews ?? []).length === 0, testReviews);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
