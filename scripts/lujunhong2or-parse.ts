// scripts/lujunhong2or-parse.ts
// Parser for lujunhong2or.com WordPress posts (corpus Phase A):
//   开示解答来信疑惑 (letters) and 法会弟子提问 (fahui).
//
// A post's content.rendered is a sequence of <p> paragraphs. Exchanges are
// separated by <p>&nbsp;</p> spacer paragraphs. One exchange = one or more
// 问：/答： turns (follow-up 问/答 inside the same spacer group belong to the
// same letter/question and stay together in ONE chunk). 法会 posts additionally
// open each exchange with a bold heading paragraph, and may end with a
// 台长语： block (answer-only — kept as a chunk, it is verbatim 台长 content).
//
// Format variants are tolerated; posts that yield NO exchange are reported as
// unparseable and NEVER guessed at (brief Task 2).
//
// Shared by upload-lujunhong2or.ts and test-lujunhong2or-parse.ts.

export interface WpPost {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  date: string;     // WP publish date (site-local ISO, no zone)
  modified: string;
  content: { rendered: string };
}

export type SourceKind = 'letters' | 'fahui';

export interface QaChunk {
  /** Fixed Pinecone id: letters_{postId}_{n} / fahui_{postId}_{n}, n 1-based */
  id: string;
  postId: number;
  index: number;
  /** Bold section heading (法会 posts), when present */
  heading?: string;
  /** Full chunk text: 【post title】 + heading + 问/答 turns */
  text: string;
}

export interface Unparseable {
  postId: number;
  title: string;
  reason: string;
}

export interface PostParse {
  chunks: QaChunk[];
  /** Non-fatal oddities worth logging (skipped substantial non-Q&A groups) */
  warnings: string[];
}

// ── HTML → text ───────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  hellip: '…', mdash: '—', ndash: '–', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', middot: '·',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

/**
 * Render post HTML into lines, one per paragraph. A paragraph containing only
 * whitespace/&nbsp; becomes an EMPTY line — that is the exchange separator.
 * Raw newlines BETWEEN tags are formatting noise and must NOT create lines,
 * so we extract <p>…</p> blocks explicitly rather than splitting on \n.
 */
