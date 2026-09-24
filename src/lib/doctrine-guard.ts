// src/lib/doctrine-guard.ts — 教义护栏 (docs/briefs/2026-09-24-doctrine-guard.md §2).
//
// The verbatim guard checks NUMBERS and QUOTE BLOCKS. It never asked what a
// sutra is FOR, whether 「回向」 is being taught, or whether a prose 「台长说过…」
// is anything the Master said. Ken 09-24 caught all three in one day:
//   fa32ec15 「为游本昌先生念几遍《心经》回向给他」
//   ff422e0a 「往生咒每天21遍，超度附近的小灵性」 + 「台长开示过，红布包好是绝缘的」
//   aa792a3e 「往生咒可以超度身上的灵性」
// Three detectors, pure functions. The pipeline (care-pipeline.ts) runs them
// next to checkDraft and feeds the violations through the same
// regenerate-once → strip flow. Doctrine violations never add a tail.
//
//   (a) doctrine_huixiang     — teaching 回向 (《佛学问答》第 77 问: 念前祈求就是直接回向)
//   (b) doctrine_target       — chanting / 超度 for spirits that are not the visitor's own
//                               (附近／坟场／宿舍…), or 往生咒 aimed at anything but
//                               「因自己而死去的小灵性」
//   (c) attribution_unsourced — 「台长说过／教过／开示过 X」 where X is in no retrieved
//                               passage. Phase 1: retry + flag only, never stripped.
//
// Lines inside a 「> 」 block that verify verbatim against the retrieved
// passages are exempt (quoting 第 77 问 necessarily says 「回向给谁」).

import { normalizeForGuard, isPrayerLine, isHomeworkLine, type GuardViolation } from './verbatim-guard';

export type DoctrineReason = 'doctrine_huixiang' | 'doctrine_target' | 'attribution_unsourced';

// ── shared helpers ───────────────────────────────────────────────────────────

function splitSentences(line: string): string[] {
  return line.split(/(?<=[。！？!?；;])/).filter((s) => s.trim() !== '');
}

/** A 「> 」 line whose every segment is verbatim in the retrieved passages. Prayer lines never qualify. */
function isVerifiedQuoteLine(line: string, chunksNormalized: string): boolean {
  const m = line.match(/^\s*>\s?(.*)$/);
  if (!m) return false;
  if (isPrayerLine(line)) return false;
  const segs = m[1]
    .split(/…+|\.{3,}|⋯+/)
    .map((s) => normalizeForGuard(s))
    .filter((s) => s.length > 0);
  return segs.length > 0 && segs.every((s) => chunksNormalized.includes(s));
}

