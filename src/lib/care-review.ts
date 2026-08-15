// src/lib/care-review.ts
// P1 quality loop — shared review logic (nightly cron + one-off backfill script).
//
// One review per conversation EVER: conversation_reviews.conversation_id is
// UNIQUE (migration 043, applied by the architect), inserts use ON CONFLICT DO
// NOTHING semantics (upsert ignoreDuplicates), and eligibility is simply "no
// review row yet" — so a failed night self-heals the next night.
//
// The reviewer is Haiku 4.5 (internal bookkeeping, same tier decision as the
// nightly summaries in care-summary.ts). It reads the FULL transcript and
// returns one strict JSON object; anything unparseable is logged and skipped
// (the conversation stays eligible and is retried next run).

export const REVIEW_MODEL = 'claude-haiku-4-5';
// 500, not 300: the first backfill round lost 6.8% of reviews to max_tokens
// truncation mid-JSON (verbose zh reasons). The prompt also caps 字数 now.
export const REVIEW_MAX_TOKENS = 500;

export type ReviewVerdict = 'good' | 'ok' | 'needs_improvement';
export type EmotionalWeight = 'none' | 'light' | 'heavy';

export interface ReviewResult {
  verdict: ReviewVerdict;
  reason: string | null;
  improvement_hint: string | null;
  question_key: string | null;
  emotional_weight: EmotionalWeight;
}

export type TranscriptSource = { book?: string; page_start?: number; page_end?: number };
export type TranscriptMessage = { role: string; content: string; sources?: TranscriptSource[] | null };

// Transcript caps: reviews read the whole conversation, but pathological
// transcripts are trimmed to the newest turns so one conversation can't blow
// the token budget. ASSISTANT turns get a much larger cap than the rest: they
// are the review subject, and the original 1200-char cap sliced complete
// 1,800-3,000-char ENGLISH replies mid-sentence inside the review prompt —
// the reviewer then flagged perfectly complete production replies as
// "truncated" (P2 §5; e.g. 修行-荤素禁忌: cut at char 1171/3024 exactly where
// the cap landed). zh replies (~300-700 chars) never hit it.
const MAX_TURNS = 30;
const MAX_TURN_CHARS = 1200; // user / volunteer turns
const MAX_ASSISTANT_TURN_CHARS = 6000; // never truncate what is being judged

const ROLE_LABEL: Record<string, string> = {
  user: '访客',
  assistant: 'AI助手',
  volunteer: '义工',
};

// Visitor text can carry unpaired UTF-16 surrogates (broken emoji from mobile
// keyboards); JSON.stringify passes them through and the Anthropic API rejects
// the request body ("no low surrogate in string"). Strip lone surrogates.
function wellFormed(s: string): string {
  return s
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

// Render one assistant turn's retrieval sources ([{book, page_start…}] from
// messages.sources) as a compact provenance line for the reviewer.
function sourcesLine(sources: TranscriptSource[] | null | undefined): string {
  if (!sources || sources.length === 0) return '';
  const labels = sources
    .filter((s) => s.book)
    .map((s) => {
      const pages = s.page_start
        ? s.page_start === s.page_end || !s.page_end
          ? ` 第${s.page_start}页`
          : ` 第${s.page_start}-${s.page_end}页`
        : '';
      return `《${s.book}》${pages}`;
    });
  return labels.length > 0 ? `\n〔本回复的检索来源：${labels.join('、')}〕` : '';
}

export function buildReviewPrompt(messages: TranscriptMessage[]): string {
  const turns = messages.slice(-MAX_TURNS).map((m) => {
    const label = ROLE_LABEL[m.role] ?? m.role;
    const raw = wellFormed(m.content);
    const cap = m.role === 'assistant' ? MAX_ASSISTANT_TURN_CHARS : MAX_TURN_CHARS;
    // Re-strip after truncation — slice() can split a valid surrogate pair.
    const content = raw.length > cap ? wellFormed(raw.slice(0, cap)) + '…（记录截断）' : raw;
    const srcLine = m.role === 'assistant' ? sourcesLine(m.sources) : '';
    return `${label}：${content}${srcLine}`;
  });

  return `你是"心灵法门智慧问答"平台的质量审查员。以下是一段访客与 AI 助手的完整对话记录（义工=人工回复，不在审查范围，但可作上下文）。请只审查 AI 助手的回复质量。

════ 对话记录 ════
${turns.join('\n\n')}
════ 记录结束 ════

关于引文与出处（重要）：
- AI 回复中的师父开示引文（"> " 引用块）在发送前已经由系统逐字机械校验过，必须与检索到的原文一字不差才能发出——引文的真实性不需要你验证。
- 每条 AI 回复下方〔本回复的检索来源〕列出了该回复实际检索到的书目。只要来源列表存在，就不要因为"未标注具体出处/页码/日期"而扣分——那是系统层已经保证的事。
- 你要判断的是实质问题：内容是否切题、有没有前后矛盾、语气是否得当、有没有漏答访客明确提出的问题、该承认"查不到原文"时是否承认了。

评审标准（verdict）：
- "good"：回复扎实——内容有依据、切题、语气得当、访客的问题得到了回应
- "ok"：可用但有明显改进空间
- "needs_improvement"：内容错误或无依据、漏答了访客明确提出的问题、语气或处理不当、或应当承认"查不到原文"却给出了含糊/编造的说法

情绪份量（emotional_weight）：
- "heavy"：对话含丧亲、重病、绝望等沉重情绪（但未触发危机协议的对话才会送到你这里）
- "light"：明显的悲伤或焦虑
- "none"：其他

question_key：给对话的核心问题一个简短的规范化中文主题词（格式"主题-子题"，例如 小房子-尺寸 / 失眠-功课 / 解梦-亡人 / 礼佛-遍数 / 设佛台-位置）。闲聊或无实质问题时可用 闲聊-测试。

只输出一个 JSON 对象，不要任何其他文字。reason 和 improvement_hint 各限一句话、60字以内；字符串内部不要使用英文双引号（引用词语请用「」）：
{"verdict":"good|ok|needs_improvement","reason":"一句中文说明判定原因","improvement_hint":"一句中文改进建议（good 时可为空字符串）","question_key":"主题-子题","emotional_weight":"none|light|heavy"}`;
}

const VERDICTS: ReviewVerdict[] = ['good', 'ok', 'needs_improvement'];
const WEIGHTS: EmotionalWeight[] = ['none', 'light', 'heavy'];

// Parse + validate the reviewer's output. Returns null on anything malformed —
// the caller logs and skips; the conversation stays eligible for the next run.
export function parseReviewOutput(text: string): ReviewResult | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;

  const verdict = o.verdict as ReviewVerdict;
  if (!VERDICTS.includes(verdict)) return null;
  const weight = WEIGHTS.includes(o.emotional_weight as EmotionalWeight)
    ? (o.emotional_weight as EmotionalWeight)
    : 'none';

  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    return s ? s.slice(0, max) : null;
  };

  return {
    verdict,
    reason: str(o.reason, 300),
    improvement_hint: str(o.improvement_hint, 300),
    question_key: str(o.question_key, 60),
    emotional_weight: weight,
  };
}

