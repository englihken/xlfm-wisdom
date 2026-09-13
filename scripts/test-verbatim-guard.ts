// scripts/test-verbatim-guard.ts
// Unit tests for the anti-fabrication guard (regression brief R3).
//   npx tsx scripts/test-verbatim-guard.ts

import { extractNumberPairs } from '../src/lib/verbatim-guard-pairs';
import {
  checkDraft,
  stripViolations,
  extractNumberTokens,
  normalizeForGuard,
  chooseGuardTail,
  scrubContradictoryRefusal,
  hasBlanketRefusal,
  isOverStripped,
  isPrayerLine,
  isApprovedPrayerLine,
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
// Chinese numerals (入门锚定 brief): the 入门手册 chunks write counts this way.
assert('三遍 → 3遍', extractNumberTokens('三遍《心经》').includes('3遍'));
assert('二十一遍 → 21遍', extractNumberTokens('二十一遍《往生咒》').includes('21遍'));
assert('四十九遍 → 49遍', extractNumberTokens('每天念二十一遍、二十七遍或四十九遍').includes('49遍'));
assert('一遍至七遍 → both bounds', (() => { const t = extractNumberTokens('每天功课：一遍至七遍'); return t.includes('1遍') && t.includes('7遍'); })());
assert('三遍或七遍以上 → 3遍 & 7遍', (() => { const t = extractNumberTokens('一般三遍或七遍以上'); return t.includes('3遍') && t.includes('7遍'); })());
assert('一百零八遍 → 108遍', extractNumberTokens('一百零八遍').includes('108遍'));
assert('十遍 → 10遍', extractNumberTokens('十遍').includes('10遍'));
assert('Chinese-numeral dates still NOT tokenized', extractNumberTokens('二月十九日 观世音菩萨圣诞').length === 0);
{
  // Symmetric: a draft's 「三遍」 is now checked, and a chunk's 「三遍」 grounds a draft's 3遍.
  const cnChunk = ['【心灵法门入门手册】一般初学者功课：三遍《大悲咒》，三遍《心经》，一遍礼佛大忏悔文，二十一遍《往生咒》。'];
  assert('draft 3遍 grounded by chunk 三遍', checkDraft('《心经》每天3遍。', cnChunk, []).length === 0);
  assert('draft 二十一遍 grounded by chunk 二十一遍', checkDraft('《往生咒》每天二十一遍。', cnChunk, []).length === 0);
  const v = checkDraft('《大悲咒》每天四十九遍。', cnChunk, []);
  assert('draft 四十九遍 (absent) now flagged', v.some((x) => x.text === '49遍'), v);
}

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
  // 08-30 production shape: 「资料里没有写明具体数字，照官方功课说明来做 🔗」
  // next to a count → scrubbed; alone (no counts) → detected for the log.
  const text = '📿 《大悲咒》每天3遍\n\n关于每天各念多少遍，这次的资料里没有写明具体数字，你可以照官方功课说明来做 🔗 https://xlfm.my/chant\n\n坚持念 🙏';
  const r = scrubContradictoryRefusal(text);
  assert('「资料里没有写明具体数字」 scrubbed next to a count', !r.text.includes('没有写明') && r.removed.length === 1, r);
  assert('hasBlanketRefusal detects 「没有写明具体数字」', hasBlanketRefusal('这次的资料里没有写明具体数字，你可以照官方功课说明来做'));
  assert('hasBlanketRefusal detects 「原文没有提到遍数」', hasBlanketRefusal('原文里没有提到遍数'));
  assert('plain narrative 「资料里没有写明」 without a count word is NOT flagged', !hasBlanketRefusal('这份资料里没有写明作者是谁。'));
}
{
  // Scoped omission phrasing (the prompt's replacement for one missing figure)
  // is NOT a blanket refusal and survives.
  const text = '每天心经7遍。礼佛大忏悔文这一项的遍数本次资料中没有写明，建议咨询共修会义工。';
  const r = scrubContradictoryRefusal(text);
  assert('scoped 没有写明 note kept', r.removed.length === 0 && r.text === text, r);
}

