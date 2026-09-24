// scripts/doctrine-attribution-sample.ts — 教义护栏 §5 (c) calibration sample.
// For each sampled 「台长说过…」 line (JSON: [conv, MMDD, line, visitorMsg, prevVisitorMsg]),
// re-runs production retrieval for the visitor's message (Pinecone + pinned canon,
// no model calls), then scores every claim in the line with attributionClaims()
// and prints a markdown table: Dice, longest common substring, verdict.
//   npx tsx scripts/doctrine-attribution-sample.ts <sample.json> [--dice 0.5] [--lcs 8]
// Retrieval today is not the retrieval at reply time (index and pinned cards
// have changed since), so a claim scored "unsourced" here is a candidate,
// not proof — the report reads the table together with the claim text.
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

type Row = [string, string, string, string, string | null];

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: doctrine-attribution-sample.ts <sample.json>');
  const rows: Row[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { searchRelevantTeachings } = await import('../src/lib/vector-search');
  const { attributionClaims, ATTRIBUTION_DICE_MIN, ATTRIBUTION_LCS_MIN } = await import('../src/lib/doctrine-guard');
  const { retrievalContextFrom } = await import('../src/lib/care-pipeline');
  const { assembleSystemPrompt } = await import('../src/lib/prompt/assemble');
  const prompt = assembleSystemPrompt('zh'); // production grounds claims on passages + prompt modules
  console.log(`thresholds: dice ≥ ${ATTRIBUTION_DICE_MIN} or lcs ≥ ${ATTRIBUTION_LCS_MIN} or substring\n`);
  console.log('| # | 对话 | 日期 | 主张（台长说过…之后） | 判定 | Dice | LCS |');
  console.log('|---|---|---|---|---|---|---|');
  let n = 0;
  const ms: number[] = [];
  const cache = new Map<string, string[]>();
  for (const [conv, d, line, q, qPrev] of rows) {
    const key = `${qPrev ?? ''}\u0000${q}`;
    let texts = cache.get(key);
    if (!texts) {
      const history = qPrev ? [{ role: 'user' as const, content: qPrev }] : [];
      const passages = await searchRelevantTeachings(q, retrievalContextFrom(history), 'zh');
      texts = passages.map((p) => p.text);
      cache.set(key, texts);
    }
    const t0 = Date.now();
    const claims = attributionClaims(line, [...texts, prompt]);
    ms.push(Date.now() - t0);
    if (claims.length === 0) {
      n++;
      console.log(`| ${n} | ${conv} | ${d} | （引入语，主张 < 6 字，跳过）${line.slice(0, 30).replace(/\|/g, '｜')}… | skip | – | – |`);
      continue;
    }
    for (const c of claims) {
      n++;
      const shown = c.claim.length > 50 ? `${c.claim.slice(0, 50)}…` : c.claim;
      console.log(`| ${n} | ${conv} | ${d} | ${shown.replace(/\|/g, '｜')} | ${c.grounded ? `有依据（${c.how}）` : '**无依据**'} | ${c.dice.toFixed(2)} | ${c.lcs} |`);
    }
  }
  ms.sort((a, b) => a - b);
  console.log(`
check time per reply line: median ${ms[Math.floor(ms.length / 2)]} ms, max ${ms[ms.length - 1]} ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
