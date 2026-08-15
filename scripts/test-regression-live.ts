// scripts/test-regression-live.ts
// Live regression for the anti-fabrication work (brief R1/R2): runs real
// questions through the REAL guarded pipeline (Pinecone retrieval + Opus 5 +
// verbatim guard) and asserts on the final reply text + cited sources.
//   npx tsx scripts/test-regression-live.ts

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

type Check = { name: string; ok: (reply: string, books: string[], types: string[]) => boolean };
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
  // R4 (Phase A): grounds in 解答来信疑惑（第七百五十篇）and cites it with the
  // 开示 date — the exact question answered in that letter.
  {
    label: 'R4 莲花海水池（解答来信 七百五十）',
    q: '念经的时候感觉莲花海水池在面前，正常吗？',
    checks: [
      { name: 'retrieval surfaces letter_qa', ok: (_r, _b, types) => types.includes('letter_qa') },
      { name: 'cites 解答来信疑惑 source', ok: (_r, books) => books.includes('解答来信疑惑') },
      { name: 'cites with 开示 date 2015年8月17日', ok: (r) => has(r, '2015年8月17日') },
      { name: 'grounded answer (正常/不要有意观想)', ok: (r) => has(r, '正常') && (has(r, '观想') || has(r, '走火入魔')) },
    ],
  },
  // R5 (Phase A): a policy-cap question whose retrieval ALSO surfaces letters
  // (the 莲花 half guarantees a letter_qa hit) still takes its numbers from
  // 组织审定 — letters must never displace the canonical table.
  {
    label: 'R5 letters must not displace 组织审定',
    q: '念经时感觉莲花海水池在面前正常吗？另外初一十五礼佛大忏悔文最多可以念几遍？',
    checks: [
      { name: 'retrieval surfaces letter_qa', ok: (_r, _b, types) => types.includes('letter_qa') },
      { name: 'retrieval surfaces canonical_ruling', ok: (_r, _b, types) => types.includes('canonical_ruling') },
      { name: 'says 21遍 (from 组织审定)', ok: (r) => has(r, '21遍') },
      { name: 'cites 组织审定', ok: (_r, books) => books.includes('组织审定') },
      { name: 'NEVER 13遍', ok: (r) => !has(r, '13遍') },
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
      const types = passages.map((p) => p.type ?? '');
      // Invariant: whatever ships must itself pass the guard.
      const residual = checkDraft(fullText, passages.map((p) => p.text), [c.q]);
      return { c, fullText, guard, books, types, residual };
    })
  );

  for (const { c, fullText, guard, books, types, residual } of results) {
    console.log(`\n═══ ${c.label} — guard: ${guard} ═══`);
    console.log(`Q: ${c.q}`);
    console.log(`Sources: ${books.join(' | ')} · types: ${[...new Set(types)].join(',')}`);
    for (const check of c.checks) {
      const ok = check.ok(fullText, books, types);
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
