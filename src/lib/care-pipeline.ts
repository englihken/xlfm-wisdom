// src/lib/care-pipeline.ts
// The shared "brains" of the care assistant, extracted so BOTH the streaming web
// chat (/api/chat, powering 智慧问答) and the non-streaming WhatsApp channel
// (/api/webhooks/whatsapp) run the exact same RAG retrieval, system prompt,
// Claude model, source-building, and post-reply classification — one source of
// truth, never duplicated.
//
// The web route keeps its own streaming loop; it just calls the shared building
// blocks here (buildSystemBlocks / buildSources / classifyConversation). WhatsApp
// uses generateReply(), a non-streaming single-shot variant with identical inputs.

import Anthropic from '@anthropic-ai/sdk';
import { getSystemPrompt } from './system-prompt';
import {
  searchRelevantTeachings,
  formatPassagesAsContext,
  type RetrievedPassage,
  type RetrievalContext,
} from './vector-search';
import { supabaseAdmin } from './supabase';
import { loadCareCategories } from './org-settings';
import {
  checkDraft,
  stripViolations,
  normalizeForGuard,
  chooseGuardTail,
  scrubContradictoryRefusal,
  hasBlanketRefusal,
  isOverStripped,
  extractNumberTokens,
  type GuardViolation,
  type GuardTail,
} from './verbatim-guard';
import { wisdomEntryIdsInPassages, incrementWisdomUseCounts } from './wisdom-sync';
import { writeAudit } from './audit';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Shared by the web chat route (imported there) and the WhatsApp channel.
// Opus 5 runs with adaptive thinking ON by default, and thinking tokens count
// against max_tokens — so the budget is far above the ~2000-token visible reply
// we actually expect, or thinking would truncate the answer mid-sentence.
export const REPLY_MODEL = 'claude-opus-5';
export const REPLY_MAX_TOKENS = 8000;
// The post-reply categorisation is a one-label task visitors never see — the
// cheapest model is plenty.
const CLASSIFY_MODEL = 'claude-haiku-4-5';
const MAX_SOURCES = 3;

// Opus 5's safety classifiers can decline a request (HTTP 200 with
// stop_reason 'refusal' and empty/partial content). Rare for this bot, but the
// visitor must never be left with a blank bubble — both channels fall back to
// this gentle hand-off instead.
export const REFUSAL_REPLY: Record<Language, string> = {
  zh: '抱歉，这个问题我不方便回答。您可以换一个方式提问，或留下想聊的内容，我们的义工会尽快与您交流 🙏',
  en: "I'm sorry, but I'm not able to answer this question. You could try rephrasing it, or leave a message and one of our volunteers will follow up with you soon 🙏",
  id: 'Maaf, saya tidak dapat menjawab pertanyaan ini. Anda dapat mencoba bertanya dengan cara lain, atau tinggalkan pesan dan relawan kami akan segera menghubungi Anda 🙏',
};

// ── Verbatim guard plumbing (anti-fabrication; see verbatim-guard.ts) ─────────

// Appended to a stripped reply so the visitor knows why numbers are missing.
// ONLY for the case where no counts survive in the reply — after correct
// figures it would contradict them (the 08-16 production defect).
const GUARD_DISCLAIMER: Record<Language, string> = {
  zh: '关于具体的遍数／张数，我目前查不到相关原文，不敢随意告诉您数字。建议咨询就近共修会的义工，以官方资料为准 🙏',
  en: 'I could not find the exact source text for the specific counts involved, so I would rather not quote numbers from memory. Please check with the volunteers at your nearest 共修会 for the official guidance 🙏',
  id: 'Saya tidak menemukan teks sumber untuk jumlah pastinya, jadi saya tidak berani memberikan angka. Silakan tanyakan kepada relawan di 共修会 terdekat untuk panduan resmi 🙏',
};

