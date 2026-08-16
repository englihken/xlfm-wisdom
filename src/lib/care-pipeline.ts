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
} from './vector-search';
import { supabaseAdmin } from './supabase';
import { loadCareCategories } from './org-settings';
import { checkDraft, stripViolations, normalizeForGuard, chooseGuardTail } from './verbatim-guard';
import { wisdomEntryIdsInPassages, incrementWisdomUseCounts } from './wisdom-sync';

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

// Corrective system block for the single regeneration attempt.
const GUARD_RETRY_INSTRUCTION =
  '【重要纠正】你上一稿包含了检索资料中不存在（或不允许使用）的引文或遍数/张数。请重写回答，严格遵守：' +
  '(1) 所有引用（"> " 引文块）必须逐字来自上方提供的检索段落，不得改写、拼接，也不得把访客的话转述成师父开示；' +
  '(2) 检索段落中若包含【组织审定】内容，其中的遍数/张数就是唯一标准答案——直接给出该数字，' +
  '不要提及、对比或罗列其他来源（旧版书籍、听众提问等）中的不同数字；' +
  '(3) 除【组织审定】段落和访客自己说过的数字外，正文中不得出现其他 N遍/N张 数字（逐字引文块内的数字除外）；' +
  '(4) 如果所需的具体遍数/张数在检索段落中查不到，明确说明"目前查不到相关原文"，并建议访客咨询就近共修会义工。';

export type GuardOutcome = 'clean' | 'passed_after_retry' | 'stripped';

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

  const callModel = async (extraSystem?: string): Promise<Anthropic.Message> => {
    const system = [
      ...buildSystemBlocks(language, contextBlock),
      ...(extraSystem ? [{ type: 'text' as const, text: extraSystem }] : []),
    ];
    // Streamed under the hood (large max_tokens + thinking would risk HTTP
    // timeouts on a blocking call); the caller still receives the full message.
    const stream = anthropic.messages.stream({
      model: REPLY_MODEL,
      max_tokens: REPLY_MAX_TOKENS,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    return stream.finalMessage();
  };

  const textOf = (result: Anthropic.Message): string =>
    result.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

  const chunkTexts = passages.map((p) => p.text);
  const visitorTexts = messages.filter((m) => m.role === 'user').map((m) => m.content);
  // 组织审定 canonical chunks: when present, prose 遍数/张数 must come from
  // them (or the visitor) — numbers found only in ordinary book chunks are
  // rejected (see verbatim-guard.ts).
  const canonicalTexts = passages
    .filter((p) => p.type === 'canonical_ruling')
    .map((p) => p.text);
  const guardOpts = { canonicalTexts };

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
  if (violations.length === 0) return { fullText: draft, refused: false, guard: 'clean' };

  for (const v of violations) {
    console.error(
      `[verbatim-guard] conversation=${convId} violation=${v.type} attempt=1 text=${JSON.stringify(v.text)}`
    );
  }

  // One corrective regeneration.
  result = await callModel(GUARD_RETRY_INSTRUCTION);
  if (result.stop_reason === 'refusal') {
    console.warn('[care-pipeline] model refused on guard retry; sending hand-off reply');
    return { fullText: REFUSAL_REPLY[language], refused: true, guard: 'passed_after_retry' };
  }
  draft = textOf(result);
  violations = checkDraft(draft, chunkTexts, visitorTexts, guardOpts);
  if (violations.length === 0) {
    return { fullText: draft, refused: false, guard: 'passed_after_retry' };
  }

  for (const v of violations) {
    console.error(
      `[verbatim-guard] conversation=${convId} violation=${v.type} attempt=2 text=${JSON.stringify(v.text)}`
    );
  }

  // Last resort: strip the offending content, then choose a tail that cannot
  // contradict what survived (08-16 defect: blanket 查不到 after correct 21遍).
  const stripped = stripViolations(draft, violations);
  if (normalizeForGuard(stripped).length < 40) {
    console.error(`[verbatim-guard] conversation=${convId} stripped tail=safe-reply`);
    return { fullText: GUARD_SAFE_REPLY[language], refused: false, guard: 'stripped' };
  }
  const tail = chooseGuardTail(stripped, violations);
  console.error(`[verbatim-guard] conversation=${convId} stripped tail=${tail}`);
  const fullText =
    tail === 'none'
      ? stripped
      : tail === 'partial'
        ? `${stripped}\n\n${GUARD_PARTIAL_DISCLAIMER[language]}`
        : `${stripped}\n\n${GUARD_DISCLAIMER[language]}`;
  return { fullText, refused: false, guard: 'stripped' };
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
export function buildSources(passages: RetrievedPassage[]): CareSource[] {
  const sourcesMap = new Map<string, CareSource>();
  for (const p of passages) {
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

  const passages = await searchRelevantTeachings(query, undefined, language);
  const contextBlock = formatPassagesAsContext(passages);

  const { fullText, refused } = await generateGuardedReplyText({
    messages,
    language,
    passages,
    contextBlock,
    conversationId: opts.conversationId,
  });

  return { fullText, sources: refused ? [] : buildSources(passages) };
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