// ⚠️ lines and parenthesised time notes belong to the 功课 item above them.
const ITEM_TAIL_RE = /^\s*(>\s*)?(⚠️|[（(](晚上|白天|阴雨|雷雨|每天|一般))/;
function isItemLine(line: string): boolean {
  return isHomeworkLine(line) || isPrayerLine(line) || ITEM_TAIL_RE.test(line);
}

const WANGSHENG_RE = /往生咒|往生净土神咒|拔一切业障根本得生净土陀罗尼/;
const XFZ_RE = /小房子/;

// ── (a) 回向 ────────────────────────────────────────────────────────────────

const HUIXIANG_STRONG_ZH = /回向(给|文|偈)|功德回向|做回向|愿以此功德/;
const HUIXIANG_BARE_ZH = /回向/;
const HUIXIANG_STRONG_EN = /dedicat\w*.{0,12}merit|transfer(ring)?.{0,6}merit|merit dedication/i;
const HUIXIANG_STRONG_ID = /melimpahkan (jasa|pahala|kebajikan)|pelimpahan jasa/i;
const HUIXIANG_BARE_EN = /\bmerits?\b/i;
const HUIXIANG_BARE_ID = /\b(jasa|pahala)\b/i;

function visitorUsed(visitorTexts: string[], re: RegExp): boolean {
  return visitorTexts.some((t) => re.test(t));
}

/**
 * `chunkText` (optional): the retrieved passages. Master Lu's own English
 * material says 「transfer merits」 (the official 往生咒 prayer: 「help me transfer
 * merits to the minor spirits that have died because of me」), so in English
 * that phrase is flagged only when no retrieved passage uses it — the rule the
 * EN intro already states for generic Buddhist terms.
 */
export function huixiangHit(sentence: string, visitorTexts: string[], chunkText = ''): boolean {
  if (HUIXIANG_STRONG_ZH.test(sentence) || HUIXIANG_STRONG_ID.test(sentence)) return true;
  const enInSources = /transfer(ring)?\s+(of\s+)?merit/i.test(chunkText);
  if (HUIXIANG_STRONG_EN.test(sentence) && !enInSources) return true;
  if (enInSources && /transfer/i.test(sentence) && !/dedicat/i.test(sentence)) return false;
  // 「从向外看转回向内看」 (04f86afd) is 转回 + 向内, not 回向.
  if (HUIXIANG_BARE_ZH.test(sentence.replace(/回向[内外里]/g, '')) && !visitorUsed(visitorTexts, /回向/)) return true;
  // Bare merit / jasa only counts next to a dedication verb — 「merit」 alone is
  // an ordinary English word (「the merit of reciting」).
  if (HUIXIANG_BARE_EN.test(sentence) && /dedicat|transfer/i.test(sentence) && !visitorUsed(visitorTexts, /merit|dedicat/i)) return true;
  if (HUIXIANG_BARE_ID.test(sentence) && /limpah/i.test(sentence) && !visitorUsed(visitorTexts, /jasa|pahala|limpah/i)) return true;
  return false;
}

// ── (b) 超度对象 ──────────────────────────────────────────────────────────────

const TARGET_VERB = '(超度|送走|超拔|安抚|送给|敬赠给?)';
// Real places. The deictics 这里／那里／这边／那边 are in the brief's list but
// in prose they are mostly 「敬赠那里写什么」「那边的要经者」 (sweep §5: 4 of 4
// hits were false) — they count only right after the verb (≤2 chars) or right
// before 的灵性／鬼／亡灵 (never 的要经者).
const PLACES =
  '(附近|周围|周边|旁边|宿舍|学校|校园|医院|坟场|坟地|墓地|墓园|陵园|殡仪馆|火葬场|路上|路边|一切众生|所有众生|有缘众生|孤魂野鬼|游魂|无主孤魂)';
const DEICTIC = '(这里|那里|这边|那边)';
const CLAUSE_BREAK = '，,。；;：:！!？?—\n';
const VERB_PLACE_RE = new RegExp(`${TARGET_VERB}[^${CLAUSE_BREAK}]{0,12}?${PLACES}`, 'g');
// 「敬赠那里写什么」 is the 敬赠 field, so only the 超度 verbs pair with a deictic.
const VERB_DEICTIC_RE = new RegExp(`(超度|送走|超拔|安抚)[^${CLAUSE_BREAK}]{0,2}?${DEICTIC}`, 'g');
const PLACE_SPIRIT_RE = new RegExp(`${PLACES}[^${CLAUSE_BREAK}]{0,8}?的(灵性|小灵性|要经者|鬼|亡灵|众生)`, 'g');
const DEICTIC_SPIRIT_RE = new RegExp(`${DEICTIC}的(灵性|小灵性|鬼|亡灵|众生)`, 'g');
const NEG_RE = /(不要|不为|不是|不能|不该|绝不|不去|不用|并非|而不是|别)$/;
const CHANT_RE = /念|经|咒|小房子/;
// 往生咒 aimed at anything but 「因我／因他而死去的小灵性」.
const WS_TARGETS =
  '(身上|身边|家里|聚集|要经者|大灵性|亡人|亲人|妈妈|爸爸|父亲|母亲|先生|太太|女儿|儿子|家人|孩子|婴灵|胎儿|冤亲债主|一切灵性|所有灵性)';
const WS_VERB_TARGET_RE = new RegExp(`(超度|送走|送)[^${CLAUSE_BREAK}]{0,12}?${WS_TARGETS}`, 'g');
const OTHER_TOOL_RE = /小房子|《(?!往生)[^》]{1,24}》|大悲咒|心经|礼佛|解结咒/;

function negatedBefore(text: string, idx: number): boolean {
  // ≤6 chars before the match, allowing a 「为／给」 between the negation and it.
  const before = text.slice(Math.max(0, idx - 6), idx).replace(/[为给替帮]$/, '');
  return NEG_RE.test(before) || /不$/.test(text.slice(0, idx));
}

function hasUnnegated(re: RegExp, text: string): boolean {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!negatedBefore(text, m.index)) return true;
  }
  return false;
}