// Scoped note when SOME number statements were stripped but grounded counts
// remain above. Must never read as "I found no source" — the surviving numbers
// ARE sourced. (Deliberately avoids the 查不到相关原文 / 不敢随意告诉您数字
// phrasing, which regression R9 asserts absent after grounded answers.)
const GUARD_PARTIAL_DISCLAIMER: Record<Language, string> = {
  zh: '补充说明：个别涉及遍数／张数的细节因暂未能核对到原文，已略去未写；以上写出的数字均出自检索到的官方资料。如需进一步确认，请咨询就近共修会的义工 🙏',
  en: 'Note: one or two count-related details were left out because I could not verify them against the source texts; the numbers given above come from the retrieved official materials. For anything further, please check with the volunteers at your nearest 共修会 🙏',
  id: 'Catatan: beberapa detail jumlah dihilangkan karena tidak dapat saya verifikasi dengan teks sumber; angka-angka di atas berasal dari materi resmi yang ditemukan. Silakan konfirmasi lebih lanjut dengan relawan di 共修会 terdekat 🙏',
};

// Full safe answer when stripping leaves nothing usable.
const GUARD_SAFE_REPLY: Record<Language, string> = {
  zh: '抱歉，您问的这个修行细节，我目前查不到相关原文，不方便凭记忆随意回答，以免误导您。建议您联系就近共修会的义工确认，以官方资料为准 🙏\n\n🌐 https://xlfm.my/contact-us',
  en: 'I could not find the source text for this practice detail, and I would rather not answer from memory and risk misleading you. Please confirm with the volunteers at your nearest 共修会 🙏\n\n🌐 https://xlfm.my/contact-us',
  id: 'Maaf, saya tidak menemukan teks sumber untuk detail praktik ini, dan saya tidak ingin menjawab dari ingatan. Silakan konfirmasi dengan relawan di 共修会 terdekat 🙏\n\n🌐 https://xlfm.my/contact-us',
};

// Corrective system block for the single regeneration attempt. TARGETED: it
// names exactly which quote/number failed and why, and tells the model to keep
// every number that IS grounded. The 08-09 version said "no numbers outside
// 组织审定 at all" — so a quote-only trip on a 失眠 answer regenerated with
// zero 遍数 and a 查不到 line (production 08-19→08-29: 14/14 失眠 answers).
function buildRetryInstruction(violations: GuardViolation[]): string {
  const lines: string[] = [
    '【重要纠正】你上一稿有以下内容未通过与检索段落的逐字核对，请重写整个回答：',
  ];
  for (const v of violations) {
    if (v.type === 'quote') {
      const shown = v.text.length > 60 ? `${v.text.slice(0, 60)}…` : v.text;
      lines.push(
        `- 引文「${shown}」不是检索段落的逐字原文：引文块（"> "）必须逐字照抄检索段落；做不到就改为不带引文块的转述，或删去。`
      );
    } else if (v.reason === 'number_not_in_sources') {
      lines.push(
        `- 数字「${v.text}」在本次检索段落和访客原话中都不存在：删去它，或改用检索段落中确实写明的遍数/张数。`
      );
    } else {
      lines.push(
        `- 数字「${v.text}」出现在关于礼佛大忏悔文／特殊日子的段落里，但它不在【组织审定】段落中：这类主题一律以【组织审定】的数字为准，不得提及其他来源的不同数字。`
      );
    }
  }
  lines.push(
    '重写时请遵守：',
    '(1) 检索段落（任何来源）或访客原话中确实出现的 N遍/N张 可以正常使用——上一稿中其他有依据的数字请保留，不要因为个别数字被拦就删掉全部遍数；',
    '(2) 礼佛大忏悔文的遍数、特殊日子的小房子张数，若检索到【组织审定】段落，只能用其中的数字；',
    '(3) 心灵法门例说等案例书、解答来信疑惑／法会弟子提问／玄艺问答／玄艺综述中的数字是台长给某一位同修的个案，只能以"台长对类似情况的开示…情况因人而异"的方式转述，不可当作通用标准或上限；',
    '(4) 只有某个具体遍数/张数在检索段落中确实没有时，才针对该项写"这一项的遍数本次资料中没有写明"；已经给出有依据的数字之后，绝不要再写"查不到相关原文／不敢乱给数字"这类笼统免责。'
  );
  return lines.join('\n');
}

