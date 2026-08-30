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
// Pure functions only — the pipeline (care-pipeline.ts) owns the
// regenerate-once / strip / log flow.

export type GuardViolationReason =
  // A blockquote segment is not a verbatim substring of any retrieved chunk.
  | 'quote_not_verbatim'
  // N遍/N张 appears in no retrieved chunk and not in the visitor's words.
  | 'number_not_in_sources'
  // N遍/N张 sits in a sentence on the 组织审定 subject but only an ordinary
  // (non-canonical) chunk carries it — 组织审定 wins on its own subject.
  | 'number_canonical_conflict';

export type GuardViolation = {
  type: 'quote' | 'number';
  text: string;
  reason: GuardViolationReason;
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

// Extract N遍 / N张 tokens. A range ("21-49遍", "21至49遍") yields BOTH bounds
// as tokens, on drafts and ground truth alike, so range phrasing on either
// side still matches.
export function extractNumberTokens(s: string): string[] {
  const t = normalizeForNumbers(s);
  const out: string[] = [];
  const re = /(\d+)(?:[-–—~～至到](\d+))?(遍|张)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    out.push(m[1] + m[3]);
    if (m[2]) out.push(m[2] + m[3]);
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

  // Ground truth = EVERY retrieved chunk + the visitor's own words (the
  // original brief). The canonical set is a stricter sub-ground applied only
  // to sentences on the canonical subject.
  const visitorTokens = new Set(extractNumberTokens(visitorTexts.join('\n')));
  const allTokens = new Set([...extractNumberTokens(chunkTexts.join('\n')), ...visitorTokens]);
  const canonicalTexts = opts.canonicalTexts ?? [];
  const canonicalTokens = new Set([
    ...extractNumberTokens(canonicalTexts.join('\n')),
    ...visitorTokens,
  ]);
  const canonicalPresent = canonicalTexts.length > 0;

  const seen = new Set<string>();
  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    if (verifiedQuoteLines.has(line)) continue;
    const strict = canonicalPresent && subjectFlags[i];
    for (const token of extractNumberTokens(line)) {
      const key = `${strict ? 'c' : 'a'}:${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!allTokens.has(token)) {
        violations.push({ type: 'number', text: token, reason: 'number_not_in_sources' });
      } else if (strict && !canonicalTokens.has(token)) {
        violations.push({ type: 'number', text: token, reason: 'number_canonical_conflict' });
      }
    }
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
  const badEverywhere = new Set(
    violations.filter((v) => v.reason === 'number_not_in_sources').map((v) => v.text)
  );
  const badOnCanonical = new Set(
    violations.filter((v) => v.reason === 'number_canonical_conflict').map((v) => v.text)
  );
  const sentenceIsBad = (s: string, lineOnSubject: boolean): boolean => {
    const tokens = extractNumberTokens(s);
    if (tokens.some((t) => badEverywhere.has(t))) return true;
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
    if (!sentenceIsBad(line, lineOnSubject)) {
      keptLines.push(line);
      continue;
    }
    const kept = splitSentences(line).filter((s) => !sentenceIsBad(s, lineOnSubject));
    const rejoined = kept.join('').trim();
    if (rejoined) keptLines.push(rejoined);
  }

  // Collapse the blank-line runs that stripping leaves behind.
  return keptLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

export function chooseGuardTail(stripped: string, violations: GuardViolation[]): GuardTail {
  if (!violations.some((v) => v.type === 'number')) return 'none';
  return extractNumberTokens(stripped).length > 0 ? 'partial' : 'blanket';
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
// 「查不到统一的标准说法」「不敢乱给数字」「不敢随意告诉您数字」「不方便乱给」.
const BLANKET_REFUSAL_RE =
  /查不到[^。！？!?\n]{0,24}(原文|数字|遍数|张数|标准|说法)|(不敢|不方便|不便)(乱|随意)?(给|告诉|报|说)[^。！？!?\n]{0,12}(数字|遍数|张数)|不(敢|方便|便)乱(给|说|报)/;

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
