// src/lib/verbatim-guard.ts
// Mechanical anti-fabrication guard for 智慧问答 replies.
//
// Why prompt rules were not enough: production convs 29cfd74c (2026-08-08) and
// 6b6f74ff (2026-06-29) served invented doctrine ("初一十五一天不超过13遍"
// presented as a 台长 quote) reconstructed from stray context. This module
// checks a DRAFT reply against the actual retrieved passages before anything
// is sent:
//
//   QUOTE CHECK   — every blockquote (>) line must be a verbatim substring of
//                   the retrieved chunk texts (normalized). Visitor messages
//                   do NOT count as quote sources.
//   NUMBERS CHECK — every Arabic-digit N遍/N张 token in the draft must appear
//                   in ANY retrieved chunk (books, 组织审定, letters, wenda,
//                   case studies) OR the visitor's own messages (echoing the
//                   visitor's "11遍" stays legal). Chinese-numeral dates
//                   (二月十九…) are out of scope by construction: only Arabic
//                   digits are tokenized.
//   组织审定 WINS — when a canonical_ruling chunk is retrieved, a sentence on
//                   the canonical doc's own subject (礼佛大忏悔文 counts,
//                   special-day 小房子 counts — see CANONICAL_SCOPE_KEYWORDS)
//                   may only carry numbers that the canonical chunk (or the
//                   visitor) states. Ordinary-book numbers on OTHER subjects
//                   (心经 7遍, 往生咒 49遍 for 失眠 …) stay legitimate.
//
// 08-29 regression (brief 🔴 功课遍数): the 08-09 guard shipped stricter than
// briefed — with any canonical chunk present, EVERY prose number had to come
// from the canonical doc, so 疾病百科 / 心灵法门例说 / 白话佛法 numbers were
// stripped; and the retry instruction told the model to drop all non-canonical
// numbers even after a quote-only trip. Refusal phrases went 0% → 13-17% of
// assistant messages, with every 失眠 answer losing its 遍数. The scoped rule
// above is the fix; the quote check is unchanged.
//
// F01 (batch 2, 2026-09-11): the NUMBERS CHECK now works on (subject, count)
// PAIRS with a sentence mood — see verbatim-guard-pairs.ts. A draft's
// 「《礼佛大忏悔文》49遍」 is grounded only by a source pairing 礼佛 with 49遍
// (or a bare source 49遍), never by 「《往生咒》49遍」; a visitor's number may
// be quoted back but not turned into advice; a case source's number may only
// be narrated. Bare draft numbers (no subject anywhere in the block) keep
// the old token rule.
//
// Pure functions only — the pipeline (care-pipeline.ts) owns the
// regenerate-once / strip / log flow.

import {
  extractNumberPairsByLine,
  pairKey,
  type NumberPair,
} from './verbatim-guard-pairs';

export type GuardViolationReason =
  // A blockquote segment is not a verbatim substring of any retrieved chunk.
  | 'quote_not_verbatim'
  // (subject, N遍/N张) appears in no retrieved chunk and not in the visitor's words.
  | 'number_not_in_sources'
  // N遍/N张 sits in a sentence on the 组织审定 subject but only an ordinary
  // (non-canonical) chunk carries it — 组织审定 wins on its own subject.
  | 'number_canonical_conflict'
  // F01: the count exists only in the VISITOR's words, and the sentence
  // recommends it (「建议每天念999遍」) instead of quoting them back.
  | 'number_visitor_as_advice'
  // F01: the count exists only in a CASE source (玄艺综述/玄艺问答 个案) and
  // the sentence is not narrating that case (「你可以念200张」).
  | 'number_case_generalized';

export type GuardViolation = {
  type: 'quote' | 'number';
  text: string;
  reason: GuardViolationReason;
  // F01: the subject the count was bound to (大悲咒 / 礼佛 / 小房子 …), null
  // when bare. Stripping and the retry instruction are scoped by it.
  subject?: string | null;
};

// ── Normalization ────────────────────────────────────────────────────────────