// Over-strip regeneration (conv c47ffe52): the previous draft's 功课 sentences
// were all removed, so the model is told which counts the passages DO carry
// and asked for 经名＋遍数＋祈求词 built only from those.
function buildOverStripInstruction(violations: GuardViolation[], chunkTokens: string[]): string {
  const bad = [...new Set(violations.filter((v) => v.type === 'number').map((v) => v.text))];
  const avail = chunkTokens.length > 0 ? chunkTokens.join('、') : '（本次检索段落中没有任何遍数/张数）';
  return [
    '【重要纠正】你上一稿的功课句子全部被核对系统删除了（数字' +
      (bad.length ? `「${bad.join('」「')}」` : '') +
      '在检索段落中不存在），剩下的回答只有祈求词、没有经名，访客不知道该念什么、念几遍。请重写整个回答：',
    `(1) 检索段落中确实写明的遍数/张数只有：${avail}。功课只能用这些数字，逐字采用，不得改动、不得补充其他数字；`,
    '(2) 每一部经文都要写成「经名 ＋ 遍数 ＋ 祈求词」三件套（例如「📿 《大悲咒》每天N遍，祈求：……」），至少给出一部；',
    '(3) 如果检索段落里完全没有遍数，就只给经名和祈求词，并说明「这一项的遍数本次资料中没有写明」，不要写笼统的「查不到相关原文／不敢给数字」；',
    '(4) 共修会只能作为结尾邀请，不能替代答案。',
  ].join('\n');
}

export type GuardOutcome = 'clean' | 'passed_after_retry' | 'stripped';

