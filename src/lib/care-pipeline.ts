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

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Kept in sync with the web chat route (extracted from it verbatim).
const REPLY_MODEL = 'claude-sonnet-4-6';
const REPLY_MAX_TOKENS = 2000;
const MAX_SOURCES = 3;

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
    const key = `${p.book}:${p.page_start ?? 0}`;
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
// Same retrieval + system prompt + model as the web chat, in a single blocking
// call. Retrieval keys off the latest user turn (as the web route does); the full
// message history is passed to Claude for multi-turn context.
export async function generateReply(
  messages: CareMessage[],
  language: Language = 'zh'
): Promise<{ fullText: string; sources: CareSource[] }> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const query = lastUser?.content ?? '';

  const passages = await searchRelevantTeachings(query, undefined, language);
  const contextBlock = formatPassagesAsContext(passages);

  const result = await anthropic.messages.create({
    model: REPLY_MODEL,
    max_tokens: REPLY_MAX_TOKENS,
    system: buildSystemBlocks(language, contextBlock),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const fullText = result.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  return { fullText, sources: buildSources(passages) };
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
      model: REPLY_MODEL,
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

// Classify a conversation and persist the category + crisis overlay onto its row.
// Fully fail-safe (no-ops without storage, never throws). Shared by the web chat
// and WhatsApp so the post-reply tagging behaves identically on both channels.
export async function classifyAndSaveCategory(
  conversationId: string,
  messages: CareMessage[]
): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    const tag = await classifyConversation(messages);
    if (tag) {
      await supabaseAdmin
        .from('conversations')
        .update({ category: tag.category, crisis_flag: tag.crisis_flag })
        .eq('id', conversationId);
    }
  } catch (e) {
    console.error('[classify] category save failed:', e);
  }
}
