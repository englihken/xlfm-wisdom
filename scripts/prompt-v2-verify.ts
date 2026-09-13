// scripts/prompt-v2-verify.ts — batch 4 (F08) traceability, mechanically.
// Rule 1 of the brief: every line of v2 must trace to a line of v1 or to one
// of the eight decisions C1–C8. This script:
//   1. maps every non-blank zh line of src/lib/prompt/* to the v1 line(s) it
//      copies (src/lib/system-prompt.v1.ts, whose line numbers = the brief's L-refs);
//   2. requires every line that does NOT match v1 to be in NEW_LINES (with its C#);
//   3. requires every v1 content line that is NOT in v2 to be in DELETED (with its C#);
//   4. checks the number / 《书名》 / URL / phone / 祈求词 inventories of v2 ⊆ v1;
//   5. with --i18n: checks EN/ID modules line-for-line (same line count, same
//      inventories) against the zh modules;
//   6. with --write: writes docs/reviews/batch4-2026-09-11/traceability.md
//      (合并 / 删除 / 新增 tables).
// Exit 1 on any untraced line.
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ZH_MODULES, MODULE_ORDER, type ModuleKey } from '../src/lib/prompt/modules-zh';

const ROOT = path.join(__dirname, '..');
const V1_FILE = path.join(ROOT, 'src', 'lib', 'system-prompt.v1.ts');
const OUT_MD = path.join(ROOT, 'docs', 'reviews', 'batch4-2026-09-11', 'traceability.md');

