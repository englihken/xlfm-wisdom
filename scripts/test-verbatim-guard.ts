// scripts/test-verbatim-guard.ts
// Unit tests for the anti-fabrication guard (regression brief R3).
//   npx tsx scripts/test-verbatim-guard.ts

import {
  checkDraft,
  stripViolations,
  extractNumberTokens,
  normalizeForGuard,
  chooseGuardTail,
  scrubContradictoryRefusal,
  hasBlanketRefusal,
} from '../src/lib/verbatim-guard';

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail ?? '');
  }
}

// Ground truth stand-ins. CHUNK mimics the real 锦集 p181 补念 chunk shape:
// the "13遍、27遍" numbers exist ONLY inside a 听众's (visitor's) question —
// exactly the text the model recast as a 台长 quote in conv 29cfd74c.
const CHUNK_JINJI =
  '初一十五的礼佛大忏悔文念 不完可否补念  听众：初一十五念礼佛大忏悔文也可以念13遍、27遍，如果 没念完，可不可以之后补念？  台长：可以的，尽量当天念完。';
const CHUNK_CANONICAL =
  '【组织审定 · 礼佛大忏悔文特殊日子遍数表】\n正常的初一十五，一天不超过21遍。一些佛菩萨诞辰日可以不超过49遍；从年三十到年初一这两天一共可以念诵87遍《礼佛大忏悔文》。';
const CHUNKS = [CHUNK_JINJI, CHUNK_CANONICAL];
// An ordinary book chunk (疾病百科 shape) whose counts are NOT in the canonical
// doc — the 08-29 regression: these were stripped whenever a canonical chunk
// was also retrieved.
const CHUNK_BOOK =
  '【疾病百科（一）】失眠：可以每天念《心经》3遍、《往生咒》27遍，同时配合小房子给自己的要经者。';

console.log('— number token extraction —');
assert(
  'range 21-49遍 yields both bounds',
  JSON.stringify(extractNumberTokens('每天21-49遍')) === JSON.stringify(['21遍', '49遍'])
);
assert('fullwidth digits normalize', extractNumberTokens('２１遍')[0] === '21遍');
assert('遍/张 units captured', extractNumberTokens('不超过49张').includes('49张'));
assert('Chinese-numeral dates NOT tokenized', extractNumberTokens('二月十九日 观世音菩萨圣诞').length === 0);
assert('岁 not tokenized as 遍/张', extractNumberTokens('孩子13岁').length === 0);
assert(
  'Traditional 張 folds to 张 (conv b119360e)',
  JSON.stringify(extractNumberTokens('7-21張')) === JSON.stringify(['7张', '21张'])
);

console.log('— quote check —');
{
  // Fabricated quote: the 13遍 claim recast as a teaching (the real incident).
  // NOTE: "13遍" as a NUMBER is present in the 锦集 chunk (the 听众's question),
  // so per spec the numbers check allows the token — the QUOTE check is what
  // stops it being attributed to 师父.
  const draft = '师父开示过：\n\n> 正常的初一十五，一天不超过13遍\n\n请安心念诵。';
  const v = checkDraft(draft, CHUNKS, []);
  assert('fabricated quote flagged', v.some((x) => x.type === 'quote'), v);
  assert('quote violation, not number (13遍 exists in chunk)', !v.some((x) => x.type === 'number'), v);
}
{
  // A count absent from chunks AND visitor words entirely → number flagged.
  const draft = '中秋节可以念39遍礼佛大忏悔文。';
  const v = checkDraft(draft, CHUNKS, []);
  assert('wholly absent number flagged', v.some((x) => x.type === 'number' && x.text === '39遍'), v);
}
{
  // Grounded quote, verbatim from the canonical chunk (with cosmetic spacing).
  const draft = '师父开示：\n\n> 正常的初一十五，一天不超过 21 遍。\n\n祝顺利。';
  const v = checkDraft(draft, CHUNKS, []);
  assert('grounded quote passes', v.length === 0, v);
}
{
  // Elided quote: both segments verbatim → passes.
  const draft = '> 正常的初一十五，一天不超过21遍……从年三十到年初一这两天一共可以念诵87遍《礼佛大忏悔文》';
  assert('elided verbatim quote passes', checkDraft(draft, CHUNKS, []).length === 0);
}
{
  // Elided quote where the second segment is invented → flagged.
  const draft = '> 正常的初一十五，一天不超过21遍……宁可少念几天，念的时候念足数';
  const v = checkDraft(draft, CHUNKS, []);
  assert('invented segment in elided quote flagged', v.some((x) => x.type === 'quote'), v);
}

