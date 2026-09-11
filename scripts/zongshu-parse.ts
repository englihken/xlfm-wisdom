// scripts/zongshu-parse.ts
// 玄艺综述 (lujunhong2or category 3) parser — batch 2 §2 (2026-09-11).
//
// The Phase-B transcript parser only understood family A (听众：/台长：).
// The 1,388 posts fall into format families; each has its own handling:
//   A  听众：/台长：              existing transcript parser (unchanged)
//   B  问：…答：                  letters-style 问/答, often inside ONE paragraph,
//                                 with bracketed caller interjections kept in 答
//   C  卢台长：/听 众：           transcript parser with 听\s*众; the leading
//                                 【东方台秘书处编者按】 block → editor_note
//   D  《图腾世界》               B + 「（良宵注：…）」 → editor_note + a
//                                 YYMMDD星期 date prefix → original_date
//   E  同修分享／反馈             NOT uploaded (testimonials, another brief)
//   F  解答会记录／开示 (no Q&A)  type='teaching', plain paragraph chunking
//   G  通灵实例解说／活在新空间／  HELD — 3 samples per sub-series go to the
//      other unrecognised formats  report for the architect to approve first
//
// Normalization first (NFKC + entity decoding) — full-width colons and nbsp
// were why the old detector missed 问/答 in many posts. Every chunk carries
// speaker / case_kind / family metadata; zero-pair posts are reported with a
// reason, never silently dropped.

import {
  htmlToLines,
  decodeEntities,
  extractDateLoose,
  parseTranscriptLines,
  type WpPost,
  type QaChunk,
} from './lujunhong2or-parse';

export type Family = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type CaseKind = 'totem_reading' | 'qa' | 'teaching';

export interface ZsChunk extends QaChunk {
  family: Family;
  speaker: 'taizhang';
  case_kind: CaseKind;
  editor_note?: string;
  original_date?: string;
  // Batch 3 §1: pre-2010 cases predate the standardized 小房子 — historical record only.
  era?: 'pre_xiaofangzi' | 'standard';
  /** G book series name (通灵实例解说 / 活在新空间) for per-series reporting. */
  subseries?: string;
}

export interface ZsPostParse {
  family: Family;
  subseries?: string;
  chunks: ZsChunk[];
  warnings: string[];
  /** Why a family-A..D/F post produced no chunk (never silent). */
  zeroReason?: string;
  /** Expected zero-chunk posts (a book's 本书说明/目录 page) — not an error. */
  skippedReason?: 'front_matter';
}

// ── Normalization ────────────────────────────────────────────────────────────