/**
 * (b) for one sentence. `wangshengContext` = the sentence sits in a 往生咒 功课
 * item or on a line that names 往生咒 (its prayer line, the purpose line under
 * 📿《往生净土神咒》, the next sentence on the same line), so the 往生咒 rule
 * applies even though the sentence does not name the mantra.
 */
export function targetHit(sentence: string, wangshengContext = false): boolean {
  if (hasUnnegated(VERB_PLACE_RE, sentence) || hasUnnegated(VERB_DEICTIC_RE, sentence)) return true;
  if (CHANT_RE.test(sentence) && (hasUnnegated(PLACE_SPIRIT_RE, sentence) || hasUnnegated(DEICTIC_SPIRIT_RE, sentence))) return true;
  // 往生咒专项: each 超度…target must belong to the mantra — the nearest tool
  // named before it is 往生咒 (or the context says so and no other tool is
  // named before it). 「小房子超度大灵性（妈妈），往生咒超度身边聚集的小灵性」
  // flags the second clause only.
  const hasWs = WANGSHENG_RE.test(sentence);
  if (!hasWs && !wangshengContext) return false;
  WS_VERB_TARGET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WS_VERB_TARGET_RE.exec(sentence))) {
    const before = sentence.slice(0, m.index);
    const lastWs = Math.max(before.lastIndexOf('往生咒'), before.lastIndexOf('往生净土神咒'));
    const lastOther = (() => {
      let idx = -1;
      const re = new RegExp(OTHER_TOOL_RE.source, 'g');
      let o: RegExpExecArray | null;
      while ((o = re.exec(before))) idx = o.index;
      return idx;
    })();
    if (hasWs) {
      // The sentence names 往生咒: only a target AFTER it, with no other tool in between.
      if (lastWs < 0 || lastOther > lastWs) continue;
    } else {
      // Context only: skip when the clause names another tool (「超度亡人要用小房子」).
      const clauseEnd = sentence.slice(m.index).search(new RegExp(`[${CLAUSE_BREAK}]`));
      const clause = sentence.slice(0, clauseEnd < 0 ? undefined : m.index + clauseEnd);
      const clauseStart = Math.max(...[...CLAUSE_BREAK].map((ch) => before.lastIndexOf(ch))) + 1;
      if (OTHER_TOOL_RE.test(clause.slice(clauseStart))) continue;
    }
    if (negatedBefore(sentence, m.index)) continue;
    return true;
  }
  return false;
}

// ── (c) 归因 ────────────────────────────────────────────────────────────────

const ATTRIB_RE =
  /(卢台长|台长|师父)(曾经|也|还|一直|经常|常|多次|早就|明确)?(提到过|开示过|告诉我们|教导我们|教我们|说过|教过|讲过|提过|开示|提到|说|教|讲)(我们|大家)?/g;
const MIN_CLAIM_SKELETON = 6;
/** Calibrated on the §5 sample (docs/reviews/doctrine-guard-2026-09-24/sweep.md). */
export const ATTRIBUTION_DICE_MIN = 0.5;
export const ATTRIBUTION_LCS_MIN = 8;