// Full normalization for quote matching: NFKC (full→half width digits/latin),
// then drop ALL whitespace, punctuation, and symbols on BOTH sides. The PDF
// corpus is full of stray spaces ("观世音菩萨成道 日 — 49  遍") and the model
// varies punctuation width — comparing only the CJK/word/digit skeleton makes
// verbatim matching robust to both.
export function normalizeForGuard(s: string): string {
  return s.normalize('NFKC').replace(/[\p{P}\p{S}\p{Z}\s]/gu, '');
}

// Light normalization for number tokenization: unify digit width, drop
// whitespace, KEEP punctuation so ranges like 21-49遍 stay detectable.
// Traditional 張 folds to 张 so Traditional-script replies (production conv
// b119360e wrote 7-21張) neither bypass the check nor lose their counts.
function normalizeForNumbers(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').replace(/張/g, '张');
}

// ── Number tokens ────────────────────────────────────────────────────────────

// Chinese numerals (一…九十九, 一百零八) → integer. The 入门手册 chunks write
// 「三遍《心经》」「二十一遍《往生咒》」「一遍至七遍」; without this the book
// could never ground a reply's 3遍/21遍 and the beginner's 功课 was stripped
// (入门锚定 brief). Applied SYMMETRICALLY — drafts and ground truth — so it
// is not a relaxation: a draft's 「三遍」 is now checked where it was invisible.
const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
function cnNumeralToInt(s: string): number {
  let total = 0;
  let num = 0;
  for (const ch of s) {
    if (ch === '百') {
      total += (num || 1) * 100;
      num = 0;
    } else if (ch === '十') {
      total += (num || 1) * 10;
      num = 0;
    } else if (ch in CN_DIGIT) {
      num = CN_DIGIT[ch];
    }
  }
  return total + num;
}
const CN_NUM = '[零〇一二两三四五六七八九十百]+';

// Extract N遍 / N张 tokens. A range ("21-49遍", "21至49遍", "一遍至七遍") yields
// BOTH bounds as tokens, on drafts and ground truth alike, so range phrasing
// on either side still matches. Arabic and Chinese numerals both tokenize to
// the Arabic form ("三遍" → "3遍").
export function extractNumberTokens(s: string): string[] {
  const t = normalizeForNumbers(s);
  const out: string[] = [];
  const re = /(\d+)(?:[-–—~～至到](\d+))?(遍|张)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    out.push(m[1] + m[3]);
    if (m[2]) out.push(m[2] + m[3]);
  }
  const reCn = new RegExp(`(${CN_NUM})(?:[-–—~～至到](${CN_NUM}))?(遍|张)`, 'g');
  while ((m = reCn.exec(t)) !== null) {
    out.push(cnNumeralToInt(m[1]) + m[3]);
    if (m[2]) out.push(cnNumeralToInt(m[2]) + m[3]);
  }
  return out;
}

// Sentence split shared by the stripper and the scrub: within a line, at
// terminal punctuation. A sentence is the unit that stripping removes.
function splitSentences(line: string): string[] {
  return line.split(/(?<=[。！？!?；;])/);
}

