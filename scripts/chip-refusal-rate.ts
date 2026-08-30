// scripts/chip-refusal-rate.ts
// Runs the six homepage chip questions (src/app/qa/page.tsx QUICK_QUESTIONS.zh)
// AND the beginner follow-up turns (入门锚定 brief) through the REAL guarded
// pipeline and reports, per question: guard outcome, 组织审定 presence, the
// N遍/N张 tokens available in the retrieved chunks vs the tokens that survived
// into the reply, and whether a 查不到/不敢给 refusal phrase appears.
//
// Two rates at the end:
//   CHIP REFUSAL RATE     — single-turn chips carrying a refusal phrase
//   入门轮 REFUSAL RATE    — beginner follow-up turns that either carry a
//                           refusal phrase OR ship no N遍 at all (a 功课 answer
//                           without a count is a refusal in effect — conv c47ffe52)
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
// Beginner follow-ups: the visitor's second turn after the triage question.
const BEGINNER_TURNS: string[][] = [
  ['我最近失眠很严重，念什么经好？', '没有学过'],
  ['刚开始接触心灵法门，第一步应该做什么？', '没学过，不会念'],
  ['家人生病了，我应该为他念什么经？', '我们都没念过经'],
  ['我想开始念小房子', '还没有开始念功课'],
];
const REFUSAL = /查不到相关原文|查不到.{0,24}(原文|数字|遍数|标准|说法)|不敢乱给|不敢乱说|不敢随意|不方便乱给|查不到原文/;

type Run = {
  label: string;
  guard: string;
  canonical: number;
  types: string;
  books: string;
  chunkTokens: string;
  contexts: string[];
  replyTokens: string;
  hasCount: boolean;
  refusal: boolean;
  fullText: string;
  transcript: string[];
};

async function main() {
  const { searchRelevantTeachings, formatPassagesAsContext } = await import('../src/lib/vector-search');
  const { generateGuardedReplyText, retrievalContextFrom } = await import('../src/lib/care-pipeline');
  const { extractNumberTokens } = await import('../src/lib/verbatim-guard');

  const logs: string[] = [];
  const origErr = console.error;
  console.error = (...a: unknown[]) => {
    const s = a.map(String).join(' ');
    if (s.includes('[verbatim-guard]')) logs.push(s);
    origErr(...a);
  };

  const run = async (label: string, turns: string[], convId: string): Promise<Run> => {
    const messages: { role: 'user' | 'assistant'; content: string }[] = [];
    let passages: Awaited<ReturnType<typeof searchRelevantTeachings>> = [];
    let fullText = '';
    let guard = '';
    const transcript: string[] = [];
    for (const turn of turns) {
      passages = await searchRelevantTeachings(turn, undefined, 'zh', retrievalContextFrom(messages));
      const contextBlock = formatPassagesAsContext(passages);
      messages.push({ role: 'user', content: turn });
      const out = await generateGuardedReplyText({
        messages,
        language: 'zh',
        passages,
        contextBlock,
        conversationId: convId,
      });
      fullText = out.fullText;
      guard = out.guard;
      messages.push({ role: 'assistant', content: fullText });
      transcript.push(`访客：${turn}`);
    }
    const chunkTokens = new Set(passages.flatMap((p) => extractNumberTokens(p.text)));
    // Where each count lives in the retrieved text (±25 chars) — shows at a
    // glance whether a 功课 prescription was available to the model.
    const contexts: string[] = [];
    for (const p of passages) {
      const flat = p.text.replace(/\s+/g, '');
      const re = /\d+[遍张]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(flat)) !== null) {
        contexts.push(`[${p.book}${p.page_start ? ' p' + p.page_start : ''}] …${flat.slice(Math.max(0, m.index - 25), m.index + m[0].length + 10)}…`);
      }
    }
    const replyTokens = extractNumberTokens(fullText);
    return {
      label,
      guard,
      canonical: passages.filter((p) => p.type === 'canonical_ruling').length,
      types: [...new Set(passages.map((p) => p.type ?? '?'))].join(','),
      books: [...new Set(passages.map((p) => p.book))].join(' | '),
      chunkTokens: [...chunkTokens].join(' '),
      contexts,
      replyTokens: replyTokens.join(' '),
      hasCount: replyTokens.some((t) => t.endsWith('遍')),
      refusal: REFUSAL.test(fullText),
      fullText,
      transcript,
    };
  };

  // `--beginner-only` skips the six single-turn chips (cost control).
  const beginnerOnly = process.argv.includes('--beginner-only');
  const [chipRuns, beginnerRuns] = await Promise.all([
    beginnerOnly ? Promise.resolve([] as Run[]) : Promise.all(CHIPS.map((q, i) => run(q, [q], `chip-${i + 1}`))),
    Promise.all(BEGINNER_TURNS.map((t, i) => run(t.join(' → '), t, `beginner-${i + 1}`))),
  ]);

  const print = (r: Run) => {
    console.log(`\n═══ ${r.label} ═══`);
    console.log(`guard=${r.guard} canonical=${r.canonical} types=${r.types}`);
    console.log(`books: ${r.books}`);
    console.log(`chunk tokens: ${r.chunkTokens}`);
    for (const ctx of r.contexts) console.log(`   ${ctx}`);
    console.log(`reply tokens: ${r.replyTokens || '(none)'}  refusal-phrase=${r.refusal}`);
    console.log(`--- reply ---\n${r.fullText}`);
  };

  console.log('\n################ 首页六个 chip（单轮） ################');
  chipRuns.forEach(print);
  console.log('\n################ 入门跟进轮（两轮，检查第2轮） ################');
  beginnerRuns.forEach(print);

  console.log(`\n=== guard log lines ===\n${logs.join('\n')}`);
  const chipRefusals = chipRuns.filter((r) => r.refusal).length;
  const beginnerRefusals = beginnerRuns.filter((r) => r.refusal || !r.hasCount).length;
  console.log(`\nCHIP REFUSAL RATE: ${chipRefusals}/${CHIPS.length}`);
  console.log(`入门轮 REFUSAL RATE (refusal phrase OR no N遍): ${beginnerRefusals}/${BEGINNER_TURNS.length}`);
  for (const r of beginnerRuns) console.log(`  ${r.refusal || !r.hasCount ? '✗' : '✓'} ${r.label} — tokens: ${r.replyTokens || '(none)'} refusal=${r.refusal}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
