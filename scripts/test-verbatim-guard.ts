// scripts/test-verbatim-guard.ts
// Unit tests for the anti-fabrication guard (regression brief R3).
//   npx tsx scripts/test-verbatim-guard.ts

import {
  checkDraft,
  stripViolations,
  extractNumberTokens,
  normalizeForGuard,
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

console.log('— number token extraction —');
assert(
  'range 21-49遍 yields both bounds',
  JSON.stringify(extractNumberTokens('每天21-49遍')) === JSON.stringify(['21遍', '49遍'])
);
assert('fullwidth digits normalize', extractNumberTokens('２１遍')[0] === '21遍');
assert('遍/张 units captured', extractNumberTokens('不超过49张').includes('49张'));
assert('Chinese-numeral dates NOT tokenized', extractNumberTokens('二月十九日 观世音菩萨圣诞').length === 0);
assert('岁 not tokenized as 遍/张', extractNumberTokens('孩子13岁').length === 0);

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

console.log('— canonical-strict mode —');
{
  const opts = { canonicalTexts: [CHUNK_CANONICAL] };
  // 13遍 exists only in the ordinary 锦集 chunk (听众 question) → in canonical
  // mode, prose use of it is REJECTED (the 29cfd74c "旧版写13遍" loophole).
  const v = checkDraft('早期旧版写的是一天不超过13遍。', CHUNKS, [], opts);
  assert('ordinary-chunk-only number rejected', v.some((x) => x.type === 'number' && x.text === '13遍'), v);

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