console.log('— numbers check —');
{
  // Number in chunks but not quoted → allowed as plain text.
  const draft = '初一十五礼佛大忏悔文一天不超过21遍（含功课）。';
  assert('grounded number passes', checkDraft(draft, CHUNKS, []).length === 0);
}
{
  // 13遍 appears in the chunk ONLY inside the 听众 question — as a NUMBER it is
  // technically present in retrieved text, so the numbers check alone allows it;
  // the QUOTE check is what stops it being attributed to 师父.
  const draft = '有同修提过13遍的说法，但按资料应以21遍为准。';
  assert('number present in chunk text passes numbers check', checkDraft(draft, CHUNKS, []).length === 0);
}
{
  // Visitor-echoed number: "11遍" appears only in the visitor's message.
  const draft = '您说的每天11遍是可以的，贵在坚持。';
  const v = checkDraft(draft, CHUNKS, ['七岁孩子念解结咒11遍可以吗？']);
  assert('visitor-echoed number allowed', v.length === 0, v);
}
{
  // Same draft WITHOUT the visitor message → flagged.
  const v = checkDraft('您说的每天11遍是可以的。', CHUNKS, []);
  assert('ungrounded number flagged', v.some((x) => x.type === 'number' && x.text === '11遍'), v);
}
{
  // Visitor text must NOT satisfy the QUOTE check.
  const draft = '> 七岁孩子念解结咒11遍可以吗，完全没有问题';
  const v = checkDraft(draft, CHUNKS, ['七岁孩子念解结咒11遍可以吗，完全没有问题']);
  assert('visitor text cannot ground a quote', v.some((x) => x.type === 'quote'), v);
}