// ── normalisation: what counts as "the same line" ──────────────────────────
const V1_HEADER_RE = /^第[一二三四五六七八九十]+部分\s*[:：]\s*/;
// Ken 2026-09-12 (docs/briefs/2026-09-12-full-sutra-names.md): 功课块 lines
// render a sutra as 《全称》（简称）. That is a RENDERING change, not new
// content — the line still traces to its v1 twin. normRename() folds the card
// form back to the short name so those lines keep matching; every line where
// it actually fired is listed in the traceability table's fourth section,
// tagged `ken-0912-fullname`, so the rename is still visible line by line.
const FULLNAME_RENAMES: [RegExp, string][] = [
  [/《千手千眼无碍大悲心陀罗尼》（大悲咒）/g, '《大悲咒》'],
  [/《般若波罗蜜多心经》（心经）/g, '《心经》'],
  [/《往生净土神咒》（往生咒）/g, '《往生咒》'],
];
function normRename(s: string): string {
  let out = s;
  for (const [re, to] of FULLNAME_RENAMES) out = out.replace(re, to);
  return out;
}
// Ken 2026-09-12 (docs/briefs/2026-09-13-prayer-form.md): zh 祈求词 open with
// the 功课卡's 「祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨」 instead of
// 《入门手册》's 「请大慈大悲（的）观世音菩萨」; what is prayed for is unchanged.
// normPrayer() folds both openers to one token (v1 side via v1PrayerIndex) so
// the line still traces to its v1 twin; listed in the fourth table as
// `ken-0912-prayer`. 小房子 (《念诵指南》) and 放生 prayers keep the short form.
const PRAYER_OPENER_RE = /祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨|请大慈大悲(?:的)?观世音菩萨/g;
function normPrayer(s: string): string {
  return s.replace(PRAYER_OPENER_RE, '〈祈求开头〉');
}
type RenameTag = 'ken-0912-fullname' | 'ken-0912-prayer' | 'ken-0912-fullname + ken-0912-prayer';
function norm(s: string): string {
  return s
    .replace(/^export const \w+ = `/, '')
    .replace(/`;$/, '')
    // v1 is read as TS source (backticks escaped); v2 modules are evaluated strings
    .replace(/\\`/g, '`')
    .replace(/\\\$\{/g, '${')
    .replace(V1_HEADER_RE, '')
    .replace(/^##\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── v1 index ───────────────────────────────────────────────────────────────
const v1Lines = fs.readFileSync(V1_FILE, 'utf8').split('\n');
// content = inside the three template literals (SYSTEM_PROMPT_ZH 6–2819,
// GROUNDING 2848–2854, LETTERS 2862–2874); everything else is TS wrapper.
const V1_CONTENT_RANGES: [number, number][] = [
  [6, 2819],
  [2849, 2854],
  [2863, 2874],
];
const isV1Content = (n: number) => V1_CONTENT_RANGES.some(([a, b]) => n >= a && n <= b);
const v1Index = new Map<string, number[]>();
for (let n = 1; n <= v1Lines.length; n++) {
  if (!isV1Content(n)) continue;
  const k = norm(v1Lines[n - 1]);
  if (!k || /^=+$/.test(k)) continue;
  const arr = v1Index.get(k) ?? [];
  arr.push(n);
  v1Index.set(k, arr);
}

// Same index with both prayer openers folded (ken-0912-prayer lookups only).
const v1PrayerIndex = new Map<string, number[]>();
for (const [k, ns] of v1Index) {
  const kp = normPrayer(k);
  v1PrayerIndex.set(kp, [...(v1PrayerIndex.get(kp) ?? []), ...ns]);
}

// ── the only lines allowed NOT to trace to v1: the C1–C8 implementations ──
// (exact text after norm(); C# and a one-line reason for the traceability table)
const NEW_LINES: { text: string; c: string; why: string }[] = [
  // C1 小房子门槛
  { text: '很多人先把大悲咒、心经念顺再加，但只要功课开始了，就可以起小房子', c: 'C1', why: '允许保留的一处软性建议措辞' },
  { text: '- 很多人先把大悲咒、心经念顺再加，但只要功课开始了，就可以起小房子', c: 'C1', why: '允许保留的一处软性建议措辞（Tier 0 小房子条目下）' },
  { text: '- 需要小房子（门槛见【入门轮硬性规则】第 4 条：功课一开始就可以念）', c: 'C1', why: '替换 L2182–2183「见 Tier 3／先会 4 部经才能做」' },
  { text: '### 🏠 小房子教学 (访客主动问到时才教)', c: 'C1', why: '替换 L2209 标题「只在 Tier 3 或用户主动问」；「访客问了才教」保留' },
  { text: '跟着视频念 🙏', c: 'C1', why: 'L2471 去掉「坚持 1-2 周。熟悉了再加其他的」' },
  { text: '4. **礼佛从 1 遍开始**', c: 'C1', why: 'L2541 去掉「(Tier 1 才给)」' },
  { text: '- 小房子念诵指南', c: 'C1', why: 'L1356 去掉「在用户熟悉经文后才教（通常两周后）」' },
  // C2 关系类 × 分档
  { text: '### 🔒 关系类回答的结构', c: 'C2', why: 'L1634 改名' },
  { text: '#### 第 4 段：功课（经文与遍数按分档）', c: 'C2', why: 'L1685 标题改为按分档' },
  { text: '- 完全没念过／怕难／时间少 → 《大悲咒》3 遍 + 《心经》3 遍 + 《解结咒》21 遍（解结咒是他问题的药，不能省）；礼佛不在这一轮', c: 'C2', why: '分档一' },
  { text: '- 念顺了 → 《大悲咒》7 遍 + 《心经》7 遍 + 《解结咒》21-49 遍，《礼佛大忏悔文》1 遍起', c: 'C2', why: '分档二' },
  { text: '- 已在修 → 四部完整（下面的写法）；祈求词各档都照下面的原文', c: 'C2', why: '分档三；祈求词照 v1 原文' },
  { text: '（示例与下面「常见场景」里的功课块都是「已在修」档的第 4 段写法；「没念过」「念顺了」两档按上面的分档替换第 4 段）', c: 'C2', why: 'v1 示例保留原样，标明它们是「已在修」档' },
  { text: '1. **功课按分档**：没念过 → 大悲咒 3 + 心经 3 + 解结咒 21；念顺了 → 7 + 7 + 解结咒 21-49，礼佛 1 遍起；已在修 → 四部完整', c: 'C2', why: 'L1811「4 部必念」改为按分档' },
  { text: '- 《礼佛大忏悔文》 **1-3 遍**（初学者必须少念！；完全没念过／怕难／时间少这一档不在本轮，见第 4 段分档）', c: 'C2', why: 'L1645「所有修行人必须」的礼佛条目与分档一冲突，加限定（brief 未点名，请架构师确认）' },
  // C3 给了再问
  { text: '用户说"想开始念经/学佛" 时,AI 在**同一条回复**里给暂定功课（按分档）＋分诊问题 **"你之前有念过经吗?"**——全语言统一：给了再问，不是先问再给', c: 'C3', why: 'L2093「AI 第一件事 = 问」改为同一条回复' },
  { text: '✅ AI 在同一条回复里先给暂定功课（Tier 0 的两部＋祈求词）,再问:', c: 'C3', why: '模板 A L2453「AI 先问:」' },
  { text: '### 📿 Qualify-First 原则（英文同样：暂定功课＋分诊问题在同一条回复里）', c: 'C3', why: 'L2677 标题「英文也要先问」' },
  { text: 'AI 在同一条回复里给暂定功课（按分档）＋这个问题:', c: 'C3', why: 'L2681「AI 必须 FIRST 问用户 (不要立刻给完整功课表)」删，问题本身保留' },
  // C4 引用范围
  { text: '入门轮除外——入门轮按入门轮规则 5：先方法后道理，引用最多一段且在功课之后。', c: 'C4', why: 'L1053「必须优先直接引用」的限定句' },
  // C5 安全优先级
  { text: '**本部分（自杀倾向、严重抑郁、自残、家庭暴力、虐待）的规则高于「家庭、婚姻、法律问题的回应原则」（关系类模块）。**', c: 'C5', why: '放在第十部分开头' },
  { text: '3. **不给法律策略** —— 离不离、争不争、怎么打官司、谁对谁错，不是我们的角色。**人身安全的求助——报警、危机热线、庇护所——永远可以说；访客描述家暴或有人身危险时必须先说。**', c: 'C5', why: 'L1832 红线 #3' },
  { text: '不引向：法律策略与对抗。', c: 'C5', why: 'L1946' },
  // C6 礼佛时间
  { text: '- 时间以《佛学问答》161／组织审定为准：非特殊日子晚上 10 点至凌晨 5 点最好不念（有佛台上头香的日子例外）。《入门手册》p18『白天晚上都可念』是 2012 年的写法，此点已被后来开示细化。', c: 'C6', why: '第七部分礼佛条目加一句' },
  // C7 长度表
  { text: '| 轮次 | 长度 |', c: 'C7', why: '长度表表头' },
  { text: '|---|---|', c: 'C7', why: '长度表' },
  { text: '| 入门轮 | 正文 ≤ 400 字（功课块不计） |', c: 'C7', why: '长度表' },
  { text: '| 一般问答 | 1–2 段 |', c: 'C7', why: '长度表' },
  { text: '| 教义数字（礼佛遍数、小房子规格） | 按需，数字齐全优先 |', c: 'C7', why: '长度表' },
  { text: '| 危机 | 按危机四步，不设字数 |', c: 'C7', why: '长度表' },
  { text: '| 关系类 | 四段结构，功课块按分档 |', c: 'C7', why: '长度表' },
  // C8 结构（章节标题只是搬家）
  { text: '### 📜 2010 年之前案例里的经文组合（era 规则）', c: 'C8', why: 'LETTERS 第 6 条搬到 xiaofangzi 模块时的小标题' },
  // ── Ken 2026-09-12 功课块经名用全称 ──
  { text: '6. **功课块（📿 行）经名用全称，简称加括号；正文可用简称。** 与共修总会功课卡一致：卡上标题用全称，括号里给简称。只有全称与简称不同的经才加括号。', c: 'ken-0912-fullname', why: 'brief §CC 1：新规则进入门轮硬性规则' },
  { text: '| 功课块写法（📿 行） | 正文可用 |', c: 'ken-0912-fullname', why: '写法表表头' },
  { text: '| 《千手千眼无碍大悲心陀罗尼》（大悲咒）每天 3 遍 | 大悲咒 |', c: 'ken-0912-fullname', why: '写法表' },
  { text: '| 《般若波罗蜜多心经》（心经）每天 3 遍 | 心经 |', c: 'ken-0912-fullname', why: '写法表' },
  { text: '| 《礼佛大忏悔文》每天 1 遍 | 礼佛 |', c: 'ken-0912-fullname', why: '写法表' },
  { text: '| 《往生净土神咒》（往生咒）每天 21 遍 | 往生咒 |', c: 'ken-0912-fullname', why: '写法表' },
  { text: '| 《解结咒》《准提神咒》《消灾吉祥神咒》《七佛灭罪真言》《补阙真言》《净口业真言》《大吉祥天女咒》《功德宝山神咒》 | 同名 |', c: 'ken-0912-fullname', why: '写法表：全称＝简称的经' },
  { text: '小房子不在此列（仍写「小房子」）。祈求词一字不动。英文／印尼文回复的功课块用该语言的经名，不套这张表。', c: 'ken-0912-fullname', why: '写法表的例外说明' },
  { text: '**1. 《千手千眼无碍大悲心陀罗尼》（大悲咒）**', c: 'ken-0912-fullname', why: 'v1 L513 功用表标题改成卡片写法（全称在前）' },
  { text: '**2. 《般若波罗蜜多心经》（心经）**', c: 'ken-0912-fullname', why: 'v1 L521 同上' },
  { text: '**4. 《往生净土神咒》（往生咒；全名《拔一切业障根本得生净土陀罗尼》）**', c: 'ken-0912-fullname', why: 'v1 L542 同上；v1 写的全名《拔一切业障根本得生净土陀罗尼》保留，Ken 的卡名《往生净土神咒》加在前面（两个名字都是这部咒的名字，见报告）' },
  // ── Ken／架构师 2026-09-13 小房子学习者与一般初学者首轮三部都开（docs/briefs/2026-09-13-xiaofangzi-entry.md）──
  { text: '- **初学者** → 首轮功课默认三部都开：《大悲咒》3 遍＋《心经》3 遍＋《礼佛大忏悔文》1 遍；访客嫌难才先开两部，礼佛几天内加上', c: 'ken-0913-three-pillars', why: '规则 2：替换 addendum-B1 的 L77 改写（念顺后才加礼佛）' },
  { text: '2. 禁止写「关于具体的遍数／张数，我目前查不到相关原文」——入门功课的数字以检索到的《心灵法门入门手册》原文为准（每天《大悲咒》7遍、《心经》7遍、礼佛大忏悔文1-3遍左右、《往生咒》21或49遍；完全没念过的首轮开三部：《大悲咒》3遍＋《心经》3遍＋《礼佛大忏悔文》1遍）。', c: 'ken-0913-three-pillars', why: '规则 2：v1 L2099 括号里「完全没念过的先从大悲咒3＋心经3起步」→ 三部' },
  { text: '- 完全没念过 → 三部都开：《大悲咒》3遍＋《心经》3遍＋《礼佛大忏悔文》1遍，每部带祈求词＋教念视频；《往生咒》21 遍可以提「一般初学者都需要」（按功课卡）', c: 'ken-0913-three-pillars', why: '规则 2：v1 L2108 起步分档第一档' },
  { text: '- 访客明说怕难／时间少／不识字 → 才降为《大悲咒》3遍＋《心经》3遍（甚至先一部）起步，并说明《礼佛大忏悔文》是第三支柱，几天内加上', c: 'ken-0913-three-pillars', why: '规则 2：嫌难才减（Ken「if slow, choose one to start」）' },
  { text: '- 稳定后 → 礼佛大忏悔文逐步加到一般 3 遍左右（不超过 7 遍）＋《往生咒》21 遍', c: 'ken-0913-three-pillars', why: 'v1 L2110「加礼佛 1 遍起」与首轮已开礼佛冲突，改为逐步加到 3 遍左右（数字不变）' },
  { text: '· 看整通对话，不只看这一轮：访客前面任何一轮问过小房子（组合、遍数、怎么念、张数），后来才说「还没／没念过」，仍按下面这条回答——三部功课块之后一定要写门槛句，不要只给功课不提小房子', c: 'ken-0913-three-pillars', why: '规则 1：小房子意图跨轮（R25 pass B：第 3 轮检索只拼上一轮访客话，小房子话题掉了，回复没写门槛句）' },
  { text: '· 完全还没开始念功课 → 功课块三部都开：《千手千眼无碍大悲心陀罗尼》（大悲咒）3 遍、《般若波罗蜜多心经》（心经）3 遍、《礼佛大忏悔文》1 遍（《往生咒》21 遍可提「一般初学者都需要」）；紧接一句「功课开始了就可以起小房子，不用等熟练——当天念了功课的大悲咒之后就可以开始」；引《念诵指南》第 14 页原文「尚未开始念诵基本功课的初学者，需从基本功课《大悲咒》、《心经》、《礼佛大忏悔文》念起。」这一步不能跳：「打好基本功，小房子才有能量和效果」。不要说「念顺了再加礼佛」', c: 'ken-0913-three-pillars', why: '规则 1：v1 L2112 小房子意图＋尚未开始功课' },
  { text: '5. 「提」和「开」：介绍三大支柱时三部都要点名；**首轮默认三部都开（大悲咒 3 + 心经 3 + 礼佛 1）**，与共修总会功课卡「以下三种经文为必做功课」一致。只有访客明说怕难／时间少／不识字，才降为大悲咒＋心经（甚至先一部）起步，并说明《礼佛大忏悔文》是第三支柱、几天内加上（遍数与时间按《佛学问答》161／组织审定）。关系类另加《解结咒》21（见关系类模块的分档）。', c: 'ken-0913-three-pillars', why: '规则 3：入门轮硬性规则第 5 条（addendum-B1）改写' },
  { text: '- 礼佛大忏悔文 每天 1 遍（三部默认都开；访客明说怕难／时间少才先开前两部，礼佛几天内加上）', c: 'ken-0913-three-pillars', why: '规则 2：Tier 0「不开礼佛」（addendum-B1）→ 开 1 遍' },
  { text: '- 礼佛前: "祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨保佑我（姓名）忏悔消除业障"', c: 'ken-0913-three-pillars', why: 'Tier 0 祈求词示范补礼佛（祈求词照 v1 L1799 关系类原文）' },
  { text: '- **礼佛大忏悔文 每天 1 遍起**（Tier 0 已默认开；先前嫌难没开的，这时加上）', c: 'ken-0913-three-pillars', why: 'v1 L2146 Tier 1「加礼佛 1 遍」与 Tier 0 已开冲突' },
  { text: '✅ AI 在同一条回复里先给暂定功课（Tier 0 的三部＋祈求词）,再问:', c: 'ken-0913-three-pillars', why: '模板 A（C3 行）两部 → 三部' },
  { text: '📿 《礼佛大忏悔文》每天 1 遍', c: 'ken-0913-three-pillars', why: '模板 B 补第三部' },
  { text: '念之前说:"祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨保佑我（姓名）忏悔消除业障"', c: 'ken-0913-three-pillars', why: '模板 B 礼佛祈求词（照 v1 L1799 原文）' },
  { text: '(晚上 10 点至凌晨 5 点不念)', c: 'ken-0913-three-pillars', why: '模板 B 礼佛时间（照 C6／《佛学问答》161）' },
  { text: '**4. 三大支柱（介绍时三部都要提到；首轮默认三部都开，访客嫌难才先开两部）：**', c: 'ken-0913-three-pillars', why: '规则 2：addendum-B1 标题「首轮可以只开两部」' },
  { text: '补充说明：访客明说怕难／时间少时，可以说"先念前两部，礼佛大忏悔文几天内加上"', c: 'ken-0913-three-pillars', why: '规则 2：v1 L1316「先念前两部熟悉，等熟了再加」→ 只在嫌难时说' },
  { text: '- 初学者首轮默认三部都开，礼佛从 1 遍开始；访客嫌难才先开大悲咒、心经，礼佛几天内加上', c: 'ken-0913-three-pillars', why: '规则 2：addendum-B1 的 L180 改写' },
  { text: '- 《礼佛大忏悔文》—— 消除业障，忏悔过往（访客嫌难时才说"先念前两部，几天内加上"）', c: 'ken-0913-three-pillars', why: '规则 2：v1 L220' },
  { text: '- 《礼佛大忏悔文》 **1-3 遍**（初学者必须少念！没念过档从 1 遍开始；访客明说怕难／时间少才先不开，见第 4 段分档）', c: 'ken-0913-three-pillars', why: '规则 2 (a)：C2 限定句' },
  { text: '- 完全没念过 → 《千手千眼无碍大悲心陀罗尼》（大悲咒）3 遍 + 《般若波罗蜜多心经》（心经）3 遍 + 《礼佛大忏悔文》1 遍 + 《解结咒》21 遍（解结咒是他问题的药，不能省）', c: 'ken-0913-three-pillars', why: '规则 2 (a)：关系类分档一加礼佛 1（队列：Ken 未另说按 (a)）' },
  { text: '- 访客明说怕难／时间少 → 大悲咒 3 遍 + 心经 3 遍 + 《解结咒》21 遍起步；《礼佛大忏悔文》是第三支柱，几天内加上', c: 'ken-0913-three-pillars', why: '规则 2 (a)：关系类嫌难档' },
  { text: '1. **功课按分档**：没念过 → 大悲咒 3 + 心经 3 + 礼佛 1 + 解结咒 21（访客明说嫌难才先不开礼佛）；念顺了 → 7 + 7 + 解结咒 21-49，礼佛 1 遍起；已在修 → 四部完整', c: 'ken-0913-three-pillars', why: '规则 2 (a)：C2 核心原则汇总' },
  { text: '> 📿 《礼佛大忏悔文》每天 1 遍（晚上 10 点至凌晨 5 点不念）', c: 'ken-0913-three-pillars', why: '规则 2 (a)：「没念过」档示例（addendum-A6）补礼佛；祈求词行照 v1 L1799 原文自动追溯' },
  // ── 增补（docs/briefs/2026-09-11-batch-4-addendum.md）──
  { text: '**"老公出轨了，我该怎么办？"（访客已经说过没念过经——「没念过」档的写法）**', c: 'addendum-A6', why: 'L1870 第二个示例改写成「没念过」档' },
  { text: '> 📿 《大悲咒》每天 3 遍', c: 'addendum-A6', why: '没念过档功课块（祈求词行照 v1 L1788/1791/1799 原文，自动追溯）' },
  { text: '> 📿 《心经》每天 3 遍（晚上 10 点后不念）', c: 'addendum-A6', why: '没念过档功课块' },
  { text: '> 📿 《解结咒》每天 21 遍', c: 'addendum-A6', why: '没念过档功课块' },
  { text: '（下面这个完整示例是「已在修」档的第 4 段写法；「常见场景」的第一例是「没念过」档的写法；「念顺了」档按上面的分档替换第 4 段）', c: 'addendum-A6', why: 'C2 标注句改为两档各一例' },
  { text: '- **初学者** → 首轮功课从《大悲咒》《心经》入手；《礼佛大忏悔文》作为第三支柱在念顺后加入', c: 'addendum-B1', why: 'L77' },
  { text: '- 初学者首轮功课从《大悲咒》《心经》入手；礼佛作为第三支柱在念顺后加入', c: 'addendum-B1', why: 'L180' },
  { text: '- **标准入门功课（已在修／念顺档）：初学者只教三大支柱**（大悲咒 + 心经 + 礼佛大忏悔文 + 日常 21 遍往生咒）', c: 'addendum-B1', why: 'L636 前加标注' },
  { text: '**4. 三大支柱（介绍时三部都要提到；首轮功课可以只开两部）：**', c: 'addendum-B1', why: 'L1311' },
  { text: '- **不开礼佛** (介绍时可以点名；太难,会吓跑)', c: 'addendum-B1', why: 'L2123' },
  { text: '5. 「提」和「开」是两回事：介绍三大支柱时三部都要点名（一句话即可：《礼佛大忏悔文》是第三支柱，大悲咒、心经念顺之后加入，遍数与时间按《佛学问答》161／组织审定）。**Tier 0 首轮开功课只开大悲咒 3 + 心经 3**；关系类加《解结咒》21（见关系类模块的分档）。', c: 'addendum-B1', why: '架构师给的那句话，放在入门轮硬性规则第 5 条' },
  { text: "     comfortable with these two — there's no fixed timeline — you can add the Repentance Mantra.", c: 'addendum-B2', why: 'L2697 删「(1-2 weeks)」' },
  { text: '- 回复语言＝界面语言（zh/en/id 由拼装决定）', c: 'addendum-B3', why: 'L921–923 语言切换改写' },
  { text: '- 用户偶尔夹别的语言，可用那种语言问候一句，然后回到界面语言', c: 'addendum-B3', why: 'L921–923 语言切换改写' },
  { text: '**用户："我老公外遇，我想离婚（我平时有念经）"**', c: 'addendum-B4', why: 'L1116 示例用户句加「（我平时有念经）」' },
  { text: '2. **首轮：同一条回复里给暂定功课，并问有没有念过经** (决定 Tier)', c: 'addendum-B5', why: 'L2539' },
  { text: '- 家暴走危机四步：首轮只给安全资源＋一句菩萨圣号；功课等对方安全后、主动再问时再谈', c: 'addendum-B6', why: '第十部分家暴条目加一句' },
];
const newIndex = new Map(NEW_LINES.map((n) => [norm(n.text), n]));

// ── v1 lines that are allowed to be absent from v2 ────────────────────────
// (inclusive ranges; C# or 「结构」 for headers/separators/TS wrapper)
const DELETED: { from: number; to: number; c: string; why: string }[] = [
  { from: 399, to: 399, c: 'C1', why: '「新学员先念这个功课 ~2 周…不急着开始小房子」' },
  { from: 1339, to: 1344, c: 'C7', why: '「理想的回答长度」段（长度统一进表）' },
  { from: 1381, to: 1381, c: 'C1', why: '「不要一开始就教小房子，至少先熟悉经文两周」' },
  { from: 1401, to: 1408, c: 'C1', why: '「小房子的教学时机」整段：L1404 两周 + L1405「熟悉后才教」+ L1406 例外 + L1408「先感受安稳再引入」是同一句话的展开，只删 L1404 会留下自相矛盾的残句 → 整段删，请架构师确认' },
  { from: 1645, to: 1645, c: 'C2', why: '礼佛条目加限定（见新增表）' },
  { from: 1685, to: 1685, c: 'C2', why: '第 4 段标题（改为按分档）' },
  { from: 1701, to: 1701, c: 'C2', why: '「4 部必须全给，不许少」' },
  { from: 1764, to: 1764, c: 'C2', why: '「太多了念不完」降档块里的礼佛 1 遍——C2 规定怕难／时间少这一档礼佛不在本轮' },
  { from: 1811, to: 1811, c: 'C2', why: '「4 部必念」（改为按分档）' },
  { from: 1832, to: 1832, c: 'C5', why: '红线 #3 旧文' },
  { from: 1946, to: 1946, c: 'C5', why: '「不引向人间的对抗、法律的解决、外力的压制」旧文' },
  { from: 2093, to: 2093, c: 'C3', why: '「AI 第一件事 = 问」' },
  { from: 2106, to: 2106, c: 'C7', why: '入门轮 400 字（进表）' },
  { from: 2133, to: 2133, c: 'C1', why: '「先念 1-2 周,熟悉了再加东西」' },
  { from: 2182, to: 2183, c: 'C1', why: '「需要小房子 (见 Tier 3)／先会 4 部经才能做」' },
  { from: 2209, to: 2211, c: 'C1', why: '「小房子教学 (只在 Tier 3…)」标题 + 「进阶法宝,需要基础稳了才做」' },
  { from: 2278, to: 2289, c: 'C1', why: '「不熟练时的警告」整段（4 部经都要很熟练才能做 → 与 L2124 直接矛盾），请架构师确认' },
  { from: 2453, to: 2453, c: 'C3', why: '模板 A「AI 先问:」' },
  { from: 2471, to: 2471, c: 'C1', why: '模板 B「坚持 1-2 周。熟悉了再加其他的」' },
  { from: 2493, to: 2507, c: 'C1', why: '模板 E（Tier 0/1 问小房子 → 先 7 遍、加礼佛、学会往生咒七佛后才学）整段，与 L2124 直接矛盾，请架构师确认' },
  { from: 2541, to: 2542, c: 'C1', why: '汇总 #4「(Tier 1 才给)」、#5「小房子必须会 4 部经 (Tier 3 才详细教)」' },
  { from: 2677, to: 2677, c: 'C3', why: 'Qualify-First 标题「英文也要先问」' },
  { from: 2681, to: 2681, c: 'C3', why: '「AI 必须 FIRST 问用户 (不要立刻给完整功课表)」' },
  { from: 2689, to: 2689, c: 'C3', why: '「英文也要先 qualify,不是立刻 dump 完整 progression」' },
  { from: 931, to: 935, c: 'C7', why: '「结构（回答长度控制）」四行（进表；L931 标题与 L935「不要每次都写长文」保留）' },
  { from: 1634, to: 1634, c: 'C2', why: '「关系类案件 MANDATORY 回应模板（强制遵守）」标题（改名）' },
  { from: 1356, to: 1356, c: 'C1', why: '「小房子念诵指南 —— 在用户熟悉经文后才教（通常两周后）」（保留书名）' },
  // ── Ken 2026-09-12 功课块经名用全称 ──
  { from: 513, to: 513, c: 'ken-0912-fullname', why: '功用表标题《大悲咒》（全名…）→ 卡片写法' },
  { from: 521, to: 521, c: 'ken-0912-fullname', why: '同上（心经）' },
  { from: 542, to: 542, c: 'ken-0912-fullname', why: '同上（往生咒）' },
  // ── 增补 ──
  { from: 77, to: 77, c: 'addendum-B1', why: '「不要一开始就教礼佛」旧文' },
  { from: 180, to: 180, c: 'addendum-B1', why: '「初学者先不要念」旧文' },
  { from: 636, to: 636, c: 'addendum-B1', why: '加标注后的旧行' },
  { from: 921, to: 923, c: 'addendum-B3', why: '语言切换三行（改为回复语言＝界面语言）' },
  { from: 1116, to: 1116, c: 'addendum-B4', why: '示例用户句（加「我平时有念经」）' },
  { from: 1311, to: 1311, c: 'addendum-B1', why: '「必须全部提到，不能只提两部」' },
  { from: 1870, to: 1870, c: 'addendum-A6', why: '第二个示例标题（改写为没念过档）' },
  { from: 1877, to: 1880, c: 'addendum-A6', why: '第二个示例的四部功课块（改为 3+3+解结咒 21，礼佛不在本轮）' },
  { from: 1884, to: 1884, c: 'addendum-A6', why: '「你之前有念过经吗？」——访客已说过没念过，示例里不再问（同文另有两处保留）' },
  { from: 2123, to: 2123, c: 'addendum-B1', why: '「不提礼佛」→「不开礼佛」' },
  { from: 2539, to: 2539, c: 'addendum-B5', why: '「先问有没有念过经」' },
  { from: 2697, to: 2697, c: 'addendum-B2', why: '「(1-2 weeks)」' },
  // ── 2026-09-13 首轮三部都开 ──
  { from: 220, to: 220, c: 'ken-0913-three-pillars', why: '「可以说先念前两部熟悉，等熟了再加」→ 只在嫌难时说' },
  { from: 1316, to: 1316, c: 'ken-0913-three-pillars', why: '「对初学者可以说先念前两部熟悉，等熟了再加礼佛大忏悔文」' },
  { from: 2099, to: 2099, c: 'ken-0913-three-pillars', why: '入门轮规则 2 括号「完全没念过的先从大悲咒3＋心经3起步」' },
  { from: 2108, to: 2108, c: 'ken-0913-three-pillars', why: '「完全没念过／怕难／时间少 → 只给两部…念顺了我们再加」' },
  { from: 2110, to: 2110, c: 'ken-0913-three-pillars', why: '「稳定后 → 加礼佛 1 遍起」' },
  { from: 2112, to: 2112, c: 'ken-0913-three-pillars', why: '小房子「完全还没开始念功课」一行（改为三部＋门槛句＋p14 原文）' },
  { from: 2146, to: 2146, c: 'ken-0913-three-pillars', why: 'Tier 1「加 礼佛大忏悔文 每天 1 遍」' },
  // 结构：分隔线、第二十五部分标题（内容已拆入各模块）、EN/ID 包装（C8 assemble）
  { from: 2656, to: 2656, c: '结构', why: '第二十五部分标题（其内容按 C8 拆入 core/tiers/practice/sources）' },
  { from: 2817, to: 2819, c: '结构', why: '结尾分隔线「（结束）」' },
];
const deletedReason = (n: number) => DELETED.find((d) => n >= d.from && n <= d.to);

// ── walk v2 ────────────────────────────────────────────────────────────────
type Row = { module: ModuleKey; v2Line: number; text: string; v1: number[] | null; c?: string; why?: string; renamed?: boolean };
const rows: Row[] = [];
const renamedRows: { module: ModuleKey; v2Line: number; text: string; v1: number; tag: RenameTag }[] = [];
const usedV1 = new Set<number>();
let untraced = 0;
for (const key of MODULE_ORDER) {
  const lines = ZH_MODULES[key].split('\n');
  lines.forEach((raw, i) => {
    const k = norm(raw);
    if (!k) return;
    let hit = v1Index.get(k);
    // Card-style sutra rename (ken-0912-fullname) and card prayer opener
    // (ken-0912-prayer): same v1 line, new rendering.
    let tag: RenameTag | null = null;
    if (!hit) {
      const kr = norm(normRename(raw));
      if (kr !== k) {
        hit = v1Index.get(kr);
        if (hit) tag = 'ken-0912-fullname';
      }
    }
    if (!hit) {
      hit = v1PrayerIndex.get(norm(normPrayer(normRename(raw))));
      if (hit) tag = norm(normRename(raw)) !== k ? 'ken-0912-fullname + ken-0912-prayer' : 'ken-0912-prayer';
    }
    if (hit) {
      if (tag) {
        const pick = hit.find((n) => !usedV1.has(n)) ?? hit[0];
        renamedRows.push({ module: key, v2Line: i + 1, text: raw, v1: pick, tag });
      }
      // prefer an unused v1 line (duplicated lines like 「---」 map to the next free one)
      const pick = hit.find((n) => !usedV1.has(n)) ?? hit[0];
      usedV1.add(pick);
      rows.push({ module: key, v2Line: i + 1, text: raw, v1: hit });
      return;
    }
    // A C1–C8 / addendum line that the 09-12 rename also touched: same entry,
    // new sutra rendering (listed in the rename table too).
    const nl = newIndex.get(k) ?? newIndex.get(norm(normRename(raw)));
    if (nl) {
      if (!newIndex.get(k)) renamedRows.push({ module: key, v2Line: i + 1, text: raw, v1: 0, tag: 'ken-0912-fullname' });
      rows.push({ module: key, v2Line: i + 1, text: raw, v1: null, c: nl.c, why: nl.why });
      return;
    }
    untraced++;
    console.error(`UNTRACED ${key}:${i + 1}  ${raw.slice(0, 120)}`);
  });
}

// v1 content lines not used anywhere in v2
const missing: { n: number; text: string; c?: string; why?: string }[] = [];
for (let n = 1; n <= v1Lines.length; n++) {
  if (!isV1Content(n)) continue;
  const k = norm(v1Lines[n - 1]);
  if (!k || /^=+$/.test(k)) continue;
  // a line whose text also occurs elsewhere in v1 and THAT copy is used counts as present
  const twins = v1Index.get(k) ?? [];
  if (twins.some((t) => usedV1.has(t))) continue;
  const d = deletedReason(n);
  missing.push({ n, text: v1Lines[n - 1], c: d?.c, why: d?.why });
  if (!d) {
    untraced++;
    console.error(`V1 LINE DROPPED WITHOUT A C#: L${n}  ${v1Lines[n - 1].slice(0, 120)}`);
  }
}

// ── inventories (numbers / 《》 / URLs / phones / 祈求词) ──────────────────
const inv = (text: string) => ({
  books: new Set(text.match(/《[^》]{1,30}》/g) ?? []),
  urls: new Set(text.match(/https?:\/\/[^\s)）]+/g) ?? []),
  phones: new Set((text.match(/\+?\d{2,4}[- ]\d{3,4}[- ]?\d{3,4}|\b\d{5}\b|\b999\b/g) ?? []).map((p) => p.replace(/\s/g, ''))),
  counts: new Set(text.match(/\d+(?:-\d+)?\s*(?:遍|张)/g)?.map((c) => c.replace(/\s/g, '')) ?? []),
  prayers: new Set(text.match(/["“「]?(祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨[^"”」\n]{2,120}|请大慈大悲[^"”」\n]{4,120}|感恩南无大慈大悲救苦救难广大灵感观世音菩萨)/g)?.map((p) => p.replace(/^["“「]/, '')) ?? []),
});
const v1Text = v1Lines.filter((_, i) => isV1Content(i + 1)).join('\n');
const v2Text = MODULE_ORDER.map((k) => ZH_MODULES[k]).join('\n');
const I1 = inv(v1Text);
const I2 = inv(v2Text);
const diff = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x));
const invReport = {
  books: { v1: I1.books.size, v2: I2.books.size, onlyV1: diff(I1.books, I2.books), onlyV2: diff(I2.books, I1.books) },
  urls: { v1: I1.urls.size, v2: I2.urls.size, onlyV1: diff(I1.urls, I2.urls), onlyV2: diff(I2.urls, I1.urls) },
  phones: { v1: I1.phones.size, v2: I2.phones.size, onlyV1: diff(I1.phones, I2.phones), onlyV2: diff(I2.phones, I1.phones) },
  counts: { v1: I1.counts.size, v2: I2.counts.size, onlyV1: diff(I1.counts, I2.counts), onlyV2: diff(I2.counts, I1.counts) },
  // ken-0912-prayer: compared with the opener folded — every prayer's content
  // must survive; that the opener is the card's is checked by cardForm below.
  prayers: (() => {
    const a = new Set([...I1.prayers].map(normPrayer));
    const b = new Set([...I2.prayers].map(normPrayer));
    return { v1: a.size, v2: b.size, onlyV1: diff(a, b), onlyV2: diff(b, a) };
  })(),
};
// 「v2 祈求词 = 卡格式」: every zh prayer outside 小房子 (《念诵指南》) and the
// 放生 section opens with the card's long form. A short one anywhere else fails.
const SHORT_FORM_EXEMPT_TEXT =
  ZH_MODULES.xiaofangzi + '\n' + ZH_MODULES.practice.slice(0, ZH_MODULES.practice.indexOf('## 完整经文功用表'));
