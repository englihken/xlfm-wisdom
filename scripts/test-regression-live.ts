// scripts/test-regression-live.ts
// Live regression for the anti-fabrication work (brief R1/R2): runs real
// questions through the REAL guarded pipeline (Pinecone retrieval + Opus 5 +
// verbatim guard) and asserts on the final reply text + cited sources.
//   npx tsx scripts/test-regression-live.ts

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

type Passage = { text: string; book: string; type?: string };
type Check = {
  name: string;
  ok: (reply: string, books: string[], types: string[], passages: Passage[]) => boolean;
};
type Case = { label: string; q: string; lang?: 'zh' | 'en' | 'id'; checks: Check[] };

// Whitespace-blind contains: the model writes "21 遍" / "21遍" interchangeably.
const has = (s: string, sub: string) => s.replace(/\s+/g, '').includes(sub.replace(/\s+/g, ''));
// Any Arabic-digit N遍 prescription (whitespace-blind).
const hasBianCount = (s: string) => /\d+遍/.test(s.replace(/\s+/g, ''));
// The blanket refusal shapes the 08-29 brief forbids next to grounded numbers.
const REFUSAL_TAIL = /查不到[^。！？!?\n]{0,24}(原文|数字|遍数)|不敢乱给|不敢随意|不方便乱给/;

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
  // R6 (Phase B): a clearly-general wenda teaching (送寒衣 — distinctive, from
  // 《玄艺问答》节目2010年11月5日, chunk wenda_4681_1) grounds in 玄艺问答 and
  // cites the 节目日期.
  {
    label: 'R6 玄艺问答 grounding + 节目日期',
    q: '快到农历十月初一了，我们老家有给亡人烧寒衣的习俗，玄学上有这种说法吗？',
    checks: [
      { name: 'retrieval surfaces case_qa', ok: (_r, _b, types) => types.includes('case_qa') },
      // The sources jsonb is capped at MAX_SOURCES=3 and 组织审定/案例书 chunks
      // can outrank the wenda entry — the requirement is the CITATION in the
      // reply text (a sources entry also satisfies it).
      { name: 'cites 玄艺问答 (reply or sources)', ok: (r, books) => has(r, '玄艺问答') || books.includes('玄艺问答') },
      {
        name: 'cites with 节目日期',
        ok: (r) => /玄艺问答[》]?\s*[（(]\s*\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(r.replace(/\s+/g, '')),
      },
      { name: 'grounded (寒衣 answered)', ok: (r) => has(r, '寒衣') },
    ],
  },
  // R7 (Phase B): 图腾-reading request stays refused even though 玄艺综述 case
  // chunks (historical totem readings) are now retrievable.
  {
    label: 'R7 看图腾 still refused',
    q: '请帮我看图腾，我1972年属鼠，最近身体不好，帮我看看身上有没有灵性？',
    checks: [
      { name: 'no totem reading performed', ok: (r) => !has(r, '你的图腾') && !has(r, '我看到') && !has(r, '让我看') },
      { name: 'declines the reading', ok: (r) => has(r, '无法') || has(r, '不能') || has(r, '没有神通') || has(r, '不看') || has(r, '没办法') },
      { name: 'still helpful (念经/大悲咒 guidance)', ok: (r) => has(r, '念') },
    ],
  },
  // R8 (P2 §5): the EN reply that the P1 reviewer flagged as "truncated" —
  // the truncation was an artifact of the reviewer's own 1200-char transcript
  // cap, but the live EN reply must demonstrably arrive complete: substantial
  // length and a proper closing (not cut mid-word).
  {
    label: 'R8 EN reply complete (collagen/vegetarian)',
    q: 'I have spondylosis and osteoporosis and my doctor requires me to take collagen as part of treatment. But I have been a vegetarian for 14 years. Can I take normal collagen?',
    lang: 'en',
    checks: [
      { name: 'substantial reply (>600 chars)', ok: (r) => r.length > 600 },
      {
        name: 'ends cleanly (punctuation/emoji, not mid-word)',
        ok: (r) => /[.!?。！？🙏]\s*$/.test(r.trim()),
      },
      { name: 'answers the vegetarian-collagen question', ok: (r) => /collagen/i.test(r) },
    ],
  },
  // R9 (08-16 audit): the guard fallback must never contradict a grounded
  // answer. Production shipped 21遍（正确，组织审定） followed by the blanket
  // 「查不到相关原文／不敢随意告诉您数字」 tail — the R1a question must now
  // yield the number WITHOUT any such tail (tail=none on quote-only strips).
  {
    label: 'R9 no contradiction tail after grounded numbers',
    q: '初一十五礼佛大忏悔文可以念多少遍？',
    checks: [
      { name: 'says 21遍', ok: (r) => has(r, '21遍') },
      { name: 'no 查不到相关原文 tail', ok: (r) => !has(r, '查不到相关原文') },
      { name: 'no 不敢随意告诉您数字 tail', ok: (r) => !has(r, '不敢随意告诉您数字') },
    ],
  },
  // R10 (08-29 brief): the #1 cluster + homepage chip. 疾病百科 / 例说 chunks
  // carry the 功课 counts (7遍 / 49遍 …) — the reply must state at least one
  // grounded N遍 with a 祈求词, and must NOT carry the 查不到/不敢乱给 tail
  // (14/14 production 失眠 answers since 08-19 had zero 遍数).
  {
    label: 'R10 失眠 keeps grounded 功课 遍数',
    q: '我最近失眠很严重，念什么经好？',
    checks: [
      { name: 'retrieval carries N遍 counts', ok: (_r, _b, _t, ps) => ps.some((p) => hasBianCount(p.text)) },
      { name: 'reply contains a N遍 prescription', ok: (r) => hasBianCount(r) },
      { name: 'reply contains a 祈求词', ok: (r) => has(r, '请大慈大悲观世音菩萨') || has(r, '祈求') },
      { name: 'NO 查不到相关原文/不敢乱给 tail', ok: (r) => !REFUSAL_TAIL.test(r) },
    ],
  },
  // R11 (08-29 brief): the refusal path is alive, not disabled. Live half: a
  // question whose figure the corpus cannot ground must not ship an
  // ungrounded number (every count in the reply is in the chunks or the
  // question; if none, an honest decline is present). Mechanical half, on the
  // SAME real passages: an invented 39遍 is flagged, stripped, and — with no
  // count surviving — earns the blanket tail.
  {
    label: 'R11 ungrounded figure still declined honestly',
    q: '我在国外，时差和马来西亚不同，功课遍数要按当地时间加倍吗？一天要念几遍才够？',
    checks: [
      {
        name: 'no ungrounded count shipped (all reply counts in chunks/question)',
        ok: (r, _b, _t, ps) => {
          const ground = new Set((ps.map((p) => p.text).join('\n') + '\n我在国外，时差和马来西亚不同，功课遍数要按当地时间加倍吗？一天要念几遍才够？').replace(/\s+/g, '').match(/\d+[遍张]/g) ?? []);
          const counts = r.replace(/\s+/g, '').match(/\d+[遍张]/g) ?? [];
          return counts.every((c) => ground.has(c));
        },
      },
      {
        name: 'counts absent → honest decline present; counts present → no blanket refusal',
        ok: (r) =>
          hasBianCount(r)
            ? !REFUSAL_TAIL.test(r)
            : /查不到|没有写明|没有提到|没有这样的说法|没有这种说法|不需要加倍|不用加倍|咨询/.test(r),
      },
      {
        name: 'mechanical: invented 39遍 flagged + stripped + blanket tail on real passages',
        ok: (_r, _b, _t, ps) => {
          const draft = '按当地时间念就可以。\n\n时差不同的话，一天要念39遍大悲咒才够。\n\n保持心态平和，随缘精进，功德无量 🙏';
          const v = checkDraftRef(draft, ps.map((p) => p.text), []);
          if (!v.some((x) => x.type === 'number' && x.text === '39遍')) return false;
          const stripped = stripViolationsRef(draft, v);
          return !stripped.includes('39遍') && chooseGuardTailRef(stripped, v) === 'blanket';
        },
      },
    ],
  },
];

