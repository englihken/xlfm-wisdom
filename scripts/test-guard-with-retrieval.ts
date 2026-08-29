// scripts/test-guard-with-retrieval.ts
// Model-free check of the 08-29 guard fix against REAL retrieval (Pinecone
// only — no Anthropic calls, so it runs even when API credits are out). For
// each question it fetches the live passages, then runs the mechanical guard
// on hand-written drafts that mirror the production failure shapes and the
// expected fixed shapes.
//   npx tsx scripts/test-guard-with-retrieval.ts
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail ?? ''); }
}

async function main() {
  const { searchRelevantTeachings } = await import('../src/lib/vector-search');
  const { checkDraft, stripViolations, chooseGuardTail, scrubContradictoryRefusal, extractNumberTokens } =
    await import('../src/lib/verbatim-guard');

  const tokensWithContext = (ps: { text: string; book: string }[]) => {
    const out: string[] = [];
    for (const p of ps) {
      const flat = p.text.replace(/\s+/g, '');
      const re = /\d+[遍张]/g; let m: RegExpExecArray | null;
      while ((m = re.exec(flat)) !== null) out.push(`[${p.book}] …${flat.slice(Math.max(0, m.index - 30), m.index + m[0].length + 8)}…`);
    }
    return out;
  };

  // ── R10 shape: 失眠 ──────────────────────────────────────────────────────
  console.log('\n— R10 失眠 (real passages) —');
  {
    const q = '我最近失眠很严重，念什么经好？';
    const ps = await searchRelevantTeachings(q, undefined, 'zh');
    const texts = ps.map((p) => p.text);
    const canon = ps.filter((p) => p.type === 'canonical_ruling').map((p) => p.text);
    const chunkTokens = [...new Set(extractNumberTokens(texts.join('\n')))];
    console.log(`  books: ${[...new Set(ps.map((p) => p.book))].join(' | ')}`);
    console.log(`  canonical present: ${canon.length > 0} · chunk tokens: ${chunkTokens.join(' ')}`);
    for (const c of tokensWithContext(ps)) console.log(`    ${c}`);
    assert('retrieval carries at least one N遍', chunkTokens.some((t) => t.endsWith('遍')));

    // The production first draft used memory 功课 numbers → still flagged (rule 2 stays strict).
    const memoryDraft = '📿 《心经》每天3遍\n📿 《大悲咒》每天21遍\n祈求：请大慈大悲观世音菩萨保佑我（姓名）睡眠安稳';
    const v1 = checkDraft(memoryDraft, texts, [q], { canonicalTexts: canon });
    assert('memory numbers 3遍/21遍 still flagged as number_not_in_sources',
      v1.some((x) => x.text === '3遍' && x.reason === 'number_not_in_sources') && v1.some((x) => x.text === '21遍'), v1);

    // A draft that uses the counts the chunks actually state → clean.
    const bian = chunkTokens.filter((t) => t.endsWith('遍'));
    const groundedDraft = `📿 《心经》${bian[0]}\n祈求：请大慈大悲观世音菩萨保佑我（姓名）睡眠安稳，头脑清醒冷静${bian[1] ? `\n📿 《往生咒》${bian[1]}` : ''}`;
    const v2 = checkDraft(groundedDraft, texts, [q], { canonicalTexts: canon });
    assert(`draft using the chunks' own counts (${bian.slice(0, 2).join(', ')}) passes clean`, v2.length === 0, v2);

    // The actual production reply tail (08-29 before-run) is scrubbed once counts exist.
    const prodTail = '关于**具体遍数**——目前我在师父的开示原文里查不到适用于每一个人的通用数字，师父给同修的遍数都是看各人情况定的，我不方便乱给。建议你联系就近的共修会义工，他们会根据你的实际情况给你合适的功课：';
    const r = scrubContradictoryRefusal(`${groundedDraft}\n\n${prodTail}\n📞 总会：+603-6257 3811`);
    assert('production 查不到通用数字 tail scrubbed next to grounded counts', !/查不到|不方便乱给/.test(r.text) && r.removed.length === 1, r);
    assert('grounded counts survive the scrub', extractNumberTokens(r.text).length >= 1, r.text);
  }

  // ── R9 / R5 shape: 组织审定 still wins ───────────────────────────────────
  console.log('\n— R9/R5 礼佛 初一十五 (real passages, canonical present) —');
  {
    const q = '初一十五礼佛大忏悔文可以念多少遍？';
    const ps = await searchRelevantTeachings(q, undefined, 'zh');
    const texts = ps.map((p) => p.text);
    const canon = ps.filter((p) => p.type === 'canonical_ruling').map((p) => p.text);
    console.log(`  books: ${[...new Set(ps.map((p) => p.book))].join(' | ')}`);
    assert('组织审定 chunk retrieved', canon.length > 0);
    const nonCanonTokens = new Set(extractNumberTokens(texts.filter((t) => !canon.includes(t)).join('\n')));
    const canonTokens = new Set(extractNumberTokens(canon.join('\n')));
    const bookOnly = [...nonCanonTokens].filter((t) => !canonTokens.has(t) && t.endsWith('遍'));
    console.log(`  book-only 遍 tokens (not in 组织审定): ${bookOnly.join(' ') || '(none)'}`);

    const good = '按【组织审定】，平时的初一、十五礼佛大忏悔文一天不超过21遍（包含当天功课）。';
    assert('21遍 from 组织审定 passes', checkDraft(good, texts, [q], { canonicalTexts: canon }).length === 0);

    const bad13 = '初一十五礼佛大忏悔文一天不超过13遍。';
    const v13 = checkDraft(bad13, texts, [q], { canonicalTexts: canon });
    assert('13遍 on the 礼佛 subject rejected (not_in_sources or canonical_conflict)',
      v13.some((x) => x.text === '13遍'), v13);

    if (bookOnly.length > 0) {
      const bookOnCanon = `初一十五礼佛大忏悔文可以念${bookOnly[0]}。`;
      const vb = checkDraft(bookOnCanon, texts, [q], { canonicalTexts: canon });
      assert(`book-only ${bookOnly[0]} on the 礼佛 subject → number_canonical_conflict`,
        vb.some((x) => x.text === bookOnly[0] && x.reason === 'number_canonical_conflict'), vb);
      const stripped = stripViolations(`${good}\n\n${bookOnCanon}`, vb);
      assert('conflict sentence stripped, 21遍 kept, tail partial',
        !stripped.includes(bookOnly[0]) && stripped.includes('21遍') && chooseGuardTail(stripped, vb) === 'partial', stripped);
    }

    // R9 contradiction shape: correct 21遍 + blanket tail → tail removed.
    const r = scrubContradictoryRefusal(`${good}\n\n关于具体的遍数／张数，我目前查不到相关原文，不敢随意告诉您数字。建议咨询就近共修会的义工 🙏`);
    assert('R9: blanket tail after grounded 21遍 scrubbed', !r.text.includes('查不到相关原文') && r.text.includes('21遍'), r.text);
  }

  // ── R11 mechanical: refusal path alive ───────────────────────────────────
  console.log('\n— R11 (real passages, invented figure) —');
  {
    const q = '我在国外，时差和马来西亚不同，功课遍数要按当地时间加倍吗？一天要念几遍才够？';
    const ps = await searchRelevantTeachings(q, undefined, 'zh');
    const texts = ps.map((p) => p.text);
    const draft = '按当地时间念就可以。\n\n时差不同的话，一天要念39遍大悲咒才够。\n\n保持心态平和，随缘精进，功德无量 🙏';
    const v = checkDraft(draft, texts, [q]);
    assert('invented 39遍 flagged', v.some((x) => x.text === '39遍' && x.reason === 'number_not_in_sources'), v);
    const stripped = stripViolations(draft, v);
    assert('39遍 stripped, blanket tail chosen', !stripped.includes('39遍') && chooseGuardTail(stripped, v) === 'blanket', stripped);
    const noCounts = '这个问题的具体遍数，我目前查不到相关原文，不敢随意告诉您数字。建议咨询就近共修会的义工 🙏';
    assert('honest refusal with NO counts is left intact', scrubContradictoryRefusal(noCounts).removed.length === 0);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
