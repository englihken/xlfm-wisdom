// src/lib/prompt/level-cues.ts — visitor practice level from the visitor's own
// words (brief 2026-09-13-fellow-practitioner-mode §一 + addendum 方案 1).
//
// Pure and synchronous: runs BEFORE retrieval on every turn (zero latency),
// over ALL visitor turns of the conversation, and returns the highest level
// any turn signals. The post-reply Haiku classifier and the volunteer-set
// contacts.stage can only raise it (see care-pipeline decideTurnLevel /
// levelUpdateFor). When unsure, the cue list errs high — treating an old
// practitioner as a beginner hurts more than the reverse.
//
// One exception to "highest wins": a visitor who says in their own words that
// they have not started (「还没」「没念过」「刚开始」) is a beginner even when the
// topic alone (小房子, 几遍) would suggest practising — that is the 小房子
// learner of 2026-09-13-xiaofangzi-entry, who must get the three-pillar 入门轮.
// It never lowers an experienced signal.

export type VisitorLevel = 'new' | 'beginner' | 'practising' | 'experienced';

export const LEVEL_ORDER: readonly VisitorLevel[] = ['new', 'beginner', 'practising', 'experienced'];

export function isVisitorLevel(x: unknown): x is VisitorLevel {
  return typeof x === 'string' && (LEVEL_ORDER as readonly string[]).includes(x);
}

/** The highest of the given levels; `new` when none is set. */
export function maxLevel(...levels: (VisitorLevel | null | undefined)[]): VisitorLevel {
  let best = 0;
  for (const l of levels) if (l) best = Math.max(best, LEVEL_ORDER.indexOf(l));
  return LEVEL_ORDER[best];
}

type Cue = { name: string; re: RegExp };
const kw = (...words: string[]): Cue[] => words.map((w) => ({ name: w, re: new RegExp(w) }));

// ── experienced ─────────────────────────────────────────────────────────────
export const EXPERIENCED_CUES: Cue[] = [
  ...kw('清修', '境界', '开悟', '光明心', '三界', '六道', '弘法', '弟子', '拜师', '莲花', '自存', '要经者', '7749', '369', '年事已高', '安老院', '老人院', '养老院'),
  { name: '度人', re: /(?<!超)度(了|过)?(一位|一个|几位|几个)?(女|男)?(佛友|同修|朋友|人)/ },
  { name: '本命年小房子', re: /本命年[^。，,！？]{0,6}小房子/ },
  { name: '结缘小房子', re: /结缘[^。，,！？]{0,4}小房子|烧送[^。，,！？]{0,6}结缘/ },
  { name: '佛台结缘／请下', re: /佛台[^。，,！？]{0,12}(结缘|请下|撤)|请下[^。，,！？]{0,4}(佛台|供台)/ },
  { name: '换像', re: /(菩萨|佛)像[^。，,！？]{0,6}换|换[^。，,！？]{0,4}(瓷像|佛像|菩萨像)/ },
  { name: '修了几年', re: /(学佛|修行|心灵法门|念经|修)[^。，,！？]{0,6}(好|几|多|[0-9]+|[一二三四五六七八九十两]+)\s*几?年/ },
  { name: '自己的功课遍数', re: /(我|自己)[^。，,！？]{0,4}每天[^。，,！？]{0,8}([0-9]{2,}|[二三四五六七八九]十)/ },
  { name: '许过的愿', re: /许(了|过)(愿|大愿)|发(了|过)(愿|大愿)|(已经|之前)[^。，,！？]{0,4}许了?愿|许愿(吃素|放生|清修)(了|过)/ },
  { name: '引师父话发问', re: /(师父|台长)(说|讲|开示|教)过?/ },
];