console.log('— over-strip detection (conv c47ffe52: 祈求词 without 经名) —');
{
  const gutted = '听到你没有学过也没关系 🙏\n\n念之前跟菩萨说：「请大慈大悲观世音菩萨保佑我（姓名）身体健康，心情平静」\n\n想有人陪你一起念，可以联系就近共修会 🙏';
  assert('祈求词 with no sutra named → over-stripped', isOverStripped(gutted));
  const ok = '📿 《大悲咒》每天3遍\n祈求：「请大慈大悲观世音菩萨保佑我（姓名）身体健康，心情平静」';
  assert('祈求词 with 经名 → fine', !isOverStripped(ok));
  const okBracket = '📿 《千手千眼无碍大悲心陀罗尼》每天3遍\n祈求：请大慈大悲观世音菩萨保佑我（姓名）身体健康';
  assert('《…陀罗尼》 counts as a sutra name', !isOverStripped(okBracket));
  assert('no 祈求词 at all → not over-stripped (nothing to judge)', !isOverStripped('先把心静下来，慢慢来 🙏'));
  // 09-13 prayer-form: the 功课卡's long opener is a 祈求词 too.
  const longPrayer = '念之前说："祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨保佑我（姓名）身体健康，增强功力"';
  assert('card-form 祈求词 with no sutra named → over-stripped', isOverStripped(`先这样开始 🙏\n${longPrayer}`));
  assert('card-form 祈求词 with 经名 → fine', !isOverStripped(`📿 《大悲咒》每天 3 遍\n${longPrayer}`));
  assert('card-form 祈求词 line (no lead-in) is a prayer line', isPrayerLine('"祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨保佑我（姓名）开智慧"'));
  assert('short 祈求词 line still a prayer line', isPrayerLine('"请大慈大悲观世音菩萨保佑我（姓名）开智慧"'));
  // The real production shape: strip the 功课 sentences from a full draft and check.
  const draft = '你可以先这样开始：\n\n📿 《大悲咒》每天3遍\n📿 《心经》每天3遍\n\n念之前跟菩萨说：「请大慈大悲观世音菩萨保佑我（姓名）身体健康，心情平静」\n\n有教念视频可以跟着念。';
  const v = checkDraft(draft, ['不学佛，你永远活在自己内心肮脏的小生命中。'], []);
  const stripped = stripViolations(draft, v);
  // 09-12 §B: the 功课 lines now survive with the placeholder, so the strip no
  // longer guts the reply (isOverStripped stays as the safety net for prose).
  assert('stripping ungrounded 功课 lines keeps the sutra names (no longer gutted)', !isOverStripped(stripped) && stripped.includes('《大悲咒》每天（遍数以官方资料为准）'), stripped);
}