console.log('— canonical-scoped mode (08-29: 组织审定 wins on ITS subject only) —');
{
  const opts = { canonicalTexts: [CHUNK_CANONICAL] };
  // 13遍 exists only in the ordinary 锦集 chunk (听众 question). In a paragraph
  // on the canonical subject (礼佛 / 初一十五) its prose use is REJECTED — the
  // 29cfd74c "旧版写13遍" loophole — with the canonical_conflict reason.
  const v = checkDraft('初一十五的礼佛大忏悔文，早期旧版写的是一天不超过13遍。', CHUNKS, [], opts);
  assert('ordinary-chunk-only number rejected on canonical subject', v.some((x) => x.type === 'number' && x.text === '13遍'), v);
  assert('…with reason number_canonical_conflict', v.some((x) => x.reason === 'number_canonical_conflict'), v);

  // Scope is the PARAGRAPH: a keyword-free second sentence cannot smuggle it.
  const v2 = checkDraft('初一十五礼佛大忏悔文按组织审定一天不超过21遍。早期旧版写的是13遍。', CHUNKS, [], opts);
  assert('keyword-free sentence in a 礼佛 paragraph still rejected', v2.some((x) => x.text === '13遍'), v2);

  // THE 08-29 FIX: a book-only number on ANOTHER subject (心经/往生咒 for 失眠)
  // is legitimate even though a canonical chunk is present. Before the fix,
  // every prose number had to come from 组织审定 and this was stripped.
  const chunksWithBook = [...CHUNKS, CHUNK_BOOK];
  const v3 = checkDraft('失眠的话可以每天念《心经》3遍、《往生咒》27遍，配合小房子。', chunksWithBook, [], opts);
  assert('book-only numbers on a non-canonical subject pass with canonical present', v3.length === 0, v3);

  // Same book number, but placed on the canonical subject → conflict.
  const v4 = checkDraft('初一十五的礼佛大忏悔文可以念27遍。', chunksWithBook, [], opts);
  assert('book-only number on the canonical subject rejected', v4.some((x) => x.text === '27遍' && x.reason === 'number_canonical_conflict'), v4);

  // A number in NO chunk is rejected everywhere, with its own reason.
  const v5 = checkDraft('每天念大悲咒108遍。', chunksWithBook, [], opts);
  assert('absent number → number_not_in_sources', v5.some((x) => x.text === '108遍' && x.reason === 'number_not_in_sources'), v5);

  // False positives (review 08-29): everyday words that share characters with
  // the canonical day-words must NOT mark a paragraph as canonical-subject.
  const fp = (draft: string) => checkDraft(draft, chunksWithBook, [], opts);
  assert('「孩子读初一」 (Form 1) + book 遍数 passes', fp('孩子读初一，学业压力大，可以每天念《心经》3遍帮助开智慧。').length === 0, fp('孩子读初一，学业压力大，可以每天念《心经》3遍帮助开智慧。'));
  assert('「我怀孕了」 + book 遍数 passes', fp('我怀孕了可以念大悲咒吗？可以的，孕妇每天念《心经》3遍很好。').length === 0, fp('我怀孕了可以念大悲咒吗？可以的，孕妇每天念《心经》3遍很好。'));
  assert('圣诞节 (Christmas) + book 遍数 passes', fp('圣诞节假期在家，每天念《往生咒》27遍也可以。').length === 0);
  assert('十五岁 + book 遍数 passes', fp('十五岁的孩子每天念《心经》3遍就够了。').length === 0);
  assert('十五分钟 + book 遍数 passes', fp('每天花十五分钟念《往生咒》27遍。').length === 0);
  // Trigger without an anchor: 元旦 + 心经 count is NOT the doc's subject.
  assert('元旦 + 心经 count (no 礼佛/小房子 anchor) passes', fp('元旦放假可以多念《心经》3遍。').length === 0);
  // Real canonical subject still strict.
  const still = fp('初一十五礼佛大忏悔文一天可以念13遍。');
  assert('「初一十五礼佛大忏悔文」 + non-canonical 13遍 still rejected', still.some((x) => x.text === '13遍' && x.reason === 'number_canonical_conflict'), still);
  const anchorOnly = fp('礼佛大忏悔文平时一天不超过13遍。');
  assert('bare 礼佛 paragraph (trigger = anchor) still strict', anchorOnly.some((x) => x.text === '13遍'), anchorOnly);
  const zhang = fp('清明节给亡人的小房子可以烧27张。');
  assert('清明 + 小房子 N张 (book-only 27张 absent everywhere) flagged', zhang.some((x) => x.text === '27张'), zhang);

  // Block-scoped anchor (review 08-29 #2): a bulleted list inherits the 礼佛
  // anchor from its introducing line; a separate block does not.
  const listReply =
    '《礼佛大忏悔文》的遍数：\n- 平时初一、十五：13遍\n- 佛菩萨诞辰日：49遍\n\n失眠可以念《心经》3遍。\n\n孩子读初一，学业压力大，可以每天念《心经》3遍帮助开智慧。';
  const vl = fp(listReply);
  assert('list item 「平时初一、十五：13遍」 under a 礼佛 heading → number_canonical_conflict',
    vl.some((x) => x.text === '13遍' && x.reason === 'number_canonical_conflict'), vl);
  assert('canonical 49遍 in the same list passes', !vl.some((x) => x.text === '49遍'), vl);
  assert('separate block 「失眠可以念《心经》3遍」 passes', !vl.some((x) => x.text === '3遍'), vl);
  assert('「孩子读初一…3遍」 block still passes', vl.length === 1, vl);
  const strippedList = stripViolations(listReply, vl);
  assert('strip removes only the 13遍 item', !strippedList.includes('13遍') && strippedList.includes('49遍') && strippedList.includes('失眠可以念《心经》3遍') && strippedList.includes('孩子读初一'), strippedList);
  // Trigger stays per line: a 心经 item inside the 礼佛 block is not swept up.
  const mixed = fp('功课建议（含礼佛大忏悔文）：\n- 《心经》每天3遍\n- 《礼佛大忏悔文》初一十五13遍');
  assert('心经 item in a 礼佛 block passes (no trigger on its line)', !mixed.some((x) => x.text === '3遍'), mixed);
  assert('礼佛 item in the same block still rejected', mixed.some((x) => x.text === '13遍'), mixed);

  // Canonical numbers pass in prose.
  assert(
    'canonical number passes in prose',
    checkDraft('平时初一十五一天不超过21遍（含功课）。', CHUNKS, [], opts).length === 0
  );

  // Visitor-echoed numbers still pass in canonical mode.
  assert(
    'visitor number passes in canonical mode',
    checkDraft('您说的11遍是可以的。', CHUNKS, ['孩子念11遍可以吗'], opts).length === 0
  );

  // A verbatim quote of the ordinary chunk may carry its own numbers — the
  // verified quote line is exempt from the prose numbers check.
  const quoted =
    '> 听众：初一十五念礼佛大忏悔文也可以念13遍、27遍，如果 没念完，可不可以之后补念？\n\n按组织审定，一天不超过21遍。';
  assert('numbers inside verified verbatim quote exempt', checkDraft(quoted, CHUNKS, [], opts).length === 0, checkDraft(quoted, CHUNKS, [], opts));
}

