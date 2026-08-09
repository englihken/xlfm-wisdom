// scripts/test-regression-live.ts
// Live regression for the anti-fabrication work (brief R1/R2): runs real
// questions through the REAL guarded pipeline (Pinecone retrieval + Opus 5 +
// verbatim guard) and asserts on the final reply text + cited sources.
//   npx tsx scripts/test-regression-live.ts

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

type Check = { name: string; ok: (reply: string, books: string[]) => boolean };
type Case = { label: string; q: string; checks: Check[] };

// Whitespace-blind contains: the model writes "21 遍" / "21遍" interchangeably.
const has = (s: string, sub: string) => s.replace(/\s+/g, '').includes(sub.replace(/\s+/g, ''));

const CASES: Case[] = [
  {
    label: 'R1a 初一十五',
    q: '初一十五礼佛大忏悔文可以念多少遍？',
    checks: [
      { name: 'says 21遍', ok: (r) => has(r, '21遍') },
      { name: 'mentions 含功课', ok: (r) => has(r, '功课') },
      { name: 'NEVER 13遍', ok: (r) => !has(r, '13遍') },
      { name: 'cites 组织审定', ok: (_r, books) => books.includes('组织审定') },
    ],
  },
  {
    label: 'R1b 观音圣诞',
    q: '观音菩萨圣诞礼佛可以念几遍？',
    checks: [
      { name: 'says 49遍', ok: (r) => has(r, '49遍') },
      { name: 'NEVER 13遍', ok: (r) => !has(r, '13遍') },
      { name: 'cites 组织审定', ok: (_r, books) => books.includes('组织审定') },
    ],
  },
  {
    label: 'R1c 地藏王圣诞',
    q: '地藏王菩萨圣诞礼佛大忏悔文可以念多少遍？',
    checks: [
      { name: 'says 79遍', ok: (r) => has(r, '79遍') },
      { name: 'cites 组织审定', ok: (_r, books) => books.includes('组织审定') },
    ],
  },
  {
    label: 'R1d 年三十+年初一',
    q: '年三十和年初一礼佛大忏悔文一共可以念多少遍？',
    checks: [
      { name: 'says 87遍', ok: (r) => has(r, '87遍') },
      {
        name: 'says combined-two-days, not per-day',
        ok: (r) => has(r, '加起来') || has(r, '一共') || has(r, '两天'),
      },
      { name: 'warns not 87 each day', ok: (r) => has(r, '不要每天') || has(r, '不是每天') || has(r, '两天') },
    ],
  },
  {
    label: 'R2 七岁孩子解结咒11遍',
    q: '七岁孩子念解结咒11遍可以吗？',
    checks: [
      { name: 'no 宁可少念几天', ok: (r) => !has(r, '宁可少念几天') },
      { name: 'no 效果打折扣', ok: (r) => !has(r, '效果打折扣') },
    ],
  },
];

async function main() {
  const { searchRelevantTeachings, formatPassagesAsContext } = await import(
    '../src/lib/vector-search'
  );
  const { generateGuardedReplyText, buildSources } = await import('../src/lib/care-pipeline');
  const { checkDraft } = await import('../src/lib/verbatim-guard');

  let failed = 0;

  const results = await Promise.all(
    CASES.map(async (c) => {
      const passages = await searchRelevantTeachings(c.q, undefined, 'zh');
      const contextBlock = formatPassagesAsContext(passages);
      const { fullText, guard } = await generateGuardedReplyText({
        messages: [{ role: 'user', content: c.q }],
        language: 'zh',
        passages,
        contextBlock,
        conversationId: 'regression-test',
      });
      const books = buildSources(passages).map((s) => s.book);
      // Invariant: whatever ships must itself pass the guard.
      const residual = checkDraft(fullText, passages.map((p) => p.text), [c.q]);
      return { c, fullText, guard, books, residual };
    })
  );

  for (const { c, fullText, guard, books, residual } of results) {
    console.log(`\n═══ ${c.label} — guard: ${guard} ═══`);
    console.log(`Q: ${c.q}`);
    console.log(`Sources: ${books.join(' | ')}`);
    for (const check of c.checks) {
      const ok = check.ok(fullText, books);
      if (!ok) failed++;
      console.log(`  ${ok ? '✓' : '✗'} ${check.name}`);
    }
    const residualOk = residual.length === 0;
    if (!residualOk) failed++;
    console.log(`  ${residualOk ? '✓' : '✗'} final text passes guard (${residual.length} residual)`);
    console.log(`--- reply ---\n${fullText}`);
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} CHECKS FAILED`}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
