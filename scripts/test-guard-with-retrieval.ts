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
    // F01: the check is (subject, count)-bound now — 「《大悲咒》21遍」 is flagged
    // unless a chunk pairs 大悲咒 with 21遍; 「《心经》3遍」 may legitimately be
    // grounded (疾病百科 states it). At least one memory pair must be caught.
    // Since the 09-11 enumeration / PDF-line-join fix, 《入门手册》 p29 (「念
    // 《大悲咒》 7 - 21 遍」 for 求工作顺利) can legitimately pair 大悲咒 with 21遍
    // when it is retrieved — so the memory draft is only "wrong" when no chunk
    // states that pair. Assert the rule, not the historical outcome.
    // (extractNumberPairs is imported a few lines below for the same block)
    const grounded21 = (await import('../src/lib/verbatim-guard-pairs')).extractNumberPairs(texts.join('\n\n')).some((p) => p.subject === '大悲咒' && p.token === '21遍');
    assert(`memory 功课 pairs flagged unless a retrieved chunk pairs 大悲咒 with 21遍 (grounded here: ${grounded21})`,
      grounded21 ? v1.length === 0 : v1.some((x) => x.reason === 'number_not_in_sources'), v1);

    // A draft that uses the counts the chunks actually state → clean.
    // F01: a grounded draft must reuse the chunks' own (subject, count) PAIRS,
    // not attach an arbitrary chunk count to 《心经》.
    const { extractNumberPairs } = await import('../src/lib/verbatim-guard-pairs');
    const pairs = extractNumberPairs(texts.join('\n\n')).filter((p) => p.subject && p.token.endsWith('遍'));
    const p0 = pairs[0];
    const p1 = pairs.find((p) => p.subject !== p0?.subject);
    const bian = [p0 ? `《${p0.subject}》${p0.token}` : '', p1 ? `《${p1.subject}》${p1.token}` : ''];
    const groundedDraft = `📿 ${bian[0]}\n祈求：请大慈大悲观世音菩萨保佑我（姓名）睡眠安稳，头脑清醒冷静${bian[1] ? `\n📿 ${bian[1]}` : ''}`;
    const v2 = checkDraft(groundedDraft, texts, [q], { canonicalTexts: canon });
    assert(`draft using the chunks' own pairs (${bian.filter(Boolean).join(', ')}) passes clean`, v2.length === 0, v2);

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

  // ── 09-12 strip-tails §A.2 / §A.3: the pinned 标准遍数卡 as a source ─────
  console.log('\n— pinned 标准遍数卡 (model-free: card text as the guard will see it) —');
  {
    // The card exactly as wisdom-sync renders the pinned entry (15eb9282…).
    const CARD = '【组织审定 · 智库】各部经文每天念多少遍？（常用经文标准遍数卡）\n【组织审定 · 常用经文标准遍数】摘自《心灵法门入门手册》第17–21页；礼佛时间按《佛学问答》161。\n- 《大悲咒》每天3遍或7遍以上；如遇重大关头每天21遍、49遍或越多越好。\n- 《心经》每天3遍或7遍以上；晚上10点以后不念。\n- 《礼佛大忏悔文》每天1遍至7遍，一般建议3遍左右，重病或孽障较深者5遍；功课加自存的合计上限按《佛学问答》161。\n- 《往生咒》每天21遍、27遍或49遍——超度小灵性。\n- 《解结咒》每天21遍、27遍或49遍——化解冤结。\n- 《消灾吉祥神咒》每天21遍、27遍或49遍。\n- 《准提神咒》每天21遍、27遍或49遍。';
    const CASE = '【玄艺综述】听众：我梦见蛇缠着我。台长：你要念往生咒21遍，还有解结咒。';
    const CANON_161 = '【组织审定 · 礼佛大忏悔文特殊日子遍数表】\n正常的初一十五，一天不超过21遍。一些佛菩萨诞辰日可以不超过49遍；从年三十到年初一这两天一共可以念诵87遍《礼佛大忏悔文》。';
    // A.2: case says 往生咒 21 AND the card says 往生咒 21/27/49 → advice passes.
    const d1 = '📿 《往生咒》每天 21 遍\n念之前祈求："请大慈大悲观世音菩萨保佑我（名字）超度因我而受害的小灵性"';
    const v1 = checkDraft(d1, [CASE, CARD], [], { caseTexts: [CASE], canonicalTexts: [CARD] });
    assert('A.2 case 往生咒21 + card 21/27/49 → 「《往生咒》每天 21 遍」 passes', v1.length === 0, v1);
    const v1b = checkDraft(d1, [CASE], [], { caseTexts: [CASE] });
    assert('A.2 …and without the card the same line is still number_case_generalized', v1b.some((x) => x.reason === 'number_case_generalized'), v1b);
    // The card also grounds the standard numbers with no other source at all.
    const d2 = '📿 《解结咒》每天 21 遍\n📿 《消灾吉祥神咒》每天 49 遍\n📿 《大悲咒》每天 7 遍';
    assert('A.2 card alone grounds 解结咒21 / 消灾49 / 大悲咒7', checkDraft(d2, [CARD], [], { canonicalTexts: [CARD] }).length === 0);
    assert('A.2 card does NOT ground a number it lacks (解结咒 33遍)', checkDraft('📿 《解结咒》每天 33 遍', [CARD], [], { canonicalTexts: [CARD] }).some((x) => x.text === '33遍'));
    // A.3: card + 161 card together → no number_canonical_conflict on 礼佛 3遍; 13遍 still conflicts.
    const both = [CARD, CANON_161];
    const v3 = checkDraft('📿 《礼佛大忏悔文》每天 3 遍（初学者从 1 遍开始）', both, [], { canonicalTexts: both });
    assert('A.3 礼佛 3遍 with card + 161 → no canonical conflict', !v3.some((x) => x.reason === 'number_canonical_conflict') && v3.length === 0, v3);
    const v4 = checkDraft('初一十五的礼佛大忏悔文，早期旧版写的是一天不超过13遍。', [...both, '【锦集】听众：初一十五念礼佛大忏悔文也可以念13遍。台长：可以的。'], [], { canonicalTexts: both });
    assert('A.3 13遍 on the canonical subject still number_canonical_conflict', v4.some((x) => x.text === '13遍' && x.reason === 'number_canonical_conflict'), v4);
    // Live check: is the card actually attached to retrieval yet? (informational
    // until Ken approves the entry — prints, does not fail)
    const live = await searchRelevantTeachings('梦见蛇要加念什么经', undefined, 'zh');
    const pinnedLive = live.filter((p) => p.pinned);
    console.log(`  pinned cards attached to a live retrieval: ${pinnedLive.length}${pinnedLive.length ? ' (' + pinnedLive.map((p) => p.id).join(', ') + ')' : ' — entry not approved yet'}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