// ── practising ─────────────────────────────────────────────────────────────
export const PRACTISING_CUES: Cue[] = [
  { name: '在念功课', re: /(我|自己)[^。，,！？]{0,6}(每天|平时|一直|都有|有在|在)[^。，,！？]{0,4}(念|做)[^。，,！？]{0,4}(功课|经|小房子|大悲咒|心经|礼佛)/ },
  { name: '念了小房子', re: /念了[^。，,！？]{0,6}(张|遍)[^。，,！？]{0,4}小房子/ },
  { name: '有佛台', re: /有佛台|供(了|奉)?[^。，,！？]{0,2}(佛台|观世音菩萨)/ },
  { name: '问遍数张数', re: /几张|多少张|几遍|多少遍|各念多少/ },
  // 09-16: answering 「你现在念什么？」 with 「大悲咒21」「心经21」 is a whole turn
  // that says "I already have a 功课" — R22's visitor was judged `new` without it,
  // so no practising instruction reached the model and it wrote 📿 count lines.
  { name: '报自己的遍数', re: /(^|\n)(大悲咒|心经|礼佛大忏悔文|礼佛|往生咒|解结咒|准提神咒|消灾吉祥神咒|七佛灭罪真言|小房子)[^。，,！？\n]{0,4}\d{1,3}(遍|张)?($|\n)/ },
  ...kw('小房子'),
];

// ── beginner ───────────────────────────────────────────────────────────────
export const BEGINNER_CUES: Cue[] = [
  ...kw('刚开始', '刚接触', '初学', '新手', '不会念', '跟视频', '跟着视频', '零基础'),
  { name: '念了几天', re: /念了(一|两|几|[0-9]+)个?(星期|礼拜|天)/ },
];

// Own-words "not started yet" — caps a topic-only practising signal at beginner.
const BEGINNER_SELF_REPORT_RE =
  /没(有)?(念过|学过)|还没(有)?(开始)?(念|做)?(功课|经)?|从来没(有)?念|完全没|刚开始|零基础|不会念/;

// ── needs_care ─────────────────────────────────────────────────────────────
export const NEEDS_CARE_CUES: Cue[] = [
  ...kw('年事已高', '安老院', '老人院', '养老院', '身体不好', '孤单', '孤独', '独居', '一个人住', '行动不便', '卧床'),
  { name: '家人不修', re: /家人[^。，,！？]{0,4}(没有|不)(修行|修|学佛|信)/ },
];

const hitsOf = (cues: Cue[], text: string) => cues.filter((c) => c.re.test(text)).map((c) => c.name);

/** Level signalled by the visitor turns (highest wins, with the self-report cap). */
export function levelFromCues(visitorTurns: string[]): { level: VisitorLevel; hits: string[] } {
  const text = visitorTurns.map((t) => t.replace(/\s+/g, '')).join('\n');
  const exp = hitsOf(EXPERIENCED_CUES, text);
  const beg = hitsOf(BEGINNER_CUES, text);
  const selfReport = visitorTurns.some((t) => BEGINNER_SELF_REPORT_RE.test(t.replace(/\s+/g, '')));
  // 09-16 architect answer A1: a visitor who says in their own words that they
  // have not started IS a beginner — the jargon in their question (清修, 要经者,
  // 小房子…) must never lift them to 同修. The cap is beginner, not practising.
  if (selfReport) {
    return {
      level: 'beginner',
      hits: [...beg.map((h) => `beginner:${h}`), 'beginner:自述没开始', ...exp.map((h) => `capped-experienced:${h}`)],
    };
  }
  if (exp.length > 0) return { level: 'experienced', hits: exp.map((h) => `experienced:${h}`) };
  const pra = hitsOf(PRACTISING_CUES, text);
  if (pra.length > 0) return { level: 'practising', hits: pra.map((h) => `practising:${h}`) };
  if (beg.length > 0) return { level: 'beginner', hits: beg.map((h) => `beginner:${h}`) };
  return { level: 'new', hits: [] };
}

export function needsCareFromCues(visitorTurns: string[]): { needsCare: boolean; hits: string[] } {
  const text = visitorTurns.map((t) => t.replace(/\s+/g, '')).join('\n');
  const hits = hitsOf(NEEDS_CARE_CUES, text);
  return { needsCare: hits.length > 0, hits: hits.map((h) => `care:${h}`) };
}

/**
 * contacts.stage (volunteer-set) → level. Canonical keys (outreach.ts
 * MILESTONES) plus the legacy Chinese values still on older rows. 同修／义工 are
 * experienced; 新佛友 sets nothing (it cannot raise a level).
 */
export function stageToLevel(stage: string | null | undefined): VisitorLevel | null {
  switch (stage) {
    case 'steady_practice':
    case 'volunteer':
    case '同修':
    case '义工':
    case '共修者':
      return 'experienced';
    case 'started_chanting':
    case '新同修':
    case '学习中':
      return 'practising';
    case 'attended':
    case '佛友':
      return 'beginner';
    default:
      return null;
  }
}