export function normalizeLine(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** Post HTML → NFKC-normalized lines ('' = paragraph spacer). */
export function postLines(post: WpPost): string[] {
  return htmlToLines(post.content.rendered).map((l) => (l === '' ? '' : normalizeLine(l)));
}

export function postTitle(post: WpPost): string {
  return normalizeLine(decodeEntities(post.title.rendered));
}

// ── Markers (on normalized text) ─────────────────────────────────────────────

const LISTENER_LINE = /^(\((男|女)听众\))?\s*(男|女)?听\s*众[A-Za-z0-9甲乙丙丁]{0,3}\s*[：:]/;
const TAIZHANG_LINE = /^(卢?台\s*长|师父)(答|开示)?\s*[：:]/;
// A 问/答 marker is a turn marker only when NOT preceded by a CJK character
// (「很多听众问：」 inside speech is prose; 「090118问：」 with a date prefix is a
// turn). Numbered variants 问1：/答1： (台长开示佛友玄学问题) are allowed.
const Q_INLINE = /(?<![一-鿿])(\((?:男|女)听众\))?\s*问\s*[0-9一二三四五六七八九十]{0,3}\s*[：:]/;
const A_INLINE = /(?<![一-鿿])(?:答|卢?台长答?|师父答?)\s*[0-9一二三四五六七八九十]{0,3}\s*[：:]/;
const Q_START = /^(\((?:男|女)听众\))?\s*问\s*[0-9一二三四五六七八九十]{0,3}\s*[：:]/;
const A_START = /^(?:答|卢?台长答?|师父答?)\s*[0-9一二三四五六七八九十]{0,3}\s*[：:]/;
const EDITOR_START = /^【?(东方台)?(秘书处)?编者按】?\s*[：:]?/;
const LIANGXIAO_NOTE = /\(\s*良宵(注|评注|按)\s*[：:]?([^()]*)\)/g;
// 「090317星期二,5点到6点,玄艺综述看图腾节目:问:…」 or a bare 「090220」 line.
// Batch 3: a YYMMDD at the head of a segment (optionally after a 《…》 label:
// 「《重点导读案例1》:090912星期六下午5点到6点,在录音35分到38分之间。…」) sets the
// date; the weekday/time-slot description up to the next 问 is stripped.
const DATE_PREFIX = /^(?:《[^》]{1,20}》\s*[：:]?\s*)?(\d{2})(\d{2})(\d{2})(?!\d)/;
const DATE_TAIL = /^\s*(?:星期[一二三四五六日天]?)?[^问答]{0,60}?(?=(\((?:男|女)听众\))?\s*问\s*[：:])|^\s*星期[一二三四五六日天]?[,，]?/;
// 「15-18问:」 — a program time range with no date: strip it, keep the current date.
const TIME_RANGE_PREFIX = /^\d{1,3}\s*[-–]\s*\d{1,3}\s*(分)?[,，]?\s*(?=(\((?:男|女)听众\))?\s*问\s*[：:])/;
// A date / time-range that sits at the END of the previous segment (the split
// happened at the 问 marker right after it) — moved to the head of the 问 segment.
const TRAILING_PREFIX = /(?:(?:《[^》]{1,20}》\s*[：:]?\s*)?\d{6}(?:星期[一二三四五六日天]?[^问答。！？]{0,60})?|\d{1,3}\s*[-–]\s*\d{1,3}\s*(分)?[,，]?)\s*$/;
// Unbracketed 「良宵评注:…」 / 「良宵添注:…」 runs to the end of its segment.
const LIANGXIAO_TAIL = /\s*良宵(评注|添注|注|按)\s*[：:][\s\S]*$/;
// A 良宵 book's own front matter (本书说明 / 目录 / 资料来源) — no exchanges by design.
const FRONT_MATTER_RE = /本书说明|本册说明|目录[：:]|资料来源[：:]|整理编写|收听、记录|几点说明/;
const TOTEM_RE = /看了图腾后答|看图腾|图腾/;

// ── Classification ───────────────────────────────────────────────────────────

export function classifyPost(post: WpPost): { family: Family; subseries?: string } {
  const title = postTitle(post);
  const lines = postLines(post);
  if (/同修分享|同修反馈|同修.{0,4}反馈/.test(title)) return { family: 'E', subseries: '同修分享／反馈' };
  if (/图腾世界/.test(title)) return { family: 'D' };
  if (/通灵实例解说/.test(title)) return { family: 'G', subseries: '通灵实例解说' };
  if (/活在新空间/.test(title)) return { family: 'G', subseries: '活在新空间' };

  const hasListener = lines.some((l) => LISTENER_LINE.test(l));
  const hasTaizhang = lines.some((l) => TAIZHANG_LINE.test(l));
  if (hasListener && hasTaizhang) {
    const spaced = lines.some((l) => /^卢台\s*长\s*[：:]/.test(l)) && lines.some((l) => /听\s+众/.test(l));
    return { family: spaced ? 'C' : 'A' };
  }
  const hasQ = lines.some((l) => Q_INLINE.test(l));
  const hasA = lines.some((l) => A_INLINE.test(l));
  if (hasQ && hasA) return { family: 'B' };

  // Pure speech (解答会记录 / 开示 / 讲座): 台长 talking, no exchange. A stray
  // 「问：」 quoted inside the speech does not make it a Q&A post.
  const speechTitle = /解答会记录|开示|讲座|法会记录|见面会|解答会\s*\(/.test(title);
  const reportTitle = /祝贺|^记|——记|—记|-记|索引|集锦|视频|通知|公告|追踪报道|法喜充满$|发布/.test(title);
  // A 秘书处 announcement wearing a speech-like title (「发布卢台长…讲座的记录」
  // whose body says 「我们会陆续发布…感谢…整理」) is editorial, not 台长.
  const firstPara = lines.find((l) => l !== '') ?? '';
  const editorialBody = /^(我们会|东方台|秘书处|感谢|热烈|受.{0,12}委托|应.{0,8}要求)|陆续发布|整理工作|功德无量/.test(firstPara);
  if (speechTitle && !reportTitle && !hasListener && !editorialBody) return { family: 'F' };
  const sub = /精彩灵验对话摘录/.test(title)
    ? '精彩灵验对话摘录（非对话格式）'
    : hasListener || hasQ
      ? '对话标记不完整'
      : '其他（无问答标记）';
  return { family: 'G', subseries: sub };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Split off a leading 编者按 block (until the first dialogue/Q marker). */
// The note runs from the 【编者按】 line to the first spacer / dialogue marker,
// or just that one paragraph when `singleParagraph` (teaching posts have no
// marker after it — the whole speech would otherwise be swallowed).
function splitEditorNote(lines: string[], opts: { singleParagraph?: boolean } = {}): { note?: string; rest: string[] } {
  const firstIdx = lines.findIndex((l) => l !== '' && EDITOR_START.test(l));
  if (firstIdx < 0) return { rest: lines };
  const note: string[] = [];
  let i = firstIdx;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l === '' && note.length > 0) break;
    if (l !== '' && (LISTENER_LINE.test(l) || TAIZHANG_LINE.test(l) || Q_START.test(l) || Q_INLINE.test(l))) break;
    if (l !== '') note.push(l.replace(EDITOR_START, '').trim());
    if (opts.singleParagraph && note.length >= 1) { i++; break; }
  }
  const rest = [...lines.slice(0, firstIdx), ...lines.slice(i)];
  const text = note.filter(Boolean).join('\n').slice(0, 1500);
  return { note: text || undefined, rest };
}

function caseKind(answerText: string): CaseKind {
  return TOTEM_RE.test(answerText) ? 'totem_reading' : 'qa';
}

function ymd(yy: string, mm: string, dd: string): string {
  return `20${yy}-${mm}-${dd}`;
}

// ── Family B / D: 问/答 with same-paragraph splitting ─────────────────────────

interface Exchange {
  heading?: string;
  turns: string[];
  hasAnswer: boolean;
  notes: string[];
  date?: string;
}

function eraOf(date?: string): 'pre_xiaofangzi' | 'standard' | undefined {
  if (!date) return undefined;
  return date < '2010-01-01' ? 'pre_xiaofangzi' : 'standard';
}

function parseQaPost(post: WpPost, family: 'B' | 'D' | 'G', subseries?: string): ZsPostParse {
  const title = postTitle(post);
  const warnings: string[] = [];
  const { note: editorNote, rest } = splitEditorNote(postLines(post));

  // Segment every line at each 问/答 marker (they often share one paragraph),
  // keeping the marker at the head of its segment.
  const segments: string[] = [];
  for (const line of rest) {
    if (line === '') { segments.push(''); continue; }
    let s = line;
    // Strip 良宵注 into notes AFTER segmentation — keep as-is for now.
    const parts: string[] = [];
    let cursor = 0;
    const re = new RegExp(`${Q_INLINE.source}|${A_INLINE.source}`, 'g');
    let m: RegExpExecArray | null;
    const boundaries: number[] = [];
    while ((m = re.exec(s)) !== null) {
      if (m.index > 0) boundaries.push(m.index);
      if (m[0].length === 0) re.lastIndex++;
    }
    for (const b of boundaries) { parts.push(s.slice(cursor, b).trim()); cursor = b; }
    parts.push(s.slice(cursor).trim());
    // A date/time prefix left dangling at the end of the previous part belongs
    // to the 问 that follows it (「…比以前好多了。15-18问:…」 → 「15-18」 moves).
    for (let i = 1; i < parts.length; i++) {
      const m = parts[i - 1].match(TRAILING_PREFIX);
      if (m && Q_START.test(parts[i])) {
        parts[i] = `${m[0].trim()}${parts[i]}`;
        parts[i - 1] = parts[i - 1].slice(0, m.index).trim();
      }
    }
    segments.push(...parts.filter((p) => p !== ''));
    s = '';
  }

  const exchanges: Exchange[] = [];
  let cur: Exchange | null = null;
  const preamble: string[] = [];
  let currentDate: string | undefined = family === 'D' || family === 'G' ? undefined : extractDateLoose(post.title.rendered) ?? undefined;
  let pendingHeading: string | null = null;

  const close = () => {
    if (cur && cur.hasAnswer) exchanges.push(cur);
    else if (cur && cur.turns.join('').length > 60) warnings.push(`post ${post.id}: dropped answerless 问 (${cur.turns.join('').length} chars)`);
    cur = null;
  };

  for (let seg of segments) {
    if (seg === '') { continue; }
    // D/G: date prefix on the segment (090317星期二,5点到6点,玄艺综述看图腾节目: /
    // 《重点导读案例1》:090912星期六… / bare 090220), or a time range 「15-18问:」.
    if (family === 'D' || family === 'G') {
      const d = seg.match(DATE_PREFIX);
      if (d) {
        currentDate = ymd(d[1], d[2], d[3]);
        seg = seg.slice(d[0].length).replace(DATE_TAIL, '').trim();
        if (seg === '') continue;
        // Date line followed by 良宵's own narration (「…由于台长疏忽,本次节目只有
        // 最后八分钟录音…」) rather than a 问: editorial, not part of an answer.
        if (!Q_START.test(seg) && !A_START.test(seg) && !TIME_RANGE_PREFIX.test(seg)) {
          if (cur) cur.notes.push(seg);
          else preamble.push(seg);
          continue;
        }
      }
      const tr = seg.match(TIME_RANGE_PREFIX);
      if (tr) seg = seg.slice(tr[0].length).trim();
    }
    // Pull 良宵注 out of the segment (D/G; harmless elsewhere): bracketed
    // 「（良宵注：…）」 anywhere, and an unbracketed 「良宵评注:…」 tail.
    const notes: string[] = [];
    seg = seg.replace(LIANGXIAO_NOTE, (_, __, body) => { notes.push(String(body).trim()); return ''; });
    const tail = seg.match(LIANGXIAO_TAIL);
    if (tail && tail.index !== undefined && tail.index > 0) {
      notes.push(tail[0].replace(/^\s*良宵(评注|添注|注|按)\s*[：:]/, '').trim());
      seg = seg.slice(0, tail.index);
    }
    seg = seg.replace(/\s{2,}/g, ' ').trim();

    if (Q_START.test(seg)) {
      if (cur && cur.hasAnswer) close();
      if (!cur) {
        cur = { turns: [], hasAnswer: false, notes: [], date: currentDate };
        if (pendingHeading) { cur.heading = pendingHeading; pendingHeading = null; }
      }
      cur.turns.push(seg);
      cur.notes.push(...notes);
    } else if (A_START.test(seg)) {
      if (!cur) cur = { turns: [], hasAnswer: false, notes: [], date: currentDate };
      cur.turns.push(seg);
      cur.hasAnswer = true;
      cur.notes.push(...notes);
    } else if (cur && cur.turns.length > 0) {
      // Continuation of the current turn (multi-paragraph answer).
      if (seg) cur.turns[cur.turns.length - 1] += '\n' + seg;
      cur.notes.push(...notes);
    } else if (seg.length <= 30 && seg.length >= 2 && !/[.。,，!！?？:：;；()（）]/.test(seg) && preamble.length === 0) {
      pendingHeading = seg; // short topic label (never a fragment of the preamble)
    } else {
      preamble.push(seg);
    }
  }
  close();

  const preambleNote = preamble.join('\n').trim();
  const noteParts = [editorNote, preambleNote].filter(Boolean) as string[];
  if (exchanges.length === 0) {
    const frontMatter = family === 'G' && (FRONT_MATTER_RE.test(preambleNote) || /\(1\)$/.test(title));
    return {
      family,
      subseries,
      chunks: [],
      warnings,
      ...(frontMatter ? { skippedReason: 'front_matter' as const } : {}),
      zeroReason: frontMatter
        ? 'front matter (本书说明/目录/听众感悟) — no exchange by design'
        : `no 问↔答 exchange after segmentation (${segments.filter(Boolean).length} segments, preamble ${preambleNote.length} chars)`,
    };
  }
  const chunks: ZsChunk[] = exchanges.map((e, i) => {
    const answerText = e.turns.filter((t) => A_START.test(t)).join('\n');
    const dateLine = e.date ? `节目日期：${e.date}\n` : '';
    const note = [...noteParts, ...e.notes].filter(Boolean).join('\n').slice(0, 2000);
    return {
      id: `zongshu_${post.id}_${i + 1}`,
      postId: post.id,
      index: i + 1,
      heading: e.heading,
      text: `【${title}】\n${dateLine}${e.heading ? `${e.heading}\n` : ''}${e.turns.join('\n')}`,
      family,
      speaker: 'taizhang',
      case_kind: caseKind(answerText),
      ...(note ? { editor_note: note } : {}),
      ...(e.date ? { original_date: e.date } : {}),
      ...(eraOf(e.date) ? { era: eraOf(e.date) } : {}),
      ...(subseries ? { subseries } : {}),
    };
  });
  return { family, subseries, chunks, warnings };
}

// ── Family A / C: transcript parser over normalized lines ───────────────────

// A 玄艺综述 dialogue post is usually ONE caller's conversation (「听 众: 对!」 /
// 「卢台长: 还有肾脏很不好」 back and forth), so the per-听众-turn exchanges the
// transcript parser emits are merged into chunks of ~DIALOGUE_TARGET chars —
// a 40-char 「听 众: 还在啊?」 fragment is not a retrievable unit.
const DIALOGUE_TARGET = 1000;

function parseDialoguePost(post: WpPost, family: 'A' | 'C'): ZsPostParse {
  const title = postTitle(post);
  const { note, rest } = splitEditorNote(postLines(post));
  const { chunks, warnings } = parseTranscriptLines(post.id, title, rest, 'zongshu');
  const date = extractDateLoose(post.title.rendered) ?? undefined;
  if (chunks.length === 0) {
    return { family, chunks: [], warnings, zeroReason: 'no 听众 ↔ 台长 exchange found by the transcript parser' };
  }
  // Strip the 【title】 line the transcript parser prepends, then pack.
  const bodies = chunks.map((c) => c.text.replace(/^【[^】]*】\n/, ''));
  const groups: string[][] = [];
  let g: string[] = [];
  let len = 0;
  for (const b of bodies) {
    if (len + b.length > DIALOGUE_TARGET && g.length) { groups.push(g); g = []; len = 0; }
    g.push(b);
    len += b.length;
  }
  if (g.length) groups.push(g);
  return {
    family,
    warnings,
    chunks: groups.map((gr, i) => {
      const body = gr.join('\n');
      const answerText = body.split('\n').filter((l) => TAIZHANG_LINE.test(l)).join('\n');
      return {
        id: `zongshu_${post.id}_${i + 1}`,
        postId: post.id,
        index: i + 1,
        text: `【${title}】\n${date ? `节目日期：${date}\n` : ''}${body}`,
        family,
        speaker: 'taizhang' as const,
        case_kind: caseKind(answerText),
        ...(note ? { editor_note: note } : {}),
        ...(date ? { original_date: date } : {}),
        ...(eraOf(date) ? { era: eraOf(date) } : {}),
      };
    }),
  };
}

// ── Family F: teaching (no Q&A) — plain paragraph chunking ───────────────────

const TEACHING_TARGET = 900;
const TEACHING_MAX = 1400;

function parseTeachingPost(post: WpPost): ZsPostParse {
  const title = postTitle(post);
  const { note, rest } = splitEditorNote(postLines(post), { singleParagraph: true });
  const paras = rest.filter((l) => l !== '');
  const date = extractDateLoose(post.title.rendered) ?? undefined;
  // Greedy paragraph packing; an oversized paragraph is split at sentence ends.
  const units: string[] = [];
  for (const p of paras) {
    if (p.length <= TEACHING_MAX) { units.push(p); continue; }
    let buf = '';
    for (const s of p.split(/(?<=[。！？!?])/)) {
      if (buf.length + s.length > TEACHING_TARGET && buf) { units.push(buf); buf = ''; }
      buf += s;
    }
    if (buf) units.push(buf);
  }
  const groups: string[][] = [];
  let g: string[] = [];
  let len = 0;
  for (const u of units) {
    if (len + u.length > TEACHING_TARGET && g.length) { groups.push(g); g = []; len = 0; }
    g.push(u);
    len += u.length;
  }
  if (g.length) groups.push(g);
  if (groups.length === 0) return { family: 'F', chunks: [], warnings: [], zeroReason: 'no paragraphs after normalization' };
  return {
    family: 'F',
    warnings: [],
    chunks: groups.map((gr, i) => ({
      id: `zongshu_${post.id}_${i + 1}`,
      postId: post.id,
      index: i + 1,
      text: `【${title}】\n${gr.join('\n')}`,
      family: 'F' as const,
      speaker: 'taizhang' as const,
      case_kind: 'teaching' as const,
      ...(note ? { editor_note: note } : {}),
      ...(date ? { original_date: date } : {}),
      ...(eraOf(date) ? { era: eraOf(date) } : {}),
    })),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export function parseZongshuPost(post: WpPost): ZsPostParse {
  const { family, subseries } = classifyPost(post);
  switch (family) {
    case 'A':
    case 'C':
      return parseDialoguePost(post, family);
    case 'B':
    case 'D':
      return parseQaPost(post, family);
    case 'F':
      return parseTeachingPost(post);
    case 'E':
      return { family, subseries, chunks: [], warnings: [], zeroReason: 'testimonial — not uploaded by design' };
    default:
      // Batch 3 §1: 通灵实例解说 / 活在新空间 approved → the B/D parser; the rest of G stays held.
      if (subseries === '通灵实例解说' || subseries === '活在新空间') return parseQaPost(post, 'G', subseries);
      return { family: 'G', subseries, chunks: [], warnings: [], zeroReason: `held for review (${subseries})` };
  }
}
