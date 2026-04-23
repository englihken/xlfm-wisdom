// scripts/test-retrieval-quality.ts
// Retrieval quality regression test for the optimized vector-search pipeline.
//
// Runs 5 representative queries, prints the top-10 chunks' book distribution
// and score spread, and checks whether topic-specific books surface as
// expected. Run with:
//   npx tsx scripts/test-retrieval-quality.ts

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

// Dynamic import so env vars are loaded before src/lib/vector-search.ts
// instantiates the Pinecone client at module load.
type VectorSearchModule = typeof import('../src/lib/vector-search');
let vs: VectorSearchModule;

type RetrievedPassage = VectorSearchModule extends { searchRelevantTeachings: (q: string, k?: number) => Promise<infer R> }
  ? R extends Array<infer P>
    ? P
    : never
  : never;

interface TestCase {
  query: string;
  expectation: string;
  // At least one of the predicates must hold for the case to pass.
  passIf: (passages: RetrievedPassage[]) => { ok: boolean; detail: string };
}

const TOP_K = 10;

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

const CASES: TestCase[] = [
  {
    query: '我老公外遇，我想离婚',
    expectation: '至少 5 个 chunks 来自《婚姻·情感》系列',
    passIf: (ps) => {
      const n = ps.filter((p) => p.book?.startsWith('婚姻·情感')).length;
      return { ok: n >= 5, detail: `婚姻·情感 chunks = ${n}/10 (need ≥5)` };
    },
  },
  {
    query: '失眠怎么办',
    expectation: '语义上与身心健康相关；top-1 score ≥ 0.87（语料中无专职健康书，退而求其次看语义强度 + 心/身/病 主题命中）',
    passIf: (ps) => {
      const top1 = ps[0]?.score ?? 0;
      const themeHits = ps.filter((p) => {
        const hay = `${p.categories ?? ''} ${p.text ?? ''}`;
        return /失眠|睡眠|健康|疾病|身体|治疗|病|头痛|心|烦恼/.test(hay);
      }).length;
      return {
        ok: top1 >= 0.87 && themeHits >= 3,
        detail: `top-1=${top1.toFixed(4)} (need ≥0.87); 身心主题 chunks=${themeHits}/10 (need ≥3)`,
      };
    },
  },
  {
    query: '解结咒怎么念',
    expectation: '精确匹配到"解结咒"原文；top-3 内至少 1 条包含该词且分数 ≥ 0.95',
    passIf: (ps) => {
      const top3 = ps.slice(0, 3);
      const match = top3.find((p) => /解结咒/.test(p.text ?? ''));
      const matchScore = match?.score ?? 0;
      return {
        ok: !!match && matchScore >= 0.95,
        detail: `top-3 含"解结咒"=${!!match}; 最佳匹配 score=${matchScore.toFixed(4)} (need ≥0.95)`,
      };
    },
  },
  {
    query: '什么是业障',
    expectation: '基础教法优先（白话佛法 / 佛学问答175问 / 佛学常识开示锦集）',
    passIf: (ps) => {
      const foundationBooks = ps.filter((p) => {
        const b = p.book ?? '';
        return (
          b.startsWith('白话佛法') ||
          b.includes('佛学问答') ||
          b.includes('佛学常识')
        );
      }).length;
      return {
        ok: foundationBooks >= 4,
        detail: `基础教法 chunks = ${foundationBooks}/10 (need ≥4)`,
      };
    },
  },
  {
    query: '小房子怎么填',
    expectation: '《小房子念诵指南》优先',
    passIf: (ps) => {
      const xfzHits = ps.filter((p) => p.book === '小房子念诵指南').length;
      return {
        ok: xfzHits >= 3,
        detail: `《小房子念诵指南》chunks = ${xfzHits}/10 (need ≥3)`,
      };
    },
  },
  // --- Wave 6A coverage ---
  {
    query: '我身体很痛怎么办',
    expectation: '疾病类书（疾病百科 / 疾病实例 / book_category=health）优先',
    passIf: (ps) => {
      const healthHits = ps.filter((p) => {
        const b = p.book ?? '';
        return (
          b.startsWith('疾病百科') ||
          b.startsWith('心灵法门治疗疾病灵验实例') ||
          b.startsWith('疾病实例')
        );
      }).length;
      return {
        ok: healthHits >= 3,
        detail: `疾病类书 chunks = ${healthHits}/10 (need ≥3)`,
      };
    },
  },
  {
    query: '自杀的果报是什么',
    expectation: '《佛子天地游记》出现在 top-10（因果警示场景）',
    passIf: (ps) => {
      const spiritHits = ps.filter((p) =>
        (p.book ?? '').startsWith('佛子天地游记')
      ).length;
      return {
        ok: spiritHits >= 1,
        detail: `《佛子天地游记》chunks = ${spiritHits}/10 (need ≥1)`,
      };
    },
  },
];

