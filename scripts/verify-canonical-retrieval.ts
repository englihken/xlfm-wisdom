// scripts/verify-canonical-retrieval.ts
// Checks that 组织审定 canonical chunks retrieve + rank first for doctrinal
// 遍数 queries, via the REAL searchRelevantTeachings pipeline.
//   npx tsx scripts/verify-canonical-retrieval.ts

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const QUERIES = [
  '初一十五礼佛大忏悔文可以念多少遍？',
  '观音菩萨圣诞礼佛可以念几遍？',
  '中秋节可以烧送多少张小房子？',
  '孕妇特殊日子礼佛可以念几遍？',
  '七岁孩子念解结咒11遍可以吗？',
];

async function main() {
  const { searchRelevantTeachings } = await import('../src/lib/vector-search');
  for (const q of QUERIES) {
    const results = await searchRelevantTeachings(q, undefined, 'zh');
    console.log(`\nQ: ${q}`);
    results.slice(0, 5).forEach((r, i) => {
      console.log(
        `  ${i + 1}. [${r.score.toFixed(3)}] ${r.book}${r.type === 'canonical_ruling' ? ' ★canonical' : ''} — ${r.text.slice(0, 40).replace(/\n/g, ' ')}`
      );
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
