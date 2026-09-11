// src/lib/verbatim-guard-pairs.ts
// F01 (batch 2, 2026-09-11): the numbers check works on (subject, count) PAIRS
// instead of bare count tokens. Two loopholes of the token-set check, both
// reproduced by the audit:
//   - source 「《往生咒》每天49遍」 grounded a draft's 「《礼佛大忏悔文》49遍」
//     (the number was never bound to the sutra it belonged to);
//   - a visitor asking 「可以念999遍吗」 grounded a draft that ADVISED 999遍
//     (echoing a visitor's number ≠ recommending it).
// And with the 玄艺综述 case corpus (batch 2 §2) every 「念了120多张」 is a
// 个案 number: it may be narrated (「台长曾对一位同修说…」) but never advised.
//
// Pure helpers used by verbatim-guard.ts. Tokenization (Arabic + Chinese
// numerals, ranges, 張→张) is unchanged and lives in extractNumberTokens.

export type NumberPair = {
  /** Canonical subject key (大悲咒 / 心经 / 礼佛 / 小房子 / 《X》 → X), or null when bare. */
  subject: string | null;
  /** 'N遍' | 'N张' — same form as extractNumberTokens. */
  token: string;
};

// The mood of the sentence a count sits in. Decides what may ground it:
//   quote   — refers to the visitor's own words/practice → the visitor's
//             numbers are legitimate ground (「你念的21遍是可以的」)
//   narrate — recounts a case (「台长曾对一位同修说念了200张」) → case-source
//             numbers are legitimate ground
//   advise  — a recommendation (「建议每天念…」) → only general sources ground it
//   plain   — none of the above (status quo: any source or the visitor)
export type SentenceMood = 'quote' | 'narrate' | 'advise' | 'plain';

const CN_NUM_CLASS = '[零〇一二两三四五六七八九十百]';

// Sutra / subject aliases → canonical key. Order matters only for overlap
// (大悲心陀罗尼 before 陀罗尼-generic); matching is on the whitespace-stripped
// NFKC form. 张 always binds to 小房子 (the unit implies the subject).
const SUBJECT_ALIASES: [RegExp, string][] = [
  [/千手千眼无碍大悲心陀罗尼|大悲咒/g, '大悲咒'],
  [/般若波罗蜜多心经|心经/g, '心经'],
  [/礼佛大忏悔文|礼佛/g, '礼佛'],
  [/往生净土神咒|往生咒/g, '往生咒'],
  [/解结咒/g, '解结咒'],
  [/准提神咒|准提咒/g, '准提神咒'],
  [/消灾吉祥神咒|消灾吉祥咒/g, '消灾吉祥神咒'],
  [/七佛灭罪真言/g, '七佛灭罪真言'],
  [/功德宝山神咒/g, '功德宝山神咒'],
  [/观音灵感真言/g, '观音灵感真言'],
  [/圣无量寿决定光明王陀罗尼/g, '圣无量寿决定光明王陀罗尼'],
  [/大吉祥天女咒/g, '大吉祥天女咒'],
  [/如意宝轮王陀罗尼/g, '如意宝轮王陀罗尼'],
  [/小房子|自存小房子|经文组合/g, '小房子'],
];

function normalize(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').replace(/張/g, '张');
}

type Mention = { key: string; start: number; end: number };

// Every subject mention in a normalized sentence, with positions. A generic
// 《…》 title that is not a known alias becomes its own key so 《消灾吉祥神咒》
// vs 《大悲咒》 stay distinct even for sutras not in the alias table.
function subjectMentions(norm: string): Mention[] {
  const out: Mention[] = [];
  for (const [re, key] of SUBJECT_ALIASES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm)) !== null) out.push({ key, start: m.index, end: m.index + m[0].length });
  }
  const bracket = /《([^》]{1,30})》/g;
  let b: RegExpExecArray | null;
  while ((b = bracket.exec(norm)) !== null) {
    const inner = b[1];
    const covered = out.some((x) => x.start >= b!.index && x.end <= b!.index + b![0].length);
    if (!covered) out.push({ key: inner, start: b.index, end: b.index + b[0].length });
  }
  return out.sort((a, c) => a.start - c.start);
}

