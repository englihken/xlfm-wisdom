// scripts/test-crisis-keywords.ts
// Unit tests for the mechanical crisis-keyword floor (no model, no DB).
//   npx tsx scripts/test-crisis-keywords.ts
import { detectCrisisKeywords, matchedCrisisKeywords, CRISIS_KEYWORDS } from '../src/lib/crisis-keywords';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail ?? ''); }
}

console.log('— the real case (conv df9ffe56 / d5ccd1a4, 08-28 21:26 MYT) —');
const real1 = '家人网络赌博赔钱 有轻生的念头怎么办';
const real2 = '家人网络赌博赔钱 有轻生的情况怎么办';
assert('「有轻生的念头」 → crisis', detectCrisisKeywords(real1), matchedCrisisKeywords(real1));
assert('「有轻生的情况」 → crisis', detectCrisisKeywords(real2));
assert('matched keyword is 轻生', matchedCrisisKeywords(real1).includes('轻生'));

console.log('— aligned with karma_warning self-harm terms + inbox defaults —');
for (const kw of ['轻生', '不想活', '活不下去', '想死', '自杀', '自伤', '结束生命', '自尽', '自残', '了结', '绝望']) {
  assert(`built-in list contains ${kw}`, CRISIS_KEYWORDS.includes(kw));
}
assert('「我真的不想活了」', detectCrisisKeywords('我真的不想活了'));
assert('「活不下去了」', detectCrisisKeywords('压力太大，活不下去了'));
assert('「想结束生命」', detectCrisisKeywords('有时候想结束生命'));
assert('EN "kill myself" with odd spacing', detectCrisisKeywords('I want to kill  myself'));
assert('EN "suicidal"', detectCrisisKeywords('I have been feeling suicidal'));
assert('BM "bunuh diri"', detectCrisisKeywords('saya rasa nak bunuh diri'));
assert('org-configured extra keyword', detectCrisisKeywords('我想跳河', ['跳河']));

console.log('— non-crisis text stays clean —');
assert('失眠 question → no', !detectCrisisKeywords('我最近失眠很严重，念什么经好？'));
assert('堕胎 (karma_warning but not self-harm) → no', !detectCrisisKeywords('以前堕胎过，要念多少小房子？'));
assert('杀生/超生 → no', !detectCrisisKeywords('杀生的果报，往生咒念多少遍？'));
assert('empty → no', !detectCrisisKeywords(''));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