// ── 组织审定 subject scope ───────────────────────────────────────────────────
// The canonical doc in production is 「礼佛大忏悔文特殊日子遍数表」: 礼佛 counts
// (功课 caps, special days, children, pregnancy, 自修经文) and the special-day
// 小房子 caps. A PARAGRAPH (line) mentioning any of these is "on the canonical
// subject"; every number in it must then come from 组织审定. The unit is the
// line, not the sentence, so 「按组织审定21遍。旧版写的是13遍。」 cannot smuggle
// the 13遍 into a keyword-free second sentence (the 29cfd74c shape). Plain
// 小房子 / 心经 / 大悲咒 / 往生咒 counts in their own paragraphs are NOT in
// scope — books and 问答 ground those. Keep in sync with the
// canonical_ritual_numbers topic keywords in vector-search.ts (minus the
// generic 遍数/几遍/张数 words).
//
// False-positive guard (review 08-29): bare 初一 (Malaysia: Form 1, 「孩子读
// 初一」), 圣诞 (Christmas), 十五 (十五岁/十五分钟) and 孕妇 (any pregnancy
// question) each marked an ordinary paragraph as canonical-subject and stripped
// its book-grounded 遍数 — the same bug in a new coat. So: day words are the
// COMPOUNDS only, and a paragraph counts as canonical-subject only when it
// ALSO names one of the doc's two actual subjects (CANONICAL_SUBJECT_ANCHORS:
// 礼佛 / 忏悔 / 小房子 / N张). 礼佛 is both trigger and anchor — a paragraph
// about 礼佛大忏悔文 counts is the doc's subject on its own.
export const CANONICAL_SCOPE_KEYWORDS = [
  '礼佛',
  '初一十五', '初一、十五', '初一和十五', '大年初一', '正月初一', '年初一',
  '菩萨圣诞', '佛诞', '圣诞日', '诞辰', '成道日', '出家日', '涅槃日',
  '年三十', '除夕', '元旦', '元宵', '中秋',
  '中元', '清明', '冬至', '重阳', '端午', '春节',
  '孕妇', '坐月子', '自修经文', '自存',
];

// The canonical doc's subjects: 礼佛大忏悔文 counts and 小房子 counts. One of
// these must co-occur with a trigger word for the strict rule to apply.
const CANONICAL_SUBJECT_ANCHORS = /礼佛|忏悔|小房子|\d+张/;

function hasCanonicalTrigger(line: string): boolean {
  const s = normalizeForNumbers(line);
  return CANONICAL_SCOPE_KEYWORDS.some((kw) => s.includes(kw));
}

// Per-line canonical-subject flags for a draft. The ANCHOR is judged per
// BLOCK (consecutive non-blank lines — a block ends at a blank line), so a
// bulleted 遍数 list inherits the 礼佛 anchor from the sentence introducing
// it (「《礼佛大忏悔文》的遍数：\n- 平时初一、十五：13遍」); the TRIGGER is
// judged per line, so a list item about 心经 inside that block is not
// swept up. Used identically by checkDraft and stripViolations.
export function canonicalSubjectFlags(draft: string): boolean[] {
  const lines = draft.split('\n');
  const flags: boolean[] = new Array(lines.length).fill(false);
  let start = 0;
  while (start < lines.length) {
    if (lines[start].trim() === '') {
      start++;
      continue;
    }
    let end = start;
    while (end < lines.length && lines[end].trim() !== '') end++;
    const block = normalizeForNumbers(lines.slice(start, end).join('\n'));
    if (CANONICAL_SUBJECT_ANCHORS.test(block)) {
      for (let i = start; i < end; i++) flags[i] = hasCanonicalTrigger(lines[i]);
    }
    start = end;
  }
  return flags;
}

// ── The check ────────────────────────────────────────────────────────────────
// Blockquote lines are checked segment-by-segment: an elided quote ("A……B") is
// split at the ellipsis and each segment must independently be verbatim.

