// scripts/test-level-cues.ts — model-free checks for src/lib/prompt/level-cues.ts
// (brief 2026-09-13-fellow-practitioner-mode + addendum §5): the six 同修轮
// cases must already be experienced BEFORE the reply, the two 反例 must not be,
// and every beginner regression case keeps the 入门轮.
//   npx tsx scripts/test-level-cues.ts
import { levelFromCues, needsCareFromCues, stageToLevel, maxLevel } from '../src/lib/prompt/level-cues';

let passed = 0;
let failed = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

console.log('— R26–R31: experienced before the reply (production wording) —');
const FELLOW: [string, string[]][] = [
  ['R26', ['清修后怎样跟异性保持距离 如果遇到缘分怎么办']],
  ['R27', ['如何修光明心']],
  ['R28', ['要怎样才能提高境界', '有']],
  ['R29', ['你好休息，心灵法门已有好几年。目前因为年事已高，家人又没有修行，所以只有入住安老院，但是现在供奉的佛台要结缘出去，请问我应该念多少张小房子和进正处该写什么才能如理如法的请下供台，感恩。']],
  ['R30', ['我刚度一位女佛友，也开始念经了，有时候她有不明白会问我，接下来要跟进这位女佛友是否交给女义工的师兄，因为我是男的']],
  ['R31', ['清修遇到缘分怎么办 要怎样化解坚定清修路']],
];
for (const [id, turns] of FELLOW) {
  const r = levelFromCues(turns);
  assert(`${id} → experienced`, r.level === 'experienced', r);
}
assert('R29 → needs_care', needsCareFromCues(FELLOW[3][1]).needsCare, needsCareFromCues(FELLOW[3][1]));
assert('R26 → no needs_care', !needsCareFromCues(FELLOW[0][1]).needsCare);

console.log('\n— brief §为什么: other 老同修 first messages —');
for (const q of ['三界幻相是什么意思', '莲花两次机会是真的吗', '烧送结缘小房子怎么说', '怎样祈求369的小房子？', '菩萨像想换成瓷像可以吗', '7749天怎么算']) {
  assert(`「${q}」 → experienced`, levelFromCues([q]).level === 'experienced', levelFromCues([q]));
}

console.log('\n— 反例 —');
{
  const f1 = levelFromCues(['工作一直不顺，是不是有业障？']);
  assert('F1 「工作一直不顺，是不是有业障？」 → new/beginner', f1.level === 'new' || f1.level === 'beginner', f1);
  const f2 = levelFromCues(['小房子的经文组合是什么？']);
  assert('F2 「小房子的经文组合是什么？」 → practising (not experienced)', f2.level === 'practising', f2);
}

console.log('\n— beginner regression cases keep the 入门轮 —');
const BEGINNER: [string, string[]][] = [
  ['R12', ['我最近失眠很严重，念什么经好？', '没有学过']],
  ['R13', ['我想开始念小房子', '还没有开始念功课']],
  ['R14', ['和家人一直吵架，我可以先学什么？', '没有念过']],
  ['R25', ['谢谢你的解析，小房子的篇数是多少？', '如何念诵，可以教我吗？', '还没']],
];
for (const [id, turns] of BEGINNER) {
  const r = levelFromCues(turns);
  assert(`${id} → new/beginner`, r.level === 'new' || r.level === 'beginner', r);
}
for (const q of ['我最近失眠很严重，念什么经好？', '和家人一直吵架，我可以先学什么？', '我想开始念经，从哪里开始？', '家人生病了，我可以念什么经？']) {
  const r = levelFromCues([q]);
  assert(`chip-style 「${q}」 → not experienced/practising`, r.level === 'new' || r.level === 'beginner', r);
}
assert('R17 小房子组合＋多少遍 → practising', levelFromCues(['小房子的经文组合是什么？每种经文各念多少遍？']).level === 'practising');
assert('「帮我超度一位亡人」 is not 度人', levelFromCues(['请问怎么帮我超度一位亡人']).level !== 'experienced', levelFromCues(['请问怎么帮我超度一位亡人']));

console.log('\n— 09-16 A1: own words beat the jargon (cap at beginner) —');
{
  const capped = levelFromCues(['清修的同修问：我要怎么开始？我还没开始念功课']);
  assert('清修 jargon + 「还没开始」 → beginner, not experienced', capped.level === 'beginner', capped);
  assert('…and the capped experienced cue is visible in hits', capped.hits.some((h) => h.startsWith('capped-experienced:')), capped);
  const xfz = levelFromCues(['小房子要念多少张？', '我没念过经']);
  assert('小房子／几张 + 「没念过经」 → beginner', xfz.level === 'beginner', xfz);
  assert('without the self-report, 清修 stays experienced', levelFromCues(['清修遇到缘分怎么办']).level === 'experienced');
}

console.log('\n— 09-16: a visitor reporting their own counts is practising —');
{
  const r22 = levelFromCues(['梦到买一条蛇，不知道放哪里，实然看到飞进房间，感觉他是照顾我。请问这是什么意思', '有', '大悲咒21', '心经21']);
  assert('R22「大悲咒21」「心经21」 → practising (was new)', r22.level === 'practising', r22);
  assert('「我念了7张小房子」 → practising', levelFromCues(['我念了7张小房子']).level === 'practising');
  assert('「大悲咒是什么」 (no count) stays new', levelFromCues(['大悲咒是什么']).level === 'new', levelFromCues(['大悲咒是什么']));
}

console.log('\n— stage & maxLevel —');
assert('stage steady_practice (同修) → experienced', stageToLevel('steady_practice') === 'experienced');
assert('stage volunteer → experienced', stageToLevel('volunteer') === 'experienced');
assert('stage started_chanting (新同修) → practising', stageToLevel('started_chanting') === 'practising');
assert('stage first_contact (新佛友) → null', stageToLevel('first_contact') === null);
assert('legacy stage 共修者 → experienced', stageToLevel('共修者') === 'experienced');
assert('maxLevel(new, practising, null) → practising', maxLevel('new', 'practising', null) === 'practising');
assert('maxLevel() → new', maxLevel() === 'new');
assert('maxLevel(experienced, beginner) → experienced (upgrade-only)', maxLevel('experienced', 'beginner') === 'experienced');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