type TokenAt = { token: string; start: number; end: number; unit: '遍' | '张' };

function cnToInt(s: string): number {
  const D: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0;
  let num = 0;
  for (const ch of s) {
    if (ch === '百') { total += (num || 1) * 100; num = 0; }
    else if (ch === '十') { total += (num || 1) * 10; num = 0; }
    else if (ch in D) num = D[ch];
  }
  return total + num;
}

function tokensAt(norm: string): TokenAt[] {
  const out: TokenAt[] = [];
  const re = /(\d+)(?:[-–—~～至到](\d+))?(遍|张)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const unit = m[3] as '遍' | '张';
    out.push({ token: m[1] + unit, start: m.index, end: m.index + m[0].length, unit });
    if (m[2]) out.push({ token: m[2] + unit, start: m.index, end: m.index + m[0].length, unit });
  }
  const reCn = new RegExp(`(${CN_NUM_CLASS}+)(?:[-–—~～至到](${CN_NUM_CLASS}+))?(遍|张)`, 'g');
  while ((m = reCn.exec(norm)) !== null) {
    const unit = m[3] as '遍' | '张';
    out.push({ token: cnToInt(m[1]) + unit, start: m.index, end: m.index + m[0].length, unit });
    if (m[2]) out.push({ token: cnToInt(m[2]) + unit, start: m.index, end: m.index + m[0].length, unit });
  }
  return out.sort((a, c) => a.start - c.start);
}

function splitSentences(line: string): string[] {
  return line.split(/(?<=[。！？!?；;])/).filter((s) => s.trim() !== '');
}

/**
 * (subject, count) pairs for a text. Subject binding, per count token:
 *   1. nearest subject mention in the SAME sentence (before or after — the
 *      corpus writes both 「《大悲咒》7遍」 and 「三遍《心经》」; ties → before);
 *   2. otherwise the last subject mentioned earlier in the same BLOCK
 *      (consecutive non-blank lines: 「《礼佛大忏悔文》的遍数：\n- 平时：21遍」);
 *   3. otherwise bare (subject null).
 * 张 tokens always bind to 小房子.
 */
export function extractNumberPairs(text: string): NumberPair[] {
  return extractNumberPairsByLine(text).map(({ subject, token }) => ({ subject, token }));
}

export type LocatedPair = NumberPair & {
  /** 0-based index into text.split('\n') */
  line: number;
  /** The sentence (as produced by guardSentences) the count sits in. */
  sentence: string;
  /** Mood of that sentence, with block context (see sentenceMood). */
  mood: SentenceMood;
};