const cardForm = {
  long: [...I2.prayers].filter((p) => p.startsWith('祈请南无')).length,
  exempt: [...I2.prayers].filter((p) => p.startsWith('请大慈大悲') && SHORT_FORM_EXEMPT_TEXT.includes(p)),
  shortLeft: [...I2.prayers].filter((p) => p.startsWith('请大慈大悲') && !SHORT_FORM_EXEMPT_TEXT.includes(p)),
};
for (const p of cardForm.shortLeft) {
  untraced++;
  console.error(`PRAYER NOT IN CARD FORM: ${p.slice(0, 80)}`);
}

// ── i18n check ─────────────────────────────────────────────────────────────
type I18nReport = Record<string, { lines: string; missing: Record<string, string[]> }>;
async function checkI18n(): Promise<I18nReport> {
  const out: I18nReport = {};
  for (const lang of ['en', 'id'] as const) {
    const file = path.join(ROOT, 'src', 'lib', 'prompt', 'i18n', `${lang}.ts`);
    if (!fs.existsSync(file)) {
      out[lang] = { lines: 'file missing', missing: {} };
      continue;
    }
    const mod = (await import(pathToFileURL(file).href))[lang.toUpperCase()] as Partial<Record<ModuleKey, string>>;
    for (const key of MODULE_ORDER) {
      const t = mod[key];
      const zh = ZH_MODULES[key];
      if (!t) {
        out[`${lang}/${key}`] = { lines: 'missing', missing: {} };
        continue;
      }
      const a = inv(zh);
      const miss: Record<string, string[]> = {};
      for (const f of ['books', 'urls', 'phones', 'counts', 'prayers'] as const) {
        // counts: the digit must survive (遍 may become "times")
        // prayers: opener folded — en/id keep the 《入门手册》 opener in their
        // embedded zh (brief 2026-09-13: en/id not in scope); content must match.
        const want =
          f === 'counts' ? [...a[f]].map((c) => c.replace(/遍|张/, '')) : f === 'prayers' ? [...a[f]].map(normPrayer) : [...a[f]];
        const haveText = (f === 'prayers' ? normPrayer(t) : t).replace(/\s/g, '');
        const m = want.filter((w) => !haveText.includes(w.replace(/\s/g, '')));
        if (m.length) miss[f] = m;
      }
      out[`${lang}/${key}`] = { lines: `${t.split('\n').length}/${zh.split('\n').length}`, missing: miss };
    }
  }
  return out;
}