export type AttributionClaim = {
  marker: string;
  claim: string;
  skeleton: string;
  grounded: boolean;
  how: 'substring' | 'dice' | 'lcs' | 'none';
  dice: number;
  lcs: number;
};

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const b = s.slice(i, i + 2);
    m.set(b, (m.get(b) ?? 0) + 1);
  }
  return m;
}

/** Max bigram Dice of `claim` against every window of `chunk` as long as the claim (capped at 60). */
export function maxWindowDice(claim: string, chunk: string): number {
  if (claim.length < 2 || chunk.length < 2) return 0;
  const a = bigrams(claim);
  const aTotal = claim.length - 1;
  const w = Math.min(60, claim.length);
  if (chunk.length <= w) {
    const b = bigrams(chunk);
    let inter = 0;
    for (const [k, v] of a) inter += Math.min(v, b.get(k) ?? 0);
    return (2 * inter) / (aTotal + chunk.length - 1);
  }
  // Sliding window with incremental bigram counts.
  const win = bigrams(chunk.slice(0, w));
  let inter = 0;
  for (const [k, v] of a) inter += Math.min(v, win.get(k) ?? 0);
  const wTotal = w - 1;
  let best = (2 * inter) / (aTotal + wTotal);
  for (let s = 1; s + w <= chunk.length; s++) {
    const out = chunk.slice(s - 1, s + 1);
    const inn = chunk.slice(s + w - 2, s + w);
    const oc = win.get(out)!;
    if (oc <= (a.get(out) ?? 0)) inter--;
    win.set(out, oc - 1);
    const ic = (win.get(inn) ?? 0) + 1;
    win.set(inn, ic);
    if (ic <= (a.get(inn) ?? 0)) inter++;
    const d = (2 * inter) / (aTotal + wTotal);
    if (d > best) best = d;
  }
  return best;
}

/** Longest common substring length. */
export function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  let prev = new Uint16Array(b.length + 1);
  let cur = new Uint16Array(b.length + 1);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : 0;
      if (cur[j] > best) best = cur[j];
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return best;
}

/**
 * Every 「台长说过…」 claim in the prose of `draft`, with its grounding verdict.
 * `groundTexts` = the retrieved passages plus, in production, the zh system
 * prompt modules (org-curated 台长 lines such as 「身心兼修，两手抓才好得快」 —
 * the §5 sample had 8 of 36 claims grounded only there).
 */