// One decision record per guarded reply that the guard touched. Written to
// console (Vercel logs) AND, for real conversations, to audit_log as
// module='care' action='care.guard' record_id=<conversation_id> — so the next
// regression is visible in 系统日志 (filter action=care.guard) without waiting
// for a visitor complaint. No new table: audit_log is append-only jsonb.
export type GuardDecisionLog = {
  outcome: GuardOutcome;
  canonicalPresent: boolean;
  // Every violation from all attempts (3 = the over-strip regeneration), with
  // the reason it failed.
  violations: { attempt: 1 | 2 | 3; type: 'quote' | 'number'; text: string; reason: string }[];
  tail?: GuardTail | 'safe-reply';
  // Stripping left a 祈求词 with no sutra named → an extra regeneration ran.
  overStripRegen?: boolean;
  // N遍/N张 available in the retrieved chunks vs. what the shipped reply states.
  chunkTokens: string[];
  replyTokens: string[];
  // Blanket 查不到/不敢给 sentences removed because the reply states counts.
  scrubbed: string[];
  // A blanket refusal shipped while the chunks DID carry counts — the 08-29
  // regression shape. Not blocked (the model may have had good reason), but
  // it must be countable.
  refusalWithCountsAvailable: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function logGuardDecision(convId: string, log: GuardDecisionLog): Promise<void> {
  const touched =
    log.violations.length > 0 || log.scrubbed.length > 0 || log.refusalWithCountsAvailable;
  if (!touched) return;
  console.error(`[verbatim-guard] conversation=${convId} decision=${JSON.stringify(log)}`);
  // Test harnesses pass labels like 'regression-test' — console only for those.
  if (!UUID_RE.test(convId)) return;
  await writeAudit({
    actorId: null,
    actorEmail: null,
    module: 'care',
    action: 'care.guard',
    tableName: 'conversations',
    recordId: convId,
    after: log,
  });
}

// Generate one guarded reply: draft → mechanical verbatim/numbers check →
// regenerate once with the corrective instruction → strip + disclaimer as the
// last resort. Shared by the web chat (which buffers, then sends) and the
// WhatsApp channel. Every guard trip is logged with the conversation id.
export async function generateGuardedReplyText(params: {
  messages: CareMessage[];
  language: Language;
  passages: RetrievedPassage[];
  contextBlock: string;
  conversationId?: string | null;
}): Promise<{ fullText: string; refused: boolean; guard: GuardOutcome }> {
  const { messages, language, passages, contextBlock } = params;
  const convId = params.conversationId ?? 'unknown';

  // 智库 use_count (P2 §3): a wisdom_ chunk in this reply's retrieved passages
  // counts as a use. Fire-and-forget, service role, never blocks the reply.
  if (supabaseAdmin) {
    const wisdomIds = wisdomEntryIdsInPassages(passages);
    if (wisdomIds.length > 0) void incrementWisdomUseCounts(supabaseAdmin, wisdomIds);
  }

  let modelCalls = 0;
  const callModel = async (extraSystem?: string): Promise<Anthropic.Message> => {
    const system = [
      ...buildSystemBlocks(language, contextBlock),
      ...(extraSystem ? [{ type: 'text' as const, text: extraSystem }] : []),
    ];
    // Streamed under the hood (large max_tokens + thinking would risk HTTP
    // timeouts on a blocking call); the caller still receives the full message.
    const attempt = ++modelCalls;
    const t0 = Date.now();
    let ttfbMs = -1;
    let firstTextMs = -1;
    const stream = anthropic.messages.stream({
      model: REPLY_MODEL,
      max_tokens: REPLY_MAX_TOKENS,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    stream.on('streamEvent', (ev) => {
      if (ttfbMs < 0 && ev.type === 'message_start') ttfbMs = Date.now() - t0;
    });
    stream.on('text', () => {
      if (firstTextMs < 0) firstTextMs = Date.now() - t0;
    });
    const msg = await stream.finalMessage();
    // Latency breakdown (入门轮 brief problem 3): time-to-first-byte, time to
    // the first visible text (thinking sits in between), total, and the
    // prompt-cache split — cache_read ≈ the ~2,860-line system prompt when
    // the 5-minute ephemeral cache hits, cache_creation when it missed.
    const u = msg.usage as Anthropic.Usage & { cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
    console.log(
      `[care-pipeline] timing conversation=${convId} attempt=${attempt} ttfb_ms=${ttfbMs} first_text_ms=${firstTextMs} total_ms=${Date.now() - t0} input=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_create=${u.cache_creation_input_tokens ?? 0} output=${u.output_tokens} stop=${msg.stop_reason}`
    );
    return msg;
  };

  const textOf = (result: Anthropic.Message): string =>
    result.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

  const chunkTexts = passages.map((p) => p.text);
  const visitorTexts = messages.filter((m) => m.role === 'user').map((m) => m.content);
  // 组织审定 canonical chunks: when present, prose 遍数/张数 in paragraphs on
  // the canonical subject (礼佛 / 特殊日子) must come from them (or the
  // visitor). Numbers on any other subject are grounded by ANY retrieved
  // chunk — books, letters, wenda, cases (see verbatim-guard.ts, 08-29 fix).
  const canonicalTexts = passages
    .filter((p) => p.type === 'canonical_ruling')
    .map((p) => p.text);
  const guardOpts = { canonicalTexts };

  const decision: GuardDecisionLog = {
    outcome: 'clean',
    canonicalPresent: canonicalTexts.length > 0,
    violations: [],
    chunkTokens: [...new Set(extractNumberTokens(chunkTexts.join('\n')))],
    replyTokens: [],
    scrubbed: [],
    refusalWithCountsAvailable: false,
  };
  const recordViolations = (attempt: 1 | 2 | 3, violations: GuardViolation[]) => {
    for (const v of violations) {
      console.error(
        `[verbatim-guard] conversation=${convId} violation=${v.type} attempt=${attempt} reason=${v.reason} text=${JSON.stringify(v.text)}`
      );
      decision.violations.push({ attempt, type: v.type, text: v.text, reason: v.reason });
    }
  };

  // Every non-refused reply leaves through here. The contradiction scrub is
  // the final mechanical step: a blanket 「查不到相关原文／不敢乱给数字」
  // sentence next to grounded counts is removed whoever wrote it (the model
  // on a clean pass, or the model following the old retry instruction). Then
  // the decision is logged if the guard did anything at all.
  const finish = async (
    text: string,
    guard: GuardOutcome,
    tail?: GuardTail | 'safe-reply'
  ): Promise<{ fullText: string; refused: boolean; guard: GuardOutcome }> => {
    const scrub = scrubContradictoryRefusal(text);
    decision.outcome = guard;
    decision.tail = tail;
    decision.scrubbed = scrub.removed;
    decision.replyTokens = [...new Set(extractNumberTokens(scrub.text))];
    decision.refusalWithCountsAvailable =
      decision.replyTokens.length === 0 &&
      decision.chunkTokens.length > 0 &&
      hasBlanketRefusal(scrub.text);
    if (scrub.removed.length > 0) {
      console.error(
        `[verbatim-guard] conversation=${convId} scrubbed contradictory refusal: ${JSON.stringify(scrub.removed)}`
      );
    }
    await logGuardDecision(convId, decision);
    return { fullText: scrub.text, refused: false, guard };
  };

  let result = await callModel();
  if (result.stop_reason === 'refusal') {
    console.warn('[care-pipeline] model refused; sending hand-off reply');
    return { fullText: REFUSAL_REPLY[language], refused: true, guard: 'clean' };
  }
  // Observability only (P2 §5): REPLY_MAX_TOKENS=8000 is ~4x the longest reply
  // seen in production, but a genuine cap hit should never again be diagnosable
  // only through a reviewer complaint.
  if (result.stop_reason === 'max_tokens') {
    console.error(`[care-pipeline] conversation=${convId} reply hit REPLY_MAX_TOKENS — truncated mid-reply`);
  }

  let draft = textOf(result);
  let violations = checkDraft(draft, chunkTexts, visitorTexts, guardOpts);
  if (violations.length === 0) return finish(draft, 'clean');
  recordViolations(1, violations);

  // One corrective regeneration, told exactly what failed and what to keep.
  result = await callModel(buildRetryInstruction(violations));
  if (result.stop_reason === 'refusal') {
    console.warn('[care-pipeline] model refused on guard retry; sending hand-off reply');
    return { fullText: REFUSAL_REPLY[language], refused: true, guard: 'passed_after_retry' };
  }
  draft = textOf(result);
  violations = checkDraft(draft, chunkTexts, visitorTexts, guardOpts);
  if (violations.length === 0) return finish(draft, 'passed_after_retry');
  recordViolations(2, violations);

  // Last resort: strip the offending content, then choose a tail that cannot
  // contradict what survived (08-16 defect: blanket 查不到 after correct 21遍).
  let stripped = stripViolations(draft, violations);

  // Over-strip guard (conv c47ffe52): if stripping left a 祈求词 with no sutra
  // named, the 功课 answer was gutted — regenerate once more, telling the
  // model exactly which counts the retrieved passages DO state, instead of
  // shipping a prayer with nothing to pray before. Numbers check unchanged.
  if (isOverStripped(stripped)) {
    console.error(`[verbatim-guard] conversation=${convId} over-stripped (祈求词 without 经名) — regenerating`);
    decision.overStripRegen = true;
    result = await callModel(buildOverStripInstruction(violations, decision.chunkTokens));
    if (result.stop_reason === 'refusal') {
      console.warn('[care-pipeline] model refused on over-strip retry; sending hand-off reply');
      return { fullText: REFUSAL_REPLY[language], refused: true, guard: 'stripped' };
    }
    draft = textOf(result);
    violations = checkDraft(draft, chunkTexts, visitorTexts, guardOpts);
    if (violations.length === 0) return finish(draft, 'passed_after_retry');
    recordViolations(3, violations);
    stripped = stripViolations(draft, violations);
  }

  if (normalizeForGuard(stripped).length < 40) {
    console.error(`[verbatim-guard] conversation=${convId} stripped tail=safe-reply`);
    return finish(GUARD_SAFE_REPLY[language], 'stripped', 'safe-reply');
  }
  const tail = chooseGuardTail(stripped, violations);
  console.error(`[verbatim-guard] conversation=${convId} stripped tail=${tail}`);
  const fullText =
    tail === 'none'
      ? stripped
      : tail === 'partial'
        ? `${stripped}\n\n${GUARD_PARTIAL_DISCLAIMER[language]}`
        : `${stripped}\n\n${GUARD_DISCLAIMER[language]}`;
  return finish(fullText, 'stripped', tail);
}

export type Language = 'zh' | 'en' | 'id';
export type CareMessage = { role: 'user' | 'assistant'; content: string };
export type CareSource = {
  book: string;
  page_start?: number;
  page_end?: number;
  excerpt?: string;
  count: number;
};

// ── Retrieval + prompt assembly (shared by stream + non-stream) ───────────────

// The previous visitor turn and previous assistant turn from a history array
// (everything BEFORE the current message), for context-aware retrieval of
// short follow-ups (入门锚定 brief). Shared by the web route and WhatsApp.
export function retrievalContextFrom(history: CareMessage[]): RetrievalContext {
  const nonEmpty = history.filter((m) => m.content && m.content.trim().length > 0);
  const prevUser = [...nonEmpty].reverse().find((m) => m.role === 'user');
  const prevAssistant = [...nonEmpty].reverse().find((m) => m.role === 'assistant');
  return {
    prevUserMessage: prevUser?.content,
    prevAssistantMessage: prevAssistant?.content,
  };
}

// The two-block system param: the stable base prompt (hits Claude's 5-min
// ephemeral cache across turns) + the per-query RAG context (varies, uncached).
// Byte-identical to the array the web route used inline.
export function buildSystemBlocks(
  language: Language,
  contextBlock: string
): Anthropic.TextBlockParam[] {
  return [
    {
      type: 'text',
      text: getSystemPrompt(language),
      cache_control: { type: 'ephemeral' },
    },
    ...(contextBlock ? [{ type: 'text' as const, text: contextBlock }] : []),
  ];
}

// Deduplicate retrieved passages by book+page into the capped source list the UI
// and dashboard render. Extracted verbatim from the web route's Step 5.
//
// `replyText` (08-30): books the reply itself cites (《白话佛法视频开示（第三册）》
// in the prose) are listed FIRST, so the 参考开示 footer always includes what
// the reader will try to look up — production showed a reply citing 视频开示
// while the top-3 footer listed only 例说 + 解答来信疑惑 (the cited chunk was
// retrieved, just outside the 3 slots).
export function buildSources(passages: RetrievedPassage[], replyText?: string): CareSource[] {
  const cited = replyText ? replyText.replace(/\s+/g, '') : '';
  const ordered = cited
    ? [...passages].sort((a, b) => Number(cited.includes(b.book)) - Number(cited.includes(a.book)))
    : passages;
  const sourcesMap = new Map<string, CareSource>();
  for (const p of ordered) {
    // Pageless sources (组织审定, 解答来信疑惑, 法会弟子提问) dedupe by excerpt
    // (= doc/post title) so two different letters posts stay distinct entries.
    const key = `${p.book}:${p.page_start ?? p.excerpt ?? 0}`;
    const existing = sourcesMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      sourcesMap.set(key, {
        book: p.book,
        page_start: p.page_start,
        page_end: p.page_end,
        excerpt: p.excerpt,
        count: 1,
      });
    }
  }
  return Array.from(sourcesMap.values()).slice(0, MAX_SOURCES);
}

// ── Non-streaming reply (WhatsApp) ────────────────────────────────────────────
// Same retrieval + system prompt + model + verbatim guard as the web chat, in
// one blocking call. Retrieval keys off the latest user turn (as the web route
// does); the full message history is passed to Claude for multi-turn context.
export async function generateReply(
  messages: CareMessage[],
  language: Language = 'zh',
  opts: { conversationId?: string | null } = {}
): Promise<{ fullText: string; sources: CareSource[] }> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const query = lastUser?.content ?? '';

  const passages = await searchRelevantTeachings(
    query,
    undefined,
    language,
    retrievalContextFrom(messages.slice(0, -1))
  );
  const contextBlock = formatPassagesAsContext(passages);

  const { fullText, refused } = await generateGuardedReplyText({
    messages,
    language,
    passages,
    contextBlock,
    conversationId: opts.conversationId,
  });

  return { fullText, sources: refused ? [] : buildSources(passages, fullText) };
}

// ── Conversation categorisation (cheap, post-reply) ───────────────────────────
// Moved verbatim from the web chat route. A tiny classification pass that runs
// AFTER the reply is delivered; never touches the reply text and is fully
// fail-safe (returns null on any failure so the caller leaves the tag untouched).
//
// E3 (brief §3.3): the category list now comes from org_settings
// 'care.categories' (editable in 设置 → 智慧问答设定); this hardcoded list is
// the FALLBACK when the key is missing or unreachable. Off-list answers fold to
// 其他, which is always appended if the configured list omits it.

export const CONVERSATION_CATEGORIES = [
  '感情婚姻', '家庭', '健康', '事业财运', '学业', '人际关系',
  '修行方法', '因果业障', '解梦', '玄学问答', '闲聊测试', '其他',
] as const;
export type ConversationCategory = string;

export async function classifyConversation(
  messages: CareMessage[]
): Promise<{ category: ConversationCategory; crisis_flag: boolean } | null> {
  try {
    // org_settings list with built-in fallback (never throws; null → fallback).
    const configured = await loadCareCategories();
    const categories = configured ?? [...CONVERSATION_CATEGORIES];
    if (!categories.includes('其他')) categories.push('其他');

    // Only the recent turns, as plain transcript text — keeps the call small.
    const transcript = messages
      .slice(-10)
      .map((m) => `${m.role === 'user' ? '访客' : '助手'}: ${m.content}`)
      .join('\n');

    const result = await anthropic.messages.create({
      model: CLASSIFY_MODEL,
      max_tokens: 20,
      messages: [
        {
          role: 'user',
          content:
            'Read this conversation between a person and a Buddhist care assistant. ' +
            'Reply with EXACTLY ONE category label from this list and nothing else:\n' +
            categories.join('、') +
            '\nIf the conversation shows crisis / self-harm / severe distress signals, ' +
            'prefix your answer with "危机:" (e.g. "危机:家庭").\n\n' +
            `对话:\n${transcript}`,
        },
      ],
    });

    const textPart = result.content.find((b) => b.type === 'text');
    let label = textPart && textPart.type === 'text' ? textPart.text.trim() : '';
    if (!label) return null;

    // Crisis overlay: a "危机:" prefix (half- or full-width colon) applies to any
    // category. Strip it off, then validate the remaining label.
    let crisis_flag = false;
    if (label.startsWith('危机:') || label.startsWith('危机：')) {
      crisis_flag = true;
      label = label.replace(/^危机[:：]\s*/, '').trim();
    }

    const category: ConversationCategory = categories.includes(label) ? label : '其他';

    return { category, crisis_flag };
  } catch (e) {
    console.error('[classify] conversation classification failed:', e);
    return null;
  }
}

// ── Crisis-protocol reply detection (P1 §1.4) ────────────────────────────────
// The crisis four-step protocol (system-prompt.ts 第十部分) instructs the model
// to hand out these exact hotline identifiers. A normal reply never mentions
// them, so their presence in an ASSISTANT turn is a mechanical (non-fuzzy)
// signal that the reply activated the protocol. Matching is done on a
// whitespace/dash-stripped lowercase form so "03-7627 2929" == "03 7627 2929".
const CRISIS_REPLY_MARKERS = ['befrienders', '0376272929', 'taliankasih', '15999'];

export function replyActivatesCrisisProtocol(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[\s-]+/g, '');
  return CRISIS_REPLY_MARKERS.some((m) => normalized.includes(m));
}

// Classify a conversation and persist the category + crisis overlay onto its row.
// Fully fail-safe (no-ops without storage, never throws). Shared by the web chat
// and WhatsApp so the post-reply tagging behaves identically on both channels.
//
// crisis_flag: the classifier's judgement OR-ed with the mechanical protocol
// detection over every assistant turn in the transcript (P1 §1.4) — a reply
// that handed out a crisis hotline marks the conversation even if the cheap
// classifier misses it, and re-tagging on a later calm message can't erase a
// protocol activation earlier in the same transcript. Crisis conversations are
// thereby excluded from the nightly review pass (eligibility: crisis_flag=false).
export async function classifyAndSaveCategory(
  conversationId: string,
  messages: CareMessage[]
): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    const mechanicalCrisis = messages.some(
      (m) => m.role === 'assistant' && replyActivatesCrisisProtocol(m.content)
    );
    const tag = await classifyConversation(messages);
    if (tag) {
      await supabaseAdmin
        .from('conversations')
        .update({ category: tag.category, crisis_flag: tag.crisis_flag || mechanicalCrisis })
        .eq('id', conversationId);
    } else if (mechanicalCrisis) {
      // Classifier failed but the protocol trip is certain — persist the flag alone.
      await supabaseAdmin
        .from('conversations')
        .update({ crisis_flag: true })
        .eq('id', conversationId);
    }
  } catch (e) {
    console.error('[classify] category save failed:', e);
  }
}
