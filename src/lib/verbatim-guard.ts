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
//                   in the retrieved chunks OR the visitor's own messages
//                   (echoing the visitor's "11遍" stays legal). Chinese-numeral
//                   dates (二月十九…) are out of scope by construction: only
//                   Arabic digits are tokenized.
//
// Pure functions only — the pipeline (care-pipeline.ts) owns the
// regenerate-once / strip / log flow.

export type GuardViolation = { type: 'quote' | 'number'; text: string };

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
    // 组织审定 chunk texts among the retrieved set. When present, PROSE numbers
    // must come from the canonical doc (or the visitor) — numbers that only
    // exist in ordinary book chunks are rejected. This closes the 29cfd74c
    // loophole where "13遍" from a 听众's question inside a 锦集 chunk was
    // technically "in the retrieved text" and got re-presented as doctrine.
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
        violations.push({ type: 'quote', text: seg.trim() });
        lineOk = false;
      }
    }
    if (lineOk) verifiedQuoteLines.add(line);
  }

  // NUMBERS CHECK — prose only (verified verbatim quotes are exempt).
  const proseDraft = draft
    .split('\n')
    .filter((line) => !verifiedQuoteLines.has(line))
    .join('\n');

  const canonicalTexts = opts.canonicalTexts ?? [];
  const numberGround =
    canonicalTexts.length > 0
      ? canonicalTexts.join('\n') + '\n' + visitorTexts.join('\n')
      : chunkTexts.join('\n') + '\n' + visitorTexts.join('\n');
  const groundTokens = new Set(extractNumberTokens(numberGround));

  const seen = new Set<string>();
  for (const token of extractNumberTokens(proseDraft)) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (!groundTokens.has(token)) {
      violations.push({ type: 'number', text: token });
    }
  }

  return violations;
}

// ── Stripping (last resort after the one retry) ──────────────────────────────

// Remove offending quote lines and any sentence carrying an unverified number
// token, then append the safe 查不到原文 disclaimer. If stripping guts the
// reply, the caller should fall back to a full safe answer instead — signalled
// by an empty-ish return (see care-pipeline).
export function stripViolations(draft: string, violations: GuardViolation[]): string {
  const badQuoteSkeletons = new Set(
    violations.filter((v) => v.type === 'quote').map((v) => normalizeForGuard(v.text))
  );
  const badTokens = new Set(violations.filter((v) => v.type === 'number').map((v) => v.text));

  const keptLines: string[] = [];
  for (const line of draft.split('\n')) {
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
    const lineTokens = extractNumberTokens(line);
    if (!lineTokens.some((t) => badTokens.has(t))) {
      keptLines.push(line);
      continue;
    }
    const sentences = line.split(/(?<=[。！？!?；;])/);
    const kept = sentences.filter((s) => !extractNumberTokens(s).some((t) => badTokens.has(t)));
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