console.log('— stripping —');
{
  const draft =
    '听到您的情况很心疼 🙏\n\n师父开示过：\n\n> 正常的初一十五，一天不超过13遍\n\n所以您一天念39遍就可以了。另外多念心经对您也有帮助。\n\n祝您顺利 🙏';
  const v = checkDraft(draft, CHUNKS, []);
  const stripped = stripViolations(draft, v);
  assert('fabricated quote removed', !stripped.includes('不超过13遍'), stripped);
  assert('ungrounded number sentence removed', !stripped.includes('念39遍就可以'), stripped);
  assert('innocent content kept', stripped.includes('多念心经对您也有帮助'), stripped);
  assert('empathy kept', stripped.includes('很心疼'), stripped);
}
{
  // Stripping a reply that is ~all fabrication leaves near-nothing → the
  // pipeline falls back to the safe answer when skeleton < 40 chars.
  const draft = '> 正常的初一十五，一天不超过13遍\n\n一天13遍即可。';
  const v = checkDraft(draft, CHUNKS, []);
  const stripped = stripViolations(draft, v);
  assert('gutted reply detectable for safe fallback', normalizeForGuard(stripped).length < 40, stripped);
}

console.log('— post-strip tail decision (08-16 contradiction bug) —');
{
  // The production shape: paraphrased quote (violation) + fully grounded prose
  // numbers. After stripping, the answer keeps its counts → tail must be
  // 'none', never the blanket numbers disclaimer.
  const draft =
    '初一十五礼佛大忏悔文一天不超过21遍（含功课）。\n\n师父开示：\n\n> 正常的初一十五，一天最多不可以超过21遍\n\n祝您修行顺利，多念心经对您也有帮助 🙏';
  const opts = { canonicalTexts: [CHUNK_CANONICAL] };
  const v = checkDraft(draft, CHUNKS, [], opts);
  assert('paraphrased quote flagged (quote only)', v.length > 0 && v.every((x) => x.type === 'quote'), v);
  const stripped = stripViolations(draft, v);
  assert('grounded numbers survive stripping', extractNumberTokens(stripped).includes('21遍'), stripped);
  assert('quote-only strip → tail none', chooseGuardTail(stripped, v) === 'none', chooseGuardTail(stripped, v));
  assert('orphaned 师父开示： lead-in removed with its quote', !stripped.includes('师父开示'), stripped);
}
{
  // Ungrounded number stripped while grounded numbers remain → scoped tail.
  const draft =
    '初一十五一天不超过21遍（含功课），当天没念完可以补念。\n\n另外有人说平时可以念108遍作为辅助。\n\n多念心经也有帮助，祝您顺利 🙏';
  const v = checkDraft(draft, CHUNKS, []);
  const stripped = stripViolations(draft, v);
  assert('ungrounded 108遍 sentence removed', !stripped.includes('108遍'), stripped);
  assert('grounded 21遍 kept', stripped.includes('21遍'), stripped);
  assert('partial strip → tail partial', chooseGuardTail(stripped, v) === 'partial');
}
{
  // Every number ungrounded → nothing numeric survives → blanket tail.
  const draft = '中秋节可以念39遍，重阳节可以念59遍。\n\n此外要保持心态平和，多念心经，一切随缘，功德无量 🙏';
  const v = checkDraft(draft, CHUNKS, []);
  const stripped = stripViolations(draft, v);
  assert('no numbers survive', extractNumberTokens(stripped).length === 0, stripped);
  assert('all-numbers strip → tail blanket', chooseGuardTail(stripped, v) === 'blanket');
}