/** Same as extractNumberPairs, with the line / sentence / mood of every pair. */
export function extractNumberPairsByLine(text: string): LocatedPair[] {
  const out: LocatedPair[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    let end = i;
    while (end < lines.length && lines[end].trim() !== '') end++;
    // One block: consecutive non-blank lines.
    let lastSubject: string | null = null;
    let blockQuote = false;
    let blockNarrate = false;
    for (let li = i; li < end; li++) {
      for (const sentence of splitSentences(lines[li])) {
        const norm = normalize(sentence);
        const own = ownMood(norm);
        // Block context: a narration / quotation lead-in governs the sentences
        // that follow it in the same block (「台长曾对一位同修开示：\n- 念200张」),
        // unless the sentence itself is an explicit 建议.
        let mood: SentenceMood = own;
        if (own === 'plain' || own === 'advise') {
          if (blockNarrate && !/建议/.test(norm)) mood = 'narrate';
          else if (blockQuote && own === 'plain') mood = 'quote';
        }
        if (own === 'quote') blockQuote = true;
        if (own === 'narrate') blockNarrate = true;
        const mentions = subjectMentions(norm);
        const sutraMentions = mentions.filter((m) => m.key !== '小房子'); // 遍 never binds to 小房子
        const toks = tokensAt(norm);
        // Orientation of the sentence: 「《大悲咒》7遍、《心经》7遍」 (subject first →
        // bind to the nearest subject BEFORE each count) vs 「三遍《大悲咒》，三遍
        // 《心经》」 (count first → nearest subject AFTER). Decided by whichever
        // comes first in the sentence; falls back to the other direction when
        // nothing lies on the preferred side.
        // Orientation is chosen for the whole sentence by total character gap:
        // Σ gap(count → nearest subject before) vs Σ gap(count → nearest
        // subject after). A chunk that starts mid-bracket (「大悲咒》，三遍《心经》，
        // 一遍礼佛…」) still binds count-first correctly because the after-gaps
        // (1, 0, 1) beat the before-gaps (2, 2, 1). A count with no subject on
        // the chosen side falls back to the other side.
        const NONE = 1000;
        const bindings = toks
          .filter((t) => t.unit === '遍')
          .map((t) => {
            const before = sutraMentions.filter((m) => m.end <= t.start).pop() ?? null;
            const after = sutraMentions.find((m) => m.start >= t.end) ?? null;
            const inside = sutraMentions.find((m) => m.start < t.end && m.end > t.start) ?? null;
            return { t, before, after, inside, gapBefore: before ? t.start - before.end : NONE, gapAfter: after ? after.start - t.end : NONE };
          });
        const sumBefore = bindings.reduce((a, b) => a + b.gapBefore, 0);
        const sumAfter = bindings.reduce((a, b) => a + b.gapAfter, 0);
        const subjectFirst = sumBefore <= sumAfter;
        for (const t of toks) {
          if (t.unit === '张') {
            out.push({ subject: '小房子', token: t.token, line: li, sentence, mood });
            continue;
          }
          const b = bindings.find((x) => x.t === t)!;
          const best = b.inside ?? (subjectFirst ? b.before ?? b.after : b.after ?? b.before);
          out.push({ subject: best ? best.key : lastSubject, token: t.token, line: li, sentence, mood });
        }
        const lastMention = mentions.filter((m) => m.key !== '小房子').pop();
        if (lastMention) lastSubject = lastMention.key;
      }
    }
    i = end;
  }
  return out;
}

function ownMood(norm: string): SentenceMood {
  if (QUOTE_RE.test(norm)) return 'quote';
  if (NARRATE_RE.test(norm)) return 'narrate';
  if (ADVISE_RE.test(norm)) return 'advise';
  return 'plain';
}

export const pairKey = (p: NumberPair): string => `${p.subject ?? ''}|${p.token}`;

const QUOTE_RE = /[你您](现在|目前|一直|已经|之前|平时)?(念的|说的|提到|提的|问的|念了|在念|说过|说了|写的|讲的)|[你您](现在|目前)每天/;
const NARRATE_RE = /台长(曾|当年|以前|过去|那时)|台长[^。！？!?]{0,6}(对|给|叫|让|跟|回答)(一位|那位|某位|一个|有位|这位)|(一位|那位|某位|有位|有个|这位)(同修|听众|师兄|佛友|听友|来信者)|案例(中|里)|对类似情况|个案|那位同修/;
const ADVISE_RE = /建议|可以(先|再|多)?念|每天(念|各念|至少|最多|\s*[\d零〇一二两三四五六七八九十]+\s*(遍|张))|要念|先念|开始念|念\s*[《\d零〇一二两三四五六七八九十]|念到|加到|至少念|不超过|最多念|给[^。！？!?]{0,6}念|需要念|应该念|可以(给|为)[^。！？!?]{0,8}念/;

/** Mood of ONE sentence on its own (no block context). Quote markers win over advice markers. */
export function sentenceMood(sentence: string): SentenceMood {
  return ownMood(normalize(sentence));
}

/** Sentences of a line (exported for the stripper). */
export function guardSentences(line: string): string[] {
  return splitSentences(line);
}