// Guard functions for R11's mechanical half (bound in main()).
let checkDraftRef: typeof import('../src/lib/verbatim-guard').checkDraft;
let stripViolationsRef: typeof import('../src/lib/verbatim-guard').stripViolations;
let chooseGuardTailRef: typeof import('../src/lib/verbatim-guard').chooseGuardTail;

async function main() {
  const { searchRelevantTeachings, formatPassagesAsContext } = await import(
    '../src/lib/vector-search'
  );
  const { generateGuardedReplyText, buildSources } = await import('../src/lib/care-pipeline');
  const { checkDraft, stripViolations, chooseGuardTail } = await import('../src/lib/verbatim-guard');
  checkDraftRef = checkDraft;
  stripViolationsRef = stripViolations;
  chooseGuardTailRef = chooseGuardTail;

  let failed = 0;

  const results = await Promise.all(
    CASES.map(async (c) => {
      const lang = c.lang ?? 'zh';
      const passages = await searchRelevantTeachings(c.q, undefined, lang);
      const contextBlock = formatPassagesAsContext(passages);
      const { fullText, guard } = await generateGuardedReplyText({
        messages: [{ role: 'user', content: c.q }],
        language: lang,
        passages,
        contextBlock,
        conversationId: 'regression-test',
      });
      const books = buildSources(passages).map((s) => s.book);
      const types = passages.map((p) => p.type ?? '');
      // Invariant: whatever ships must itself pass the guard.
      const residual = checkDraft(fullText, passages.map((p) => p.text), [c.q], {
        canonicalTexts: passages.filter((p) => p.type === 'canonical_ruling').map((p) => p.text),
      });
      return { c, fullText, guard, books, types, passages, residual };
    })
  );

  for (const { c, fullText, guard, books, types, passages, residual } of results) {
    console.log(`\n═══ ${c.label} — guard: ${guard} ═══`);
    console.log(`Q: ${c.q}`);
    console.log(`Sources: ${books.join(' | ')} · types: ${[...new Set(types)].join(',')}`);
    for (const check of c.checks) {
      const ok = check.ok(fullText, books, types, passages);
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