console.log('— canonical-conflict stripping is paragraph-scoped —');
{
  const opts = { canonicalTexts: [CHUNK_CANONICAL] };
  const chunksWithBook = [...CHUNKS, CHUNK_BOOK];
  const draft =
    '失眠可以每天念《心经》3遍、《往生咒》27遍。\n\n初一十五的礼佛大忏悔文可以念27遍。平时也可以多念。\n\n祝您早日安眠 🙏';
  const v = checkDraft(draft, chunksWithBook, [], opts);
  const stripped = stripViolations(draft, v);
  assert('礼佛 sentence with the conflicting 27遍 removed', !stripped.includes('礼佛大忏悔文可以念27遍'), stripped);
  assert('same 27遍 in the 往生咒 paragraph kept', stripped.includes('《往生咒》27遍'), stripped);
  assert('rest of the 礼佛 paragraph kept', stripped.includes('平时也可以多念'), stripped);
  assert('tail partial (grounded counts remain)', chooseGuardTail(stripped, v) === 'partial');
}

console.log('— contradiction scrub (08-29: 查不到 next to grounded counts) —');
{
  // Production chip-2 shape: 功课 list + 「关于每天各念多少遍，我这边查不到相关原文，不敢乱给数字。」
  const text =
    '📿 《心经》每天3遍\n祈求：「请大慈大悲观世音菩萨保佑我开智慧」\n\n关于每天各念多少遍，我这边查不到相关原文，不敢乱给数字。建议你联系就近的共修会义工确认：\n📞 总会 +603-6257 3811\n\n坚持念下去 🙏';
  const r = scrubContradictoryRefusal(text);
  assert('blanket refusal sentence removed', !r.text.includes('查不到相关原文'), r.text);
  assert('removed sentence reported', r.removed.length === 1 && r.removed[0].includes('不敢乱给数字'), r.removed);
  assert('grounded count kept', r.text.includes('每天3遍'), r.text);
  assert('following advice sentence kept', r.text.includes('建议你联系就近的共修会义工'), r.text);
}
{
  // Production 失眠 shape (08-29 run): 「查不到适用于每一个人的通用数字…我不方便乱给」.
  const text =
    '📿 《心经》7遍\n\n关于**具体遍数**——目前我在师父的开示原文里查不到适用于每一个人的通用数字，师父给同修的遍数都是看各人情况定的，我不方便乱给。建议你联系就近的共修会义工。';
  const r = scrubContradictoryRefusal(text);
  assert('通用数字 variant removed', !r.text.includes('查不到适用于'), r.text);
  assert('7遍 kept', r.text.includes('7遍'), r.text);
}
{
  // NO counts in the reply → the refusal is the honest answer; untouched.
  const text = '这个问题的具体遍数，我目前查不到相关原文，不敢随意告诉您数字。建议咨询就近共修会的义工 🙏';
  const r = scrubContradictoryRefusal(text);
  assert('refusal kept when no counts stated', r.text === text && r.removed.length === 0, r);
  assert('hasBlanketRefusal detects it', hasBlanketRefusal(text));
}
{
  // Blockquote lines are never scrubbed (they are verbatim source text).
  const text = '> 这种情况查不到原文的，要靠自己修\n\n每天心经7遍。';
  const r = scrubContradictoryRefusal(text);
  assert('quote line untouched', r.text.includes('> 这种情况查不到原文的'), r.text);
}
{
  // Scoped omission phrasing (the prompt's replacement for one missing figure)
  // is NOT a blanket refusal and survives.
  const text = '每天心经7遍。礼佛大忏悔文这一项的遍数本次资料中没有写明，建议咨询共修会义工。';
  const r = scrubContradictoryRefusal(text);
  assert('scoped 没有写明 note kept', r.removed.length === 0 && r.text === text, r);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