// ── report ─────────────────────────────────────────────────────────────────
function mergedTable(): string {
  // coalesce consecutive v2 rows whose v1 lines are consecutive → one row per block
  const out: string[] = ['| v1（行） | v2 模块（行） | 行数 |', '|---|---|---|'];
  let cur: { module: ModuleKey; v2a: number; v2b: number; v1a: number; v1b: number } | null = null;
  const flush = () => {
    if (cur) out.push(`| L${cur.v1a}${cur.v1b !== cur.v1a ? `–${cur.v1b}` : ''} | ${cur.module}.ts L${cur.v2a}${cur.v2b !== cur.v2a ? `–${cur.v2b}` : ''} | ${cur.v1b - cur.v1a + 1} |`);
    cur = null;
  };
  for (const r of rows) {
    if (!r.v1) {
      flush();
      continue;
    }
    const n = r.v1[0];
    if (cur && cur.module === r.module && n >= cur.v1b + 1 && n <= cur.v1b + 3 && r.v2Line <= cur.v2b + 3) {
      cur.v1b = n;
      cur.v2b = r.v2Line;
    } else {
      flush();
      cur = { module: r.module, v2a: r.v2Line, v2b: r.v2Line, v1a: n, v1b: n };
    }
  }
  flush();
  return out.join('\n');
}