// 09-13 xfz-retrieval-and-prayer-guard §2.2: a 祈求词 line is not a quotation
// of a passage — its content is personal (名字、部位、对象), so it can never be
// verbatim. A quote-block line that starts like a prayer is exempt from the
// verbatim check; instead its OPENER must be one of the approved openers (the
// pinned 功课卡, 《念诵指南》 p17／p31 for 小房子, the 放生 wording in the prompt).
// A prayer-looking line with any other opener (「祈请大慈大悲观音菩萨…」) falls
// back to the ordinary verbatim rule.
export const APPROVED_PRAYER_OPENERS = [
  '祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨', // 功课卡
  '祈请南无大慈大悲观世音菩萨', // 《念诵指南》 p31 烧送前
  '请大慈大悲观世音菩萨', // 《念诵指南》 p17 念诵前
  '请大慈大悲的观世音菩萨', // 放生（《佛学问答》63）
] as const;
const PRAYER_TRIGGER_RE = /^(\*\*)?\s*["“「]?\s*(祈请南无|请大慈大悲|念前祈请|祈求\s*[：:])/;
const PRAYER_LEAD_RE = /^(\*\*)?\s*(念前祈请|念之前祈求|念前祈求|念之前说|念前说|祈求)?\s*[：:]?\s*(\*\*)?\s*["“「]?/;
export function isApprovedPrayerLine(quoted: string): boolean {
  const s = quoted.trim();
  if (!PRAYER_TRIGGER_RE.test(s)) return false;
  const body = s.replace(PRAYER_LEAD_RE, '').replace(/\s+/g, '');
  return APPROVED_PRAYER_OPENERS.some((o) => body.startsWith(o));
}

// Segments whose normalized skeleton is shorter than this are ignored — too
// short to be a doctrinal claim, too likely to false-positive ("师父说：").
const MIN_QUOTE_SKELETON = 8;

export function checkDraft(
  draft: string,
  chunkTexts: string[],
  visitorTexts: string[],
  opts: {
    // 组织审定 chunk texts among the retrieved set. When present, prose
    // numbers in sentences ON THE CANONICAL SUBJECT must come from these
    // chunks (or the visitor); numbers that only exist in ordinary book
    // chunks are rejected there. This closes the 29cfd74c loophole where
    // "13遍" from a 听众's question inside a 锦集 chunk was technically "in
    // the retrieved text" and got re-presented as 初一十五 doctrine — while
    // leaving 疾病百科 / 例说 numbers on other subjects legitimate (08-29).
    canonicalTexts?: string[];
    // F01: chunk texts that are CASE records (type='case_qa' — 玄艺综述 /
    // 玄艺问答 个案). Their counts ground a draft sentence only when it
    // narrates the case; advising them is 个案→通则 and is rejected.
    caseTexts?: string[];
  } = {}
): GuardViolation[] {
  const violations: GuardViolation[] = [];

  const chunksNormalized = normalizeForGuard(chunkTexts.join('\n'));

  // QUOTE CHECK — retrieved chunks only. Track which quote LINES verified so
  // the numbers check can exempt them (a verbatim quote's numbers are, by
  // definition, the source's own numbers).
  const verifiedQuoteLines = new Set<string>();
  for (const line of draft.split('\n')) {
    const m = line.match(/^\s*>\s?(.*)$/);
    if (!m) continue;
    // A 祈求词 is not a quotation: only its opener is checked (see above).
    if (isApprovedPrayerLine(m[1])) {
      verifiedQuoteLines.add(line);
      continue;
    }
    let lineOk = true;
    for (const seg of m[1].split(/…+|\.{3,}|⋯+/)) {
      const skeleton = normalizeForGuard(seg);
      if (skeleton.length < MIN_QUOTE_SKELETON) continue;
      if (!chunksNormalized.includes(skeleton)) {
        violations.push({ type: 'quote', text: seg.trim(), reason: 'quote_not_verbatim' });
        lineOk = false;
      }
    }
    if (lineOk) verifiedQuoteLines.add(line);
  }

  // NUMBERS CHECK — prose only (verified verbatim quotes are exempt).
  const allLines = draft.split('\n');
  const subjectFlags = canonicalSubjectFlags(draft);

  // Ground truth (F01) as (subject, count) pairs, split by source class:
  //   general — every retrieved chunk that is NOT a case record
  //   case    — 玄艺综述 / 玄艺问答 records (opts.caseTexts)
  //   visitor — the visitor's own words
  // A draft pair (S, N) is grounded by a source pair (S, N) or by a BARE
  // source N (the source stated N with no subject nearby — bare numbers keep
  // the permissive token rule). A bare draft N is grounded by any source N.
  // Chunks are joined with a blank line so subject context never bleeds
  // from one chunk into the next.
  const caseSet = new Set(opts.caseTexts ?? []);
  const generalTexts = chunkTexts.filter((t) => !caseSet.has(t));
  const caseTexts = chunkTexts.filter((t) => caseSet.has(t));
  const ground = (texts: string[]) => {
    const pairs = new Set<string>();
    const tokens = new Set<string>();
    for (const p of extractNumberPairsByLine(texts.join('\n\n'))) {
      pairs.add(pairKey(p));
      tokens.add(p.token);
    }
    return {
      has: (p: NumberPair) =>
        pairs.has(pairKey(p)) ||
        (p.subject ? pairs.has(pairKey({ subject: null, token: p.token })) : tokens.has(p.token)),
    };
  };
  const general = ground(generalTexts);
  const cases = ground(caseTexts);
  const visitorTokens = new Set(extractNumberTokens(visitorTexts.join('\n')));
  const canonicalTexts = opts.canonicalTexts ?? [];
  const canonicalTokens = new Set([
    ...extractNumberTokens(canonicalTexts.join('\n')),
    ...visitorTokens,
  ]);
  const canonicalPresent = canonicalTexts.length > 0;
  // The 组织审定 rule stays token-level on the canonical subject (unchanged).
  const allTokens = new Set([...extractNumberTokens(chunkTexts.join('\n')), ...visitorTokens]);

  const seen = new Set<string>();
  const push = (p: NumberPair, reason: GuardViolationReason, strict: boolean) => {
    const key = `${strict ? 'c' : 'a'}:${reason}:${pairKey(p)}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ type: 'number', text: p.token, reason, subject: p.subject });
  };
  for (const p of extractNumberPairsByLine(draft)) {
    const line = allLines[p.line];
    if (verifiedQuoteLines.has(line)) continue;
    const strict = canonicalPresent && subjectFlags[p.line];
    // 组织审定 wins on its own subject — checked first, as before.
    if (strict && allTokens.has(p.token) && !canonicalTokens.has(p.token)) {
      push(p, 'number_canonical_conflict', true);
      continue;
    }
    if (general.has(p)) continue;
    if (cases.has(p)) {
      // 个案 ≠ 通则: only narration may carry a case source's number.
      if (p.mood === 'narrate') continue;
      push(p, 'number_case_generalized', false);
      continue;
    }
    if (visitorTokens.has(p.token)) {
      // The visitor said it: quoting it back is fine; advising it is not.
      if (p.mood === 'advise') push(p, 'number_visitor_as_advice', false);
      continue;
    }
    push(p, 'number_not_in_sources', false);
  }

  return violations;
}

// ── Stripping (last resort after the one retry) ──────────────────────────────

// Remove offending quote lines and any sentence carrying an unverified number
// token. The caller decides the tail (see chooseGuardTail). If stripping guts
// the reply, the caller should fall back to a full safe answer instead —
// signalled by an empty-ish return (see care-pipeline).
//
// A number violation is scoped the way it was found: 'number_not_in_sources'
// removes every sentence carrying the token; 'number_canonical_conflict'
// removes only sentences in paragraphs ON the canonical subject that carry it
// (the same token may legitimately appear in a 心经 paragraph next door).
export function stripViolations(draft: string, violations: GuardViolation[]): string {
  const badQuoteSkeletons = new Set(
    violations.filter((v) => v.type === 'quote').map((v) => normalizeForGuard(v.text))
  );
  // F01: pair-scoped. A violated (subject, token) removes only sentences that
  // bind that token to that subject; a bare violation (no subject) removes
  // every sentence carrying the token, as before.
  const badPairs = new Set(
    violations
      .filter((v) => v.type === 'number' && v.reason !== 'number_canonical_conflict' && v.subject)
      .map((v) => pairKey({ subject: v.subject!, token: v.text }))
  );
  const badEverywhere = new Set(
    violations
      .filter((v) => v.type === 'number' && v.reason !== 'number_canonical_conflict' && !v.subject)
      .map((v) => v.text)
  );
  const badOnCanonical = new Set(
    violations.filter((v) => v.reason === 'number_canonical_conflict').map((v) => v.text)
  );
  // Pairs per (line, sentence) with block context, computed once for the draft.
  const located = extractNumberPairsByLine(draft);
  const pairsOf = (lineIdx: number, sentence: string): NumberPair[] =>
    located.filter((p) => p.line === lineIdx && p.sentence === sentence);
  const sentenceIsBad = (s: string, lineIdx: number, lineOnSubject: boolean): boolean => {
    const tokens = extractNumberTokens(s);
    if (tokens.some((t) => badEverywhere.has(t))) return true;
    if (pairsOf(lineIdx, s).some((p) => badPairs.has(pairKey(p)))) return true;
    return lineOnSubject && tokens.some((t) => badOnCanonical.has(t));
  };

  const keptLines: string[] = [];
  const lines = draft.split('\n');
  const subjectFlags = canonicalSubjectFlags(draft);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      const skeleton = normalizeForGuard(quoteMatch[1]);
      // Drop the whole quote line if any offending segment lives in it.
      const isBad = [...badQuoteSkeletons].some((bad) => bad && skeleton.includes(bad));
      if (isBad) {
        // Also drop an orphaned lead-in ("师父开示：") left dangling above the
        // removed quote — production 08-16 shipped one of these.
        let i = keptLines.length - 1;
        while (i >= 0 && keptLines[i].trim() === '') i--;
        if (i >= 0 && /[:：]\s*$/.test(keptLines[i].trim())) keptLines.length = i;
        continue;
      }
      keptLines.push(line);
      continue;
    }
    // Non-quote line: drop the sentences that carry an unverified number.
    const lineOnSubject = subjectFlags[i];
    const sentences = splitSentences(line);
    if (!sentences.some((s) => sentenceIsBad(s, i, lineOnSubject))) {
      keptLines.push(line);
      continue;
    }
    // 09-12 strip-tails brief §B.1: a 功课 line (📿 …, or 《经名》 + a count)
    // keeps its sutra name; only the offending count is replaced with the
    // placeholder. Production d7897fd1 shipped three prayer lines whose
    // 「📿《往生咒》每天 21 遍」 lines had been deleted above them.
    if (isHomeworkLine(line)) {
      const badTokens = new Set<string>(badEverywhere);
      if (lineOnSubject) for (const t of badOnCanonical) badTokens.add(t);
      keptLines.push(replaceCountTokens(line, { badPairs, badTokens }));
      continue;
    }
    const kept = sentences.filter((s) => !sentenceIsBad(s, i, lineOnSubject));
    const rejoined = kept.join('').trim();
    if (rejoined) {
      keptLines.push(rejoined);
      continue;
    }
    // §B.2: the whole line went (a bare-count line such as 「每天念 21 遍。」).
    // Prayer lines that directly follow it would be orphans — drop them too.
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || isPrayerLine(lines[j]))) {
      if (lines[j].trim() !== '' && !isPrayerLine(lines[j])) break;
      j++;
    }
    // Only skip when at least one prayer line was actually found.
    if (lines.slice(i + 1, j).some((l) => isPrayerLine(l))) {
      // Leave trailing blank lines to the collapse below.
      while (j > i + 1 && lines[j - 1].trim() === '') j--;
      i = j - 1;
    }
  }

  // Collapse the blank-line runs that stripping leaves behind.
  return keptLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── 功课 line helpers (09-12 strip-tails brief §B) ───────────────────────────
/** Shown in place of a count the guard could not ground, keeping the sutra line. */
export const COUNT_PLACEHOLDER = '（遍数以官方资料为准）';
const HOMEWORK_LINE_RE = /^\s*(>\s*)?(\*\*)?📿/;
const SUTRA_TITLE_RE = /《[^》\n]{1,24}(经|咒|真言|陀罗尼|忏悔文)》/;
// The last alternative covers both prayer openers: the 功课卡's
// 「祈请南无大慈大悲救苦救难广大灵感观世音菩萨摩诃萨…」 (prompt default since
// 09-13) and the older 「请大慈大悲观世音菩萨…」.
const PRAYER_LINE_RE = /^\s*(>\s*)?(\*\*)?[（(]?\s*(念之前祈求|念前祈求|念前祈请|念之前说|念之前跟菩萨说|念之前先说|祈求词|祈求\s*[：:]|念前说|["“「]?(祈请南无大慈大悲救苦救难广大灵感观世音菩萨|请大慈大悲(的)?观世音菩萨))/;
/** A 功课 line: starts with 📿, or names a 《sutra》 and carries a 遍/张 count. */
export function isHomeworkLine(line: string): boolean {
  if (HOMEWORK_LINE_RE.test(line)) return true;
  return SUTRA_TITLE_RE.test(line) && extractNumberTokens(line).length > 0;
}
/** A 祈求词 line (the line under a 功课 line that carries the prayer). */
export function isPrayerLine(line: string): boolean {
  return PRAYER_LINE_RE.test(line);
}
// Replace the count spans on the line that carry a violated (subject, count)
// pair — or a violated bare token — with COUNT_PLACEHOLDER; grounded spans on
// the same line stay (「《大悲咒》每天7遍、《礼佛大忏悔文》每天7遍」 keeps the
// first 7遍). Spans are matched on the raw line with the same shape tokensAt
// uses (digits / Chinese numerals, enumerations, 或, ranges, one unit), so the
// k-th span's tokens are the k-th group of pairs extractNumberPairsByLine
// yields for the line — that is how each span learns its bound subject.
const NUM_RAW = '(?:\\d+|[０-９]+|[零〇一二两三四五六七八九十百]+)';
const COUNT_SPAN_RE = new RegExp(`${NUM_RAW}(?:\\s*[、，,/]\\s*${NUM_RAW})*(?:\\s*或\\s*${NUM_RAW})?(?:\\s*[-–—~～至到]\\s*${NUM_RAW})?\\s*(?:遍|张|張)`, 'g');
export function replaceCountTokens(line: string, opts: { badPairs: Set<string>; badTokens: Set<string> }): string {
  if (opts.badPairs.size === 0 && opts.badTokens.size === 0) return line;
  const pairs = extractNumberPairsByLine(line); // document order, one per number in each span
  let cursor = 0;
  return line
    .replace(COUNT_SPAN_RE, (span) => {
      const k = (span.match(new RegExp(NUM_RAW, 'g')) ?? []).length;
      const mine = pairs.slice(cursor, cursor + k);
      cursor += k;
      const bad = mine.some((p) => opts.badTokens.has(p.token) || opts.badPairs.has(pairKey(p)));
      return bad ? COUNT_PLACEHOLDER : span;
    })
    .replace(new RegExp(`\\s+${COUNT_PLACEHOLDER}`, 'g'), COUNT_PLACEHOLDER);
}

// ── Post-strip tail decision ─────────────────────────────────────────────────
// Production 08-16 shipped a fully-grounded 21遍 answer ending in the blanket
// 「查不到相关原文」 disclaimer: the offending content was a paraphrased QUOTE,
// every prose number survived stripping, yet the numbers-flavoured disclaimer
// was appended unconditionally. The tail must match what actually happened:
//   'none'    — only quotes were stripped; the surviving prose is fully
//               grounded, so no numbers disclaimer may be added.
//   'partial' — number sentences were stripped but grounded numbers remain;
//               a scoped note about the omitted items, never a blanket one.
//   'blanket' — number sentences were stripped and no counts remain.
export type GuardTail = 'none' | 'partial' | 'blanket';

export function chooseGuardTail(
  stripped: string,
  violations: GuardViolation[],
  opts: { level?: string | null } = {}
): GuardTail {
  if (!violations.some((v) => v.type === 'number')) return 'none';
  // 同修轮 (09-13): an experienced practitioner's reply should carry no counts
  // at all — a stripped number is the model over-reaching, not a figure the
  // visitor is missing, so no disclaimer of any kind is appended.
  if (opts.level === 'experienced') return 'none';
  // A reply that still names its sutras (counts replaced by the placeholder)
  // gets the scoped partial note, never the blanket 「查不到相关原文」 — the
  // placeholder already says exactly which figures to confirm (§B.3).
  if (extractNumberTokens(stripped).length > 0 || stripped.includes(COUNT_PLACEHOLDER)) return 'partial';
  return 'blanket';
}

// ── Contradiction scrub ──────────────────────────────────────────────────────
// The blanket 「查不到相关原文／不敢乱给数字」 sentence is the honest answer
// when NO figure is grounded. Next to grounded counts it contradicts them —
// production 08-19→08-29 shipped 「通用的遍数我目前查不到相关原文，不敢乱给你
// 数字」 written by the model itself (the retry instruction had told it to),
// and 08-16 shipped it as the guard's own tail after a correct 21遍. The prompt
// now reserves this phrasing for the no-number case and asks for 「本次资料
// 中没有写明」 for a single missing figure; this scrub is the mechanical
// backstop: when the reply states at least one count, blanket-refusal
// sentences are removed. Returns the removed sentences for logging.
// Shapes seen in production: 「查不到相关原文」「查不到适用于每一个人的通用数字」
// 「查不到统一的标准说法」「不敢乱给数字」「不敢随意告诉您数字」「不方便乱给」,
// and (08-30, after the 查不到 wording was closed) 「这次的资料里没有写明具体
// 数字，你可以照官方功课说明来做 🔗」 — a refusal by another name. The scoped
// single-figure note 「X这一项的遍数本次资料中没有写明」 (unit BEFORE the
// verb) deliberately does not match.
const BLANKET_REFUSAL_RE =
  /查不到[^。！？!?\n]{0,24}(原文|数字|遍数|张数|标准|说法)|(不敢|不方便|不便)(乱|随意)?(给|告诉|报|说)[^。！？!?\n]{0,12}(数字|遍数|张数)|不(敢|方便|便)乱(给|说|报)|(资料|原文|开示|段落|这次)[^。！？!?\n]{0,12}(没有写明|没写明|没有提到|未提及|找不到)[^。！？!?\n]{0,12}(数字|遍数|张数)/;

export function scrubContradictoryRefusal(text: string): { text: string; removed: string[] } {
  if (extractNumberTokens(text).length === 0) return { text, removed: [] };
  if (!BLANKET_REFUSAL_RE.test(text)) return { text, removed: [] };
  const removed: string[] = [];
  const keptLines: string[] = [];
  for (const line of text.split('\n')) {
    if (/^\s*>/.test(line) || !BLANKET_REFUSAL_RE.test(line)) {
      keptLines.push(line);
      continue;
    }
    const kept = splitSentences(line).filter((s) => {
      if (BLANKET_REFUSAL_RE.test(s)) {
        removed.push(s.trim());
        return false;
      }
      return true;
    });
    const rejoined = kept.join('').trim();
    if (rejoined) keptLines.push(rejoined);
  }
  return {
    text: keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    removed,
  };
}

// Does the text carry a blanket 查不到/不敢给 refusal at all? Used for the
// observability log: a refusal shipped while the retrieved chunks DID contain
// 遍数/张数 is the shape of the 08-29 regression and must be visible in logs
// without waiting for a visitor complaint.
export function hasBlanketRefusal(text: string): boolean {
  return BLANKET_REFUSAL_RE.test(text);
}

// ── Over-strip detection ─────────────────────────────────────────────────────
// conv c47ffe52 (2026-08-30): stripping removed every 「📿 《大悲咒》每天3遍」
// sentence, leaving a reply that still says 「念之前跟菩萨说：请大慈大悲观世音
// 菩萨保佑我…」 but names no sutra at all — a prayer with nothing to pray
// before. A 祈求词 with zero sutra names is a 功课 answer gutted by the guard,
// not an answer; the pipeline treats it as a regeneration trigger rather than
// shipping it.
const PRAYER_RE = /请大慈大悲(的)?观世音菩萨|大慈大悲救苦救难广大灵感观世音菩萨摩诃萨(保佑|帮助|医治)|Guan\s*Yin Bodhisattva.{0,40}(protect|bless)/i;
const SUTRA_NAME_RE =
  /《[^》\n]{1,24}(经|咒|真言|陀罗尼|忏悔文)》|大悲咒|心经|礼佛大忏悔文|往生咒|解结咒|准提神咒|消灾吉祥神咒|七佛灭罪真言|功德宝山神咒|Great Compassion Mantra|Heart Sutra|Eighty-?Eight Buddhas/;

export function isOverStripped(text: string): boolean {
  return PRAYER_RE.test(text) && !SUTRA_NAME_RE.test(text);
}
