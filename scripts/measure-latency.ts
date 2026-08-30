// scripts/measure-latency.ts
// Latency breakdown for a 智慧问答 turn (入门轮 brief 08-30, problem 3):
//   1. Pinecone: wall-clock of the parallel query fan-out + per-query ms
//   2. Anthropic: time-to-first-byte, time to first visible text, total, and
//      the prompt-cache split (cache_read vs cache_creation input tokens)
//   3. Guard: how many model calls the turn needed (1 = clean, 2 = retry,
//      3 = over-strip regeneration)
// Runs N two-turn conversations back to back so the 5-minute ephemeral cache
// state is visible: the very first call is a cold cache_creation, later calls
// within the window should be cache_read.
//   npx tsx scripts/measure-latency.ts [--rounds 2]
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const CONVERSATIONS: string[][] = [
  ['和家人一直吵架，我可以先学什么？', '没有念过'],
  ['我最近失眠很严重，念什么经好？', '没有学过'],
  ['家人生病了，我应该为他念什么经？', '我们都没念过经'],
];

type Timing = { attempt: number; ttfb: number; firstText: number; total: number; input: number; cacheRead: number; cacheCreate: number; output: number };
type Turn = { label: string; retrievalMs: number; parallel: number; perQuery: string; calls: Timing[]; wallMs: number };

async function main() {
  const roundsArg = process.argv.indexOf('--rounds');
  const rounds = roundsArg >= 0 ? parseInt(process.argv[roundsArg + 1] ?? '1', 10) : 1;

  const { searchRelevantTeachings, formatPassagesAsContext } = await import('../src/lib/vector-search');
  const { generateGuardedReplyText, retrievalContextFrom } = await import('../src/lib/care-pipeline');

  // Capture the pipeline's own log lines instead of re-instrumenting.
  let current: Turn | null = null;
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => {
    const s = a.map(String).join(' ');
    if (current && s.startsWith('[vector-search] timing')) {
      const m = s.match(/parallel=(\d+) wall_ms=(\d+) per_query=(.*)$/);
      if (m) { current.parallel = Number(m[1]); current.retrievalMs = Number(m[2]); current.perQuery = m[3]; }
    } else if (current && s.startsWith('[care-pipeline] timing')) {
      const g = (k: string) => Number((s.match(new RegExp(`${k}=(-?\\d+)`)) ?? [])[1] ?? -1);
      current.calls.push({ attempt: g('attempt'), ttfb: g('ttfb_ms'), firstText: g('first_text_ms'), total: g('total_ms'), input: g('input'), cacheRead: g('cache_read'), cacheCreate: g('cache_create'), output: g('output') });
    }
  };
  console.error = (...a: unknown[]) => { const s = a.map(String).join(' '); if (!s.startsWith('[verbatim-guard]') && !s.startsWith('[supabase]')) origErr(...a); };

  const turns: Turn[] = [];
  for (let r = 0; r < rounds; r++) {
    for (const conv of CONVERSATIONS) {
      const messages: { role: 'user' | 'assistant'; content: string }[] = [];
      for (const q of conv) {
        current = { label: `${conv[0].slice(0, 6)}… / ${q}`, retrievalMs: -1, parallel: 0, perQuery: '', calls: [], wallMs: 0 };
        const t0 = Date.now();
        const passages = await searchRelevantTeachings(q, undefined, 'zh', retrievalContextFrom(messages));
        const contextBlock = formatPassagesAsContext(passages);
        messages.push({ role: 'user', content: q });
        const { fullText } = await generateGuardedReplyText({ messages, language: 'zh', passages, contextBlock, conversationId: 'latency-test' });
        messages.push({ role: 'assistant', content: fullText });
        current.wallMs = Date.now() - t0;
        turns.push(current);
        current = null;
      }
    }
  }
  console.log = origLog;

  origLog('\n=== per turn ===');
  for (const t of turns) {
    origLog(`\n${t.label}`);
    origLog(`  wall=${t.wallMs}ms  pinecone: wall=${t.retrievalMs}ms parallel=${t.parallel} per_query=${t.perQuery}`);
    for (const c of t.calls) {
      const cacheState = c.cacheRead > 0 ? 'HIT' : c.cacheCreate > 0 ? 'MISS(create)' : 'none';
      origLog(`  model#${c.attempt}: ttfb=${c.ttfb}ms first_text=${c.firstText}ms total=${c.total}ms | input=${c.input} cache_read=${c.cacheRead} cache_create=${c.cacheCreate} output=${c.output} → cache ${cacheState}`);
    }
  }

  const calls = turns.flatMap((t) => t.calls);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const hits = calls.filter((c) => c.cacheRead > 0).length;
  origLog('\n=== summary ===');
  origLog(`turns=${turns.length} model_calls=${calls.length} (calls/turn=${(calls.length / turns.length).toFixed(2)}; retries=${calls.length - turns.length})`);
  origLog(`pinecone wall avg=${avg(turns.map((t) => t.retrievalMs))}ms max=${Math.max(...turns.map((t) => t.retrievalMs))}ms`);
  origLog(`anthropic ttfb avg=${avg(calls.map((c) => c.ttfb))}ms first_text avg=${avg(calls.map((c) => c.firstText))}ms total avg=${avg(calls.map((c) => c.total))}ms max=${Math.max(...calls.map((c) => c.total))}ms`);
  origLog(`prompt cache: hits=${hits}/${calls.length} · cached prefix ≈ ${avg(calls.filter((c) => c.cacheRead > 0).map((c) => c.cacheRead)) || avg(calls.map((c) => c.cacheCreate))} tokens · uncached input avg=${avg(calls.map((c) => c.input))} · output avg=${avg(calls.map((c) => c.output))} tokens`);
  origLog(`turn wall avg=${avg(turns.map((t) => t.wallMs))}ms max=${Math.max(...turns.map((t) => t.wallMs))}ms`);
}
main().catch((e) => { console.error(e); process.exit(1); });