function formatScore(n: number): string {
  return n.toFixed(4);
}

async function runCase(tc: TestCase, idx: number) {
  const topics = vs.detectTopics(tc.query);
  console.log('\n' + '='.repeat(78));
  console.log(`#${idx + 1}  Q: "${tc.query}"`);
  console.log(`    期待: ${tc.expectation}`);
  console.log(`    检测主题: [${topics.join(', ') || '—'}]`);
  console.log('-'.repeat(78));

  const t0 = Date.now();
  const passages = await vs.searchRelevantTeachings(tc.query, TOP_K);
  const elapsed = Date.now() - t0;

  if (passages.length === 0) {
    console.log('    ⚠ 无结果');
    return { tc, passages, ok: false, detail: 'no results' };
  }

  // Book distribution
  const byBook = countBy(passages, (p) => p.book || 'Unknown');
  const bookList = Object.entries(byBook)
    .sort((a, b) => b[1] - a[1])
    .map(([b, n]) => `${b}×${n}`)
    .join(', ');

  const scores = passages.map((p) => p.score);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const avgS = scores.reduce((a, b) => a + b, 0) / scores.length;

  console.log(`    Top-${passages.length} 书分布: ${bookList}`);
  console.log(
    `    Score: min=${formatScore(minS)} avg=${formatScore(avgS)} max=${formatScore(maxS)}  (${elapsed}ms)`
  );

  // Full top-10 list
  for (let i = 0; i < passages.length; i++) {
    const p = passages[i];
    const page = p.page_start
      ? p.page_start === p.page_end
        ? ` p.${p.page_start}`
        : ` p.${p.page_start}-${p.page_end}`
      : '';
    console.log(
      `      ${String(i + 1).padStart(2, ' ')}. [${formatScore(p.score)}] ${p.book}${page}  · ${p.type ?? '-'}`
    );
  }

  const check = tc.passIf(passages);
  const mark = check.ok ? '✅ PASS' : '❌ FAIL';
  console.log(`    ${mark} — ${check.detail}`);

  return { tc, passages, ok: check.ok, detail: check.detail };
}

async function main() {
  vs = await import('../src/lib/vector-search');
  console.log('🧪 XLFM Retrieval Quality Test');
  console.log(`   DEFAULT_TOP_K=${TOP_K}, filter: book_category for marriage_emotion`);

  const results = [];
  for (let i = 0; i < CASES.length; i++) {
    const r = await runCase(CASES[i], i);
    results.push(r);
    // Small delay to be gentle on Pinecone QPS
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log('\n' + '='.repeat(78));
  console.log('汇总:');
  let pass = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(
      `  #${i + 1} ${r.ok ? '✅' : '❌'}  "${r.tc.query}"  — ${r.detail}`
    );
    if (r.ok) pass++;
  }
  console.log(`\n  通过: ${pass}/${results.length}`);
  console.log('='.repeat(78));

  if (pass < results.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