function deletedTable(): string {
  const out: string[] = ['| v1 行 | 依据 | 原文（截 90 字） | 说明 |', '|---|---|---|---|'];
  for (const m of missing) out.push(`| L${m.n} | ${m.c ?? '❌ 无'} | ${m.text.trim().replace(/\|/g, '\\|').slice(0, 90)} | ${m.why ?? ''} |`);
  return out.join('\n');
}

function newTable(): string {
  const out: string[] = ['| v2 模块（行） | 依据 | 句子 | 说明 |', '|---|---|---|---|'];
  for (const r of rows.filter((r) => !r.v1)) out.push(`| ${r.module}.ts L${r.v2Line} | ${r.c} | ${r.text.trim().replace(/\|/g, '\\|')} | ${r.why} |`);
  return out.join('\n');
}

async function main() {
  const i18n = process.argv.includes('--i18n') ? await checkI18n() : null;
  const traced = rows.filter((r) => r.v1).length;
  const added = rows.filter((r) => !r.v1).length;
  const byTag = (t: string) => renamedRows.filter((r) => r.tag.includes(t)).length;
  console.log(`v2 zh lines: ${rows.length} non-blank · traced to v1: ${traced} (card rewrites: 全称 ${byTag('fullname')}, 祈求词 ${byTag('prayer')}) · new (C1–C8): ${added} · untraced: ${untraced}`);
  console.log('prayer card form:', JSON.stringify(cardForm));
  console.log(`v1 content lines absent from v2: ${missing.length} (${missing.filter((m) => !m.c).length} without a C#)`);
  console.log('inventories v1→v2:', JSON.stringify(invReport, null, 1));
  if (i18n) console.log('i18n:', JSON.stringify(i18n, null, 1));

  if (process.argv.includes('--write')) {
    const mergedRows = mergedTable().split('\n').length - 2;
    const md = `# Batch 4 — v1 → v2 traceability（机械生成：\`npx tsx scripts/prompt-v2-verify.ts --write --i18n\`）

生成时间 ${new Date().toISOString()}。行号 = \`src/lib/system-prompt.v1.ts\`（与 brief 的 L 号一致）。

- v2 中文非空行 **${rows.length}**：追溯到 v1 的 **${traced}**，C1–C8 新增 **${added}**，追溯不到 **${untraced}**。
- v1 内容行未进 v2 的 **${missing.length}**：有 C 号依据 ${missing.filter((m) => m.c).length}，无依据 ${missing.filter((m) => !m.c).length}。
- 三张表：合并 ${mergedRows} 行、删除 ${missing.length} 行、新增 ${added} 行。

## 清单核对（数字、经名、链接、电话、祈求词）

| 类别 | v1 | v2 | 只在 v1 | 只在 v2 |
|---|---|---|---|---|
${(['books', 'urls', 'phones', 'counts', 'prayers'] as const).map((f) => `| ${f} | ${invReport[f].v1} | ${invReport[f].v2} | ${invReport[f].onlyV1.join('、') || '—'} | ${invReport[f].onlyV2.join('、') || '—'} |`).join('\n')}

prayers 一行按「祈求开头」折叠后比较（\`ken-0912-prayer\` 只换开头，祈求内容须 v1=v2）。**卡格式核对（v2 祈求词 = 卡格式）**：卡的长句开头 ${cardForm.long} 条；仍是短句 ${cardForm.exempt.length + cardForm.shortLeft.length} 条，其中小房子／放生（不在范围）${cardForm.exempt.length} 条${cardForm.exempt.length ? `（${cardForm.exempt.join('；')}）` : ''}，范围内未改 **${cardForm.shortLeft.length}**。

${i18n ? `## EN／ID 翻译核对（逐行：行数相同；清单项目须在译文中原样出现）\n\n| 模块 | 行数（译/中） | 缺失 |\n|---|---|---|\n${Object.entries(i18n).map(([k, v]) => `| ${k} | ${v.lines} | ${Object.entries(v.missing).map(([f, m]) => `${f}: ${m.join('、')}`).join('；') || '—'} |`).join('\n')}\n` : ''}
## 一、合并（v1 哪几处 → v2 哪一处）

同一模块内连续的 v1 行合并成一行显示。

${mergedTable()}

## 二、删除（v1 哪一处，依据 C 几）

${deletedTable()}

## 三、新增（只允许是 C1–C8 的落实，逐句标 C 号）

${newTable()}

## 四、按共修总会功课卡改写法（内容不变，只改写法）

- \`ken-0912-fullname\`：功课块（📿 行）与分档／示例里的经名改成卡片写法《全称》（简称）。
- \`ken-0912-prayer\`（brief 2026-09-13-prayer-form）：zh 祈求词开头由《入门手册》的「请大慈大悲（的）观世音菩萨」改为卡的「祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨」，祈求内容一字不动；小房子（《念诵指南》）与放生的祈求词不在此列。

下面每一行都仍然追溯到左边那条 v1 行，差别只有「标记」列写明的写法。

| v2 模块（行） | v1 行 | 标记 | 句子 |
|---|---|---|---|
${renamedRows.map((r) => `| ${r.module}.ts L${r.v2Line} | ${r.v1 ? `L${r.v1}` : '（C1–C8 新增行，见第三表）'} | ${r.tag} | ${r.text.trim().replace(/\|/g, '\\|')} |`).join('\n') || '| — | — | — | — |'}
`;
    fs.writeFileSync(OUT_MD, md);
    console.log(`wrote ${path.relative(ROOT, OUT_MD)}`);
  }
  if (untraced > 0) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