console.log('— F01 negatives (batch 2 §1): (subject, count) pairs + sentence mood, all fail-closed —');
{
  const wrongSubject = (v: ReturnType<typeof checkDraft>, subject: string, token: string) =>
    v.some((x) => x.type === 'number' && x.text === token && x.subject === subject);
  // N1 — source 往生咒49遍 / draft 礼佛49遍 → violation (number not bound to its sutra)
  const n1 = checkDraft('建议每天念《礼佛大忏悔文》49遍。', ['【疾病百科】失眠：《往生咒》每天49遍。'], []);
  assert('N1 往生咒49遍 does not ground 礼佛49遍', wrongSubject(n1, '礼佛', '49遍') && n1[0].reason === 'number_not_in_sources', n1);
  // N2 — no source / visitor 999遍 / draft advises 999遍 → violation
  const n2 = checkDraft('建议每天念《礼佛大忏悔文》999遍。', [], ['可以念999遍吗？']);
  assert('N2 visitor 999遍 turned into advice is rejected', n2.some((x) => x.text === '999遍' && x.reason === 'number_visitor_as_advice'), n2);
  // N3 — visitor 「我一直念21遍心经，可以吗」 / draft quotes it → OK
  const n3 = checkDraft('你念的21遍是可以的，贵在坚持。', [], ['我一直念21遍心经，可以吗']);
  assert('N3 quoting the visitor\'s 21遍 passes', n3.length === 0, n3);
  // N4 — same visitor / draft 「建议你每天念21遍」 / no source → violation
  const n4 = checkDraft('建议你每天念21遍。', [], ['我一直念21遍心经，可以吗']);
  assert('N4 advising the visitor\'s 21遍 without a source is rejected', n4.some((x) => x.text === '21遍' && x.reason === 'number_visitor_as_advice'), n4);
  // N5 — case source 「某同修给亡人念了200张」 / draft advises 200张 → violation
  const CASE = '【玄艺综述】听众：我给亡人念了200张小房子。台长：难怪呢，他在下面很自由。';
  const n5 = checkDraft('你可以给亡人念200张小房子。', [CASE], [], { caseTexts: [CASE] });
  assert('N5 case number generalized into advice is rejected', n5.some((x) => x.text === '200张' && x.reason === 'number_case_generalized'), n5);
  // N6 — same source / draft narrates the case → OK
  const n6 = checkDraft('台长曾对一位同修说，她念了200张小房子之后亡人在下面很自由。', [CASE], [], { caseTexts: [CASE] });
  assert('N6 narrating the case\'s 200张 passes', n6.length === 0, n6);
  // N7 — source 入门手册 大悲咒7遍、心经7遍 / draft same → OK
  const MANUAL = '【心灵法门入门手册】一般初学者功课：每天念《大悲咒》7遍、《心经》7遍、礼佛大忏悔文1-3遍左右。';
  const n7 = checkDraft('📿 《大悲咒》每天7遍\n📿 《心经》每天7遍', [MANUAL], []);
  assert('N7 大悲咒7遍、心经7遍 grounded by the manual', n7.length === 0, n7);
  // N8 — same source / draft adds 礼佛7遍 → violation (礼佛 source says 1-3)
  const n8 = checkDraft('📿 《大悲咒》每天7遍\n📿 《心经》每天7遍\n📿 《礼佛大忏悔文》每天7遍', [MANUAL], []);
  assert('N8 礼佛7遍 (source says 1-3遍) is rejected', wrongSubject(n8, '礼佛', '7遍'), n8);
  assert('N8 …and 大悲咒/心经 7遍 are NOT flagged', !n8.some((x) => x.subject === '大悲咒' || x.subject === '心经'), n8);
  // Stripping is pair-scoped: only the 礼佛 line goes.
  const stripped8 = stripViolations('📿 《大悲咒》每天7遍\n📿 《心经》每天7遍\n📿 《礼佛大忏悔文》每天7遍', n8);
  assert('N8 strip touches only the 礼佛 count (09-12 §B: line kept, count → placeholder)', stripped8.includes('《大悲咒》每天7遍') && stripped8.includes('《心经》每天7遍') && stripped8.includes('《礼佛大忏悔文》每天（遍数以官方资料为准）') && !stripped8.includes('礼佛大忏悔文》每天7遍'), stripped8);
  // Subject binding variants that must still ground.
  const n9 = checkDraft('每天三遍《心经》就可以。', ['入门手册：三遍《心经》，三遍《大悲咒》。'], []);
  assert('subject AFTER the count (三遍《心经》) binds', n9.length === 0, n9);
  const n10 = checkDraft('《礼佛大忏悔文》的遍数：\n- 平时每天：1-3遍', [MANUAL], []);
  assert('block-level subject fallback (礼佛…\n- 1-3遍) binds', n10.length === 0, n10);
  const n11 = checkDraft('每天念 21 遍。', ['佛学问答：《往生咒》每天21遍。'], []);
  assert('bare draft count grounded by any source count (status quo)', n11.length === 0, n11);
  // Narration lead-in governs the list that follows it in the same block.
  const n12 = checkDraft('台长曾对一位同修这样开示：\n- 给亡人念200张小房子', [CASE], [], { caseTexts: [CASE] });
  assert('narration lead-in covers the following list line', n12.length === 0, n12);
  // Full-width and 張 variants still tokenize into pairs.
  const n13 = checkDraft('建议念《礼佛大忏悔文》４９遍。', ['【疾病百科】《往生咒》每天49遍。'], []);
  assert('fullwidth ４９遍 still checked as a 礼佛 pair', wrongSubject(n13, '礼佛', '49遍'), n13);

  // N9 (batch 4 addendum, R18 root cause): enumerations with ONE trailing unit
  // — 《入门手册》 p29 「《解结咒》21、27、49、78 或 108 遍」 — must yield a pair
  // per number, not just (解结咒, 108遍).

  const e1 = extractNumberPairs('《解结咒》21、27、49、78 或 108 遍');
  assert('N9 「《解结咒》21、27、49、78 或 108 遍」 → five 解结咒 pairs', e1.length === 5 && ['21遍', '27遍', '49遍', '78遍', '108遍'].every((t) => e1.some((p) => p.subject === '解结咒' && p.token === t)), e1);
  const e2 = extractNumberPairs('《心经》7、9、11、21、27 或 49 遍分别给自己和对方');
  assert('N9 「《心经》7、9、11、21、27 或 49 遍」 → six pairs, all 心经', e2.length === 6 && e2.every((p) => p.subject === '心经'), e2);
  const e3 = extractNumberPairs('念 21 张小房子、7 遍心经');
  assert('N9 「念 21 张小房子、7 遍心经」 stays two separate pairs', e3.length === 2 && e3.some((p) => p.token === '21张' && p.subject === '小房子') && e3.some((p) => p.token === '7遍' && p.subject === '心经'), e3);
  const e4 = extractNumberPairs('《解结咒》二十一、二十七或四十九遍');
  assert('N9 Chinese-numeral enumeration → three 解结咒 pairs', e4.length === 3 && ['21遍', '27遍', '49遍'].every((t) => e4.some((p) => p.subject === '解结咒' && p.token === t)), e4);
  const MANUAL29 = '【心灵法门入门手册】求化解冤结：《解结咒》21、27、49、78 或 108 遍。';
  const n9e = checkDraft('📿 《解结咒》每天 21 遍', [MANUAL29], []);
  assert('N9 draft 「《解结咒》每天 21 遍」 is grounded by the enumeration source', n9e.length === 0, n9e);
  const n9f = checkDraft('📿 《解结咒》每天 33 遍', [MANUAL29], []);
  assert('N9 …but 33遍 (not in the enumeration) is still rejected', wrongSubject(n9f, '解结咒', '33遍'), n9f);
  // The REAL p29 chunk shape (PDF line breaks inside the enumeration).
  const P29 = '②求化解冤结  求大慈大悲观世音菩萨化解我\n\nXXX\n\n与\n\nYYY\n\n的恶缘。  念 《大悲咒》 7\n\n遍、 《心经》 7 、 9 、 11 、 21 、 27\n\n或\n\n49  遍分别给自己和对方、礼佛大忏悔文\n\n3\n\n遍、 《解结咒》 21 、  27 、 49 、 78\n\n或\n\n108\n\n遍， 还要配合小房子 （给自己的要经者）  每周\n\n3\n\n张以上';
  const e5 = extractNumberPairs(P29);
  assert('N9 PDF-broken p29 → (解结咒, 21/27/49/78/108遍)', ['21遍', '27遍', '49遍', '78遍', '108遍'].every((t) => e5.some((p) => p.subject === '解结咒' && p.token === t)), e5);
  assert('N9 PDF-broken p29 → (心经, 7…49遍) and (大悲咒, 7遍)', e5.some((p) => p.subject === '心经' && p.token === '49遍') && e5.some((p) => p.subject === '大悲咒' && p.token === '7遍'), e5);
  const n9g = checkDraft('📿 《解结咒》每天 21 遍', [P29], []);
  assert('N9 draft 「《解结咒》每天 21 遍」 grounded by the PDF-broken p29 chunk', n9g.length === 0, n9g);

  // N10 (09-12 strip-tails brief §B): the d7897fd1 07:14 draft. The only
  // source with 往生咒 21 is a CASE record, so (往生咒, 21遍) is
  // number_case_generalized; stripping must keep the sutra line (count →
  // placeholder) and its prayer, never leave an orphan prayer.
  const SNAKE_CASE = '【玄艺综述】听众：梦见蛇。台长：那你念往生咒21遍，还有解结咒。';
  const D07 = '明白了 🙏 礼佛大忏悔文偶尔念，这个很好，有在忏悔消业。\n\n建议你加念：\n\n📿 **《往生咒》每天 21 遍**\n念之前祈求："请大慈大悲观世音菩萨保佑我（名字）超度因我而受害的小灵性，帮助我消除孽障"\n\n针对梦见蛇这个情况，往生咒可以帮助超度跟你有缘的灵性，让它们安息 🙏\n\n你有念小房子吗？';
  const v10 = checkDraft(D07, [SNAKE_CASE], [], { caseTexts: [SNAKE_CASE] });
  assert('N10 (往生咒, 21遍) is number_case_generalized', v10.some((x) => x.text === '21遍' && x.reason === 'number_case_generalized' && x.subject === '往生咒'), v10);
  const s10 = stripViolations(D07, v10);
  assert('N10 sutra line kept with the placeholder', s10.includes('📿 **《往生咒》每天（遍数以官方资料为准）**'), s10);
  assert('N10 prayer line kept (no orphan, no deletion)', s10.includes('念之前祈求："请大慈大悲观世音菩萨保佑我（名字）超度因我而受害的小灵性'), s10);
  assert('N10 no 21遍 survives', !s10.includes('21 遍') && !s10.includes('21遍'), s10);
  assert('N10 not over-stripped (sutra still named)', !isOverStripped(s10), s10);
  assert('N10 tail is partial, not blanket', chooseGuardTail(s10, v10) === 'partial');
  // §B.2: a bare-count line that is deleted takes its prayer line with it.
  const BARE = '先把功课念起来：\n每天念 21 遍。\n念之前祈求："请大慈大悲观世音菩萨保佑我（名字）身体健康"\n\n坚持念下去 🙏';
  const v10b = checkDraft(BARE, ['【入门手册】《大悲咒》每天7遍。'], []);
  const s10b = stripViolations(BARE, v10b);
  assert('N10b bare 21遍 line removed…', !s10b.includes('21 遍'), s10b);
  assert('N10b …and its orphan prayer line removed with it', !s10b.includes('请大慈大悲观世音菩萨保佑我（名字）身体健康'), s10b);
  assert('N10b the rest survives', s10b.includes('先把功课念起来') && s10b.includes('坚持念下去'), s10b);
  // N11 (Ken 2026-09-12): 功课块 lines now write 《全称》（简称）. SUBJECT_ALIASES
  // already folds the full names, so the pair still binds to the short subject.
  const CASE21 = '【玄艺综述】听众：梦见蛇。台长：那你念往生咒21遍。';
  const full21 = '📿 《往生净土神咒》（往生咒）每天 21 遍';
  assert('N11 「《往生净土神咒》（往生咒）每天 21 遍」 binds to (往生咒, 21遍)',
    extractNumberPairs(full21).some((p) => p.subject === '往生咒' && p.token === '21遍'), extractNumberPairs(full21));
  assert('N11 …and a source stating 往生咒 21 遍 grounds it (narrated case source)',
    checkDraft(`台长对一位听众的开示是：${full21}`, [CASE21], [], { caseTexts: [CASE21] }).length === 0);
  const MANUAL21 = '【心灵法门入门手册】每天念《往生咒》21 遍。';
  assert('N11 …and a book source grounds it as advice', checkDraft(full21, [MANUAL21], []).length === 0);
  assert('N11 full name alone (no 简称) still binds', extractNumberPairs('📿 《千手千眼无碍大悲心陀罗尼》每天 7 遍').some((p) => p.subject === '大悲咒' && p.token === '7遍'));
  assert('N11 an ungrounded count on a full-name line is still rejected',
    checkDraft('📿 《往生净土神咒》（往生咒）每天 33 遍', [MANUAL21], []).some((x) => x.text === '33遍' && x.subject === '往生咒'));

  // A 功课 line with one bad count and one good count keeps the good one.
  const MIX = '📿 《大悲咒》每天7遍、《礼佛大忏悔文》每天7遍';
  const v10c = checkDraft(MIX, [MANUAL], []);
  const s10c = stripViolations(MIX, v10c);
  assert('N10c only the ungrounded count is replaced', s10c.includes('《大悲咒》每天7遍') && s10c.includes('《礼佛大忏悔文》每天（遍数以官方资料为准）'), s10c);
}