// The insert payload for a conversation_reviews row (status defaults to 'open').
export function reviewRow(conversationId: string, review: ReviewResult, model: string) {
  return {
    conversation_id: conversationId,
    verdict: review.verdict,
    reason: review.reason,
    improvement_hint: review.improvement_hint,
    question_key: review.question_key,
    emotional_weight: review.emotional_weight,
    model,
  };
}

// ── MYT day windows + unanswered counting (§1.3 alarm) ───────────────────────

const MYT_OFFSET_MS = 8 * 3600_000;

/** [start,end) of yesterday and today-so-far in MYT, as UTC ISO strings. */
export function mytDayWindows(nowMs: number) {
  const myt = new Date(nowMs + MYT_OFFSET_MS);
  const todayStart =
    Date.UTC(myt.getUTCFullYear(), myt.getUTCMonth(), myt.getUTCDate()) - MYT_OFFSET_MS;
  return {
    yesterday: {
      start: new Date(todayStart - 86_400_000).toISOString(),
      end: new Date(todayStart).toISOString(),
    },
    today: { start: new Date(todayStart).toISOString(), end: new Date(nowMs).toISOString() },
  };
}

// Minimal query surface so both the cron and the dashboard API can pass the
// supabaseAdmin client without this lib importing server-only modules.
type QueryDb = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/**
 * Conversations created in [start,end) with ≥1 user message and NO reply of
 * any kind — no assistant message and no volunteer reply (human-takeover
 * replies are role='volunteer', written with sent_by, and count as answered).
 */
export async function countUnanswered(db: QueryDb, start: string, end: string): Promise<number> {
  const { data: convs, error } = await db
    .from('conversations')
    .select('id')
    .gte('created_at', start)
    .lt('created_at', end);
  if (error || !convs || convs.length === 0) return 0;

  const ids = (convs as { id: string }[]).map((c) => c.id);
  const { data: msgs } = await db
    .from('messages')
    .select('conversation_id, role')
    .in('conversation_id', ids);

  const hasUser = new Set<string>();
  const hasReply = new Set<string>();
  for (const m of (msgs ?? []) as { conversation_id: string; role: string }[]) {
    if (m.role === 'user') hasUser.add(m.conversation_id);
    else if (m.role === 'assistant' || m.role === 'volunteer') hasReply.add(m.conversation_id);
  }
  let n = 0;
  for (const id of ids) if (hasUser.has(id) && !hasReply.has(id)) n++;
  return n;
}