export function htmlToLines(html: string): string[] {
  const paras = html.match(/<(p|h[1-6]|li|blockquote)\b[^>]*>[\s\S]*?<\/\1>/gi);
  // Fallback for posts that aren't a flat <p> sequence: blank-line paragraphs.
  const blocks = paras ?? html.split(/\n{2,}/g);
  return blocks.flatMap((b) => {
    // <br> inside a paragraph is a real line break (the 五十七…六十三 letters
    // put 问N：<br>答N： inside ONE <p>) — split before stripping tags.
    const parts = b.split(/<br\s*\/?>/gi).map((part) =>
      decodeEntities(part.replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim()
    );
    const nonEmpty = parts.filter((p) => p !== '');
    // A paragraph that strips to nothing IS the exchange separator line.
    return nonEmpty.length > 0 ? nonEmpty : [''];
  });
}

// ── Structure detection ───────────────────────────────────────────────────────

// 问：/ 问1： / 问: / 问1、… — half/full-width colon, or the enumeration
// comma the early letters series (五十二…六十三) uses after a number.
const Q_RE = /^问\s*[0-9０-９一二三四五六七八九十]*\s*[：:、.．]/;
const A_RE = /^答\s*[0-9０-９一二三四五六七八九十]*\s*[：:、.．]/;
// 台长语：/ 师父语： — answer-only closing blocks in 法会 posts
const SHIFU_RE = /^(台长语|师父语|师父开示)\s*[：:]/;

/** （开示于2015年8月17日）→ '2015-08-17'; null when absent (brief Task 2). */
export function extractOriginalDate(title: string): string | null {
  const m = decodeEntities(title).match(/开示于\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

interface Group {
  heading?: string;
  turns: string[];   // lines starting with 问/答/台长语
  strayLines: string[]; // non-empty lines that are neither heading nor turn
}

/** Split lines into &nbsp;-separated groups and classify each line. */
function groupLines(lines: string[]): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  for (const line of lines) {
    if (line === '') {
      if (cur) groups.push(cur);
      cur = null;
      continue;
    }
    cur ??= { turns: [], strayLines: [] };
    if (Q_RE.test(line) || A_RE.test(line) || SHIFU_RE.test(line)) {
      cur.turns.push(line);
    } else if (cur.turns.length === 0 && cur.heading === undefined) {
      // First non-turn line before any 问/答 in this group: section heading
      cur.heading = line;
    } else if (cur.turns.length > 0) {
      // Continuation paragraph of the previous turn (multi-paragraph answer)
      cur.turns[cur.turns.length - 1] += '\n' + line;
    } else {
      cur.strayLines.push(line);
    }
  }
  if (cur) groups.push(cur);
  return groups;
}

/** A group is a usable exchange when it has an answer-shaped turn. */
function isExchange(g: Group): boolean {
  return g.turns.some((t) => A_RE.test(t) || SHIFU_RE.test(t));
}

// A single spacer-less group holding many independent pairs (format variant):
// only split it when clearly oversized, at 问-boundaries, one pair per chunk.
const SINGLE_GROUP_SPLIT_THRESHOLD = 2000;

function splitOversizedGroup(g: Group): Group[] {
  const out: Group[] = [];
  let cur: Group | null = null;
  for (const turn of g.turns) {
    if (Q_RE.test(turn) || cur === null) {
      if (cur) out.push(cur);
      // No heading carry-over: in spacer-less letters posts the group "heading"
      // is the 东方台编者按 boilerplate, not a per-exchange title.
      cur = { turns: [], strayLines: [] };
    }
    cur.turns.push(turn);
  }
  if (cur) out.push(cur);
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function parsePost(post: WpPost, kind: SourceKind): PostParse {
  const title = decodeEntities(post.title.rendered).trim();
  const lines = htmlToLines(post.content.rendered);
  let groups = groupLines(lines).filter((g) => g.turns.length > 0 || g.heading || g.strayLines.length > 0);

  const warnings: string[] = [];

  // Format variant: no spacer paragraphs at all → one giant group. Split into
  // pairs only when clearly oversized (keeps follow-up 问/答 together otherwise).
  const exchangeGroups = groups.filter(isExchange);
  if (exchangeGroups.length === 1) {
    const g = exchangeGroups[0];
    const totalLen = g.turns.join('').length;
    const qCount = g.turns.filter((t) => Q_RE.test(t)).length;
    if (totalLen > SINGLE_GROUP_SPLIT_THRESHOLD && qCount > 1) {
      warnings.push(`post ${post.id}: single ${totalLen}-char group with ${qCount} 问 — split at 问-boundaries`);
      groups = groups.flatMap((x) => (x === g ? splitOversizedGroup(x) : [x]));
    }
  }

  const chunks: QaChunk[] = [];
  for (const g of groups) {
    if (!isExchange(g)) {
      const strayText = [g.heading ?? '', ...g.strayLines].join('').trim();
      if (strayText.length > 30) {
        warnings.push(`post ${post.id}: skipped non-Q&A group (${strayText.length} chars): ${strayText.slice(0, 40)}…`);
      }
      continue;
    }
    const n = chunks.length + 1;
    const body = g.turns.join('\n');
    const headingLine = g.heading ? `${g.heading}\n` : '';
    chunks.push({
      id: `${kind}_${post.id}_${n}`,
      postId: post.id,
      index: n,
      heading: g.heading,
      // Post title prepended for context (brief Task 2) — same 【…】 convention
      // as the canonical_libai chunks.
      text: `【${title}】\n${headingLine}${body}`,
    });
  }

  return { chunks, warnings };
}

export interface CorpusParse {
  chunks: QaChunk[];
  unparseable: Unparseable[];
  warnings: string[];
  perPost: Map<number, number>; // postId → chunk count
}

export function parsePosts(posts: WpPost[], kind: SourceKind): CorpusParse {
  const all: QaChunk[] = [];
  const unparseable: Unparseable[] = [];
  const warnings: string[] = [];
  const perPost = new Map<number, number>();
  for (const post of posts) {
    const { chunks, warnings: w } = parsePost(post, kind);
    warnings.push(...w);
    if (chunks.length === 0) {
      unparseable.push({
        postId: post.id,
        title: decodeEntities(post.title.rendered).trim(),
        reason: 'no 问/答 exchange found',
      });
      continue;
    }
    perPost.set(post.id, chunks.length);
    all.push(...chunks);
  }
  return { chunks: all, unparseable, warnings, perPost };
}