{
  // N12 (09-13 xfz-retrieval-and-prayer-guard §2.2): 祈求词 lines in a quote
  // block are exempt from the verbatim check — only the opener must be approved.
  const CARD = '念前祈请：「祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨保佑我 XXX 身体健康，增强功力」';
  const quoteNV = (draft: string) => checkDraft(draft, [CARD], []).filter((v) => v.reason === 'quote_not_verbatim');
  const personal = '> 祈求："祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨帮助我（孩子名字）与（对方名字）化解恶缘"';
  assert('N12 card-form prayer with personal content in a quote block → no quote_not_verbatim', quoteNV(personal).length === 0, quoteNV(personal));
  const wrongOpener = '> 念前祈请：「祈请大慈大悲观音菩萨保佑我（姓名）身体健康，增强功力」';
  assert('N12 opener 「祈请大慈大悲观音菩萨」 → still quote_not_verbatim', quoteNV(wrongOpener).length > 0, quoteNV(wrongOpener));
  const burnSend = '> "祈请南无大慈大悲观世音菩萨帮助我 XXX 能够将这些小房子送给 YYY"';
  assert('N12 小房子 烧送前 opener (《念诵指南》 p31) → no quote_not_verbatim', quoteNV(burnSend).length === 0, quoteNV(burnSend));
  const recite = '> 请大慈大悲观世音菩萨保佑我 XXX，帮助我将这些小房子送给 YYY';
  assert('N12 小房子 念诵前 opener (《念诵指南》 p17) → no quote_not_verbatim', quoteNV(recite).length === 0, quoteNV(recite));
  const teaching = '> 境界的提升是看不见，摸不着的，只有靠你自己慢慢地悟';
  assert('N12 an ordinary quote is still checked verbatim', quoteNV(teaching).length > 0);
  assert('N12 isApprovedPrayerLine: plain prose is not a prayer line', !isApprovedPrayerLine('师父说：多念心经开智慧'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