export function attributionClaims(draft: string, groundTexts: string[]): AttributionClaim[] {
  const chunksNorm = groundTexts.map((t) => normalizeForGuard(t));
  const out: AttributionClaim[] = [];
  for (const line of draft.split('\n')) {
    if (/^\s*>/.test(line)) continue;
    for (const sentence of splitSentences(line)) {
      ATTRIB_RE.lastIndex = 0;
      const m = ATTRIB_RE.exec(sentence);
      if (!m) continue;
      // Not a claim: 「说得很实在」「讲过的原文」「教我们的方式」「教法」 — the regex
      // can backtrack from 讲过 to 讲, so the relative-clause check is done here.
      if (/^(过)?(我们)?[的得]|^法|^[里中]/.test(sentence.slice(m.index + m[0].length))) continue;
      const claim = sentence
        .slice(m.index + m[0].length)
        .replace(/^了(?=[\s:：，,—*-])/, '')
        .replace(/^[\s:：，,、「」“”"'‘’—\-*]+/, '')
        .trim();
      const skeleton = normalizeForGuard(claim);
      if (skeleton.length < MIN_CLAIM_SKELETON) continue;
      let dice = 0;
      let lcs = 0;
      let how: AttributionClaim['how'] = 'none';
      if (chunksNorm.some((c) => c.includes(skeleton))) {
        how = 'substring';
        dice = 1;
        lcs = skeleton.length;
      } else {
        for (const c of chunksNorm) {
          dice = Math.max(dice, maxWindowDice(skeleton, c));
          lcs = Math.max(lcs, longestCommonSubstring(skeleton, c));
        }
        if (dice >= ATTRIBUTION_DICE_MIN) how = 'dice';
        else if (lcs >= ATTRIBUTION_LCS_MIN) how = 'lcs';
      }
      out.push({ marker: m[0], claim, skeleton, grounded: how !== 'none', how, dice: Math.round(dice * 100) / 100, lcs });
    }
  }
  return out;
}

// ── The check ────────────────────────────────────────────────────────────────

export function checkDoctrine(
  draft: string,
  chunkTexts: string[],
  visitorTexts: string[],
  opts: { attributionExtra?: string[] } = {}
): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const chunksNormalized = normalizeForGuard(chunkTexts.join('\n'));
  const lines = draft.split('\n');
  const seen = new Set<string>();
  const push = (reason: DoctrineReason, text: string) => {
    const key = `${reason}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ type: 'doctrine', reason, text: text.trim() });
  };
  const wsItem = wangshengItemFlags(lines);
  const chunkJoined = chunkTexts.join('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isVerifiedQuoteLine(line, chunksNormalized)) continue;
    for (const s of splitSentences(line)) {
      if (huixiangHit(s, visitorTexts, chunkJoined)) push('doctrine_huixiang', s);
      if (targetHit(s, wsItem[i])) push('doctrine_target', s);
    }
  }
  for (const c of attributionClaims(draft, [...chunkTexts, ...(opts.attributionExtra ?? [])])) {
    if (!c.grounded) push('attribution_unsourced', c.claim);
  }
  return violations;
}

/** Per line: is it part of a 往生咒 功课 item (the 📿 line or the prayer / ⚠️ lines under it)? */
function wangshengItemFlags(lines: string[]): boolean[] {
  const flags = new Array<boolean>(lines.length).fill(false);
  let inWs = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (isHomeworkLine(l)) inWs = WANGSHENG_RE.test(l.match(/往生咒|往生净土神咒|小房子|《[^》]+》|大悲咒|心经|礼佛|解结咒/)?.[0] ?? '');
    else if (l.trim() === '') inWs = false;
    // A prose line directly under the item (「帮助超度身边的小灵性」 under
    // 📿《往生咒》) explains the item; the item ends at the next blank line.
    else if (!isItemLine(l) && !(i > 0 && flags[i - 1])) inWs = false;
    flags[i] = inWs || (WANGSHENG_RE.test(l) && !isHomeworkLine(l));
  }
  return flags;
}

// ── Stripping ────────────────────────────────────────────────────────────────
// (a) remove the offending sentence; on a 📿 line the whole item (📿 + its
//     prayer / ⚠️ lines) goes, on a prayer line just that line.
// (b) remove the sentence; on a 📿／prayer／⚠️ line — or a prose line directly
//     under a 往生咒／小房子 item — the WHOLE item goes: 「往生咒 21 遍」 left
//     without its purpose still reads as 「for the graveyard」.
// (c) never stripped in phase 1.
// A lead-in ending in 「：」 left introducing nothing is removed too.
export function stripDoctrine(draft: string, violations: GuardViolation[]): string {
  const hx = violations.filter((v) => v.reason === 'doctrine_huixiang').map((v) => v.text);
  const tg = violations.filter((v) => v.reason === 'doctrine_target').map((v) => v.text);
  if (hx.length === 0 && tg.length === 0) return draft;
  const lines = draft.split('\n');
  const drop = new Array<boolean>(lines.length).fill(false);
  const rewrite = new Map<number, string>();
  const has = (list: string[], s: string) => list.some((t) => t && s.includes(t));
  const lineHas = (list: string[], l: string) => list.some((t) => t && l.includes(t));

  // Item spans: [head, end) for each 📿 line.
  const itemOf = new Array<[number, number] | null>(lines.length).fill(null);
  for (let i = 0; i < lines.length; i++) {
    if (!isHomeworkLine(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '' && isItemLine(lines[j]) && !isHomeworkLine(lines[j])) j++;
    for (let k = i; k < j; k++) itemOf[k] = [i, j];
  }
  const dropItem = (span: [number, number]) => {
    for (let k = span[0]; k < span[1]; k++) drop[k] = true;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const hxHit = lineHas(hx, l);
    const tgHit = lineHas(tg, l);
    if (!hxHit && !tgHit) continue;
    const span = itemOf[i];
    if (tgHit) {
      if (span) {
        dropItem(span);
        continue;
      }
      // Prose directly under a 往生咒／小房子 item: the sentence explains the item.
      let p = i - 1;
      while (p >= 0 && lines[p].trim() === '') p--;
      const above = p >= 0 ? itemOf[p] : null;
      if (above && (WANGSHENG_RE.test(lines[above[0]]) || XFZ_RE.test(lines[above[0]])) && i - p <= 1) {
        dropItem(above);
        drop[i] = true;
        continue;
      }
    }
    if (span && isHomeworkLine(l)) {
      dropItem(span);
      continue;
    }
    if (span && (isPrayerLine(l) || ITEM_TAIL_RE.test(l))) {
      drop[i] = true;
      continue;
    }
    const kept = splitSentences(l).filter((s) => !has(hx, s) && !has(tg, s));
    const rejoined = kept.join('').trim();
    if (rejoined && normalizeForGuard(rejoined).length > 0) rewrite.set(i, rejoined);
    else drop[i] = true;
  }

  // Lead-ins: a kept line ending in 「：」 whose following content was all dropped.
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (drop[i]) continue;
    const text = rewrite.get(i) ?? lines[i];
    if (/[:：]\s*(\*\*)?\s*$/.test(text.trim())) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      let k = j;
      let anyDropped = false;
      while (k < lines.length && lines[k].trim() !== '') {
        if (drop[k]) anyDropped = true;
        else break;
        k++;
      }
      const nextKept = k < lines.length && lines[k].trim() !== '' && !drop[k];
      if (anyDropped && !nextKept) continue;
    }
    out.push(text);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Retry instruction lines ──────────────────────────────────────────────────

const clip = (s: string) => (s.length > 60 ? `${s.slice(0, 60)}…` : s);

export function doctrineRetryLines(violations: GuardViolation[]): string[] {
  const out: string[] = [];
  const hx = violations.filter((v) => v.reason === 'doctrine_huixiang');
  const tg = violations.filter((v) => v.reason === 'doctrine_target');
  const at = violations.filter((v) => v.reason === 'attribution_unsourced');
  if (hx.length > 0) {
    out.push(
      `- 「${clip(hx[0].text)}」：本法门不教「回向」——念经前的祈请「保佑 XXX」就是直接回向（《佛学问答》第 77 问）。不写「回向给谁」「功德回向」「回向文」「愿以此功德」；访客没问回向，「回向」两个字都不要出现。为家人、亡人念经就写念前祈请保佑他；亡人用小房子敬赠亡人；不自创祈求词。访客问「要不要回向」时，只用引文块逐字引《佛学问答》第 77 问。`
    );
  }
  if (tg.length > 0) {
    out.push(
      `- 「${clip(tg[0].text)}」：往生咒只超度因自己而死去的小灵性，小房子只给自己的要经者、自己的亡人／孩子／房子的要经者：不能教访客为「附近／周围／宿舍／学校／医院／坟场／路上」的灵性或孤魂野鬼念经、超度或挡他们，也不能写往生咒超度身上的灵性、要经者、亡人。住处靠近坟场／医院等，只按检索段落里的原文答（坚持功课、多念《大悲咒》增强功德和功力；念经时不要有任何想法、不要给谁念；小房子只给自己的要经者）。`
    );
  }
  for (const v of at.slice(0, 3)) {
    out.push(
      `- 「台长说过／教过／开示过……」后面的内容在本次检索段落里找不到（『${clip(v.text)}』）：删掉这句，或改成不归于台长的一般说法；只有检索段落里确实有的内容才能说是台长说的。`
    );
  }
  return out;
}

export function isDoctrineViolation(v: GuardViolation): boolean {
  return v.type === 'doctrine';
}
