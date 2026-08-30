// scripts/chip-refusal-rate.ts
// Runs the six homepage chip questions (src/app/qa/page.tsx QUICK_QUESTIONS.zh)
// through the REAL guarded pipeline and reports, per question: guard outcome,
// 组织审定 presence, the N遍/N张 tokens available in the retrieved chunks vs the
// tokens that survived into the reply, and whether a 查不到/不敢给 refusal
// phrase appears. Ends with the refusal rate — the metric the 08-29 brief
// tracks (pre-guard 0% → guard-live 13–17%).
//   npx tsx scripts/chip-refusal-rate.ts
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const CHIPS = [
  '我最近失眠很严重，念什么经好？',
  '和家人一直吵架，我可以先学什么？',
  '工作一直不顺，是不是有业障？',
  '孩子不听话，我应该如何面对自己的情绪？',
  '刚开始接触心灵法门，第一步应该做什么？',
  '家人生病了，我应该为他念什么经？',
];
const REFUSAL = /查不到相关原文|不敢乱给|不敢随意|查不到原文/;

async function main() {
  const { searchRelevantTeachings, formatPassagesAsContext } = await import('../src/lib/vector-search');
  const { generateGuardedReplyText } = await import('../src/lib/care-pipeline');
  const { extractNumberTokens } = await import('../src/lib/verbatim-guard');

  const logs: string[] = [];
  const origErr = console.error;
  console.error = (...a: unknown[]) => {
    const s = a.map(String).join(' ');
    if (s.includes('[verbatim-guard]')) logs.push(s);
    origErr(...a);
  };

  const results = await Promise.all(
    CHIPS.map(async (q, i) => {
      const passages = await searchRelevantTeachings(q, undefined, 'zh');
      const contextBlock = formatPassagesAsContext(passages);
      const { fullText, guard } = await generateGuardedReplyText({
        messages: [{ role: 'user', content: q }],
        language: 'zh',
        passages,
        contextBlock,
        conversationId: `chip-${i + 1}`,
      });
      const chunkTokens = new Set(passages.flatMap((p) => extractNumberTokens(p.text)));
      // Where each count lives in the retrieved text (±25 chars) — shows at a
      // glance whether a 功课 prescription was available to the model.
      const contexts: string[] = [];
      for (const p of passages) {
        const flat = p.text.replace(/\s+/g, '');
        const re = /\d+[遍张]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(flat)) !== null) {
          contexts.push(`[${p.book}] …${flat.slice(Math.max(0, m.index - 25), m.index + m[0].length + 10)}…`);
        }
      }
      return {
        contexts,
        q,
        guard,
        canonical: passages.filter((p) => p.type === 'canonical_ruling').length,
        types: [...new Set(passages.map((p) => p.type ?? '?'))].join(','),
        books: [...new Set(passages.map((p) => p.book))].join(' | '),
        chunkTokens: [...chunkTokens].join(' '),
        replyTokens: extractNumberTokens(fullText).join(' '),
        refusal: REFUSAL.test(fullText),
        fullText,
      };
    })
  );

  let refusals = 0;
  for (const r of results) {
    if (r.refusal) refusals++;
    console.log(`\n═══ ${r.q} ═══`);
    console.log(`guard=${r.guard} canonical=${r.canonical} types=${r.types}`);
    console.log(`books: ${r.books}`);
    console.log(`chunk tokens: ${r.chunkTokens}`);
    for (const ctx of r.contexts) console.log(`   ${ctx}`);
    console.log(`reply tokens: ${r.replyTokens || '(none)'}  refusal-phrase=${r.refusal}`);
    console.log(`--- reply ---\n${r.fullText}`);
  }
  console.log(`\n=== guard log lines ===\n${logs.join('\n')}`);
  console.log(`\nREFUSAL RATE: ${refusals}/${CHIPS.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
