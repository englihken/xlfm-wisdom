// src/lib/care-summary.ts
// Shared care-summary engine — the ONE place that writes contacts.summary (the
// rolling 有缘人档案) and conversations.summary (本次对话 gist). Three callers:
//   1. the nightly cron (/api/cron/summarize) — the backstop that drains pending
//      conversations in bulk,
//   2. the 接手对话 takeover route — synchronous refresh so the volunteer sees a
//      CURRENT profile + gist at the moment of outreach,
//   3. the conversation-detail GET — background self-heal (via next/server after())
//      when it notices the open contact has pending conversations.
//
// Core design: ONE Claude call per CONTACT folds up to GISTS_PER_CALL of that
// contact's pending conversations into the evolving profile AND yields one gist
// per conversation. Per-contact batching is what fixes the old starvation (one
// call per conversation × 12/day never caught up with arrivals), and it makes
// cross-contact leakage structurally impossible: every transcript in a call
// belongs to the one contact whose profile is being rewritten.

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export const IDLE_MS = 2 * 60 * 60 * 1000; // cron: only fold conversations idle 2h+
export const HEAL_IDLE_MS = 10 * 60 * 1000; // self-heal: skip conversations active in the last 10min
const GISTS_PER_CALL = 6; // max conversations folded per Claude call (prompt-size bound)
const MAX_TRANSCRIPT_MESSAGES = 16; // per conversation, most recent messages
const MAX_MESSAGE_CHARS = 300; // truncate very long individual messages
const GIST_MAX_CHARS = 80; // defensive UI cap
export const JUNK_CATEGORY = '闲聊测试'; // never worth an AI call

// Best-effort throttle for the BACKGROUND self-heal path only (the dashboard polls
// the open conversation every 30s — if the model call keeps failing, we must not
// hammer it every poll). Module-level, so it only survives within a warm serverless
// instance — good enough for a throttle, never relied on for correctness.
const HEAL_THROTTLE_MS = 5 * 60 * 1000;
const lastHealAttempt = new Map<string, number>();

type Db = SupabaseClient;

type PendingConv = {
  id: string;
  category: string | null;
  last_message_at: string;
};

type TranscriptMessage = { role: string; content: string | null; conversation_id: string };

export type RefreshResult = {
  ok: boolean;
  profile: string | null; // the contact profile after this refresh (null = no change)
  profileUpdatedAt: string | null;
  gists: Map<string, string>; // conversation id → freshly written gist
  processed: number; // conversations folded via the model
  marked: number; // junk/empty conversations marked without a model call
  error?: string;
};

const noChange = (error?: string): RefreshResult => ({
  ok: !error,
  profile: null,
  profileUpdatedAt: null,
  gists: new Map(),
  processed: 0,
  marked: 0,
  ...(error ? { error } : {}),
});

// ── Prompt + parsing ─────────────────────────────────────────────────────────

// One call, one contact: merged evolving profile + a numbered gist per conversation.
// Conversations carry their dates so the model can weight the LATEST activity even
// when an older backlog conversation is folded late (cron drains newest-first).
function buildPrompt(existingProfile: string, convs: { date: string; transcript: string }[]): string {
  const blocks = convs
    .map((c, i) => `对话${i + 1}（${c.date}）：\n${c.transcript}`)
    .join('\n\n');
  const gistLines = convs
    .map((_, i) => `对话${i + 1}：<仅概括「对话${i + 1}」这一次的重点，一句话，40 字以内>`)
    .join('\n');
  return (
    '你是一位佛教人文关怀助理的记录员。以下资料全部来自「同一位来访者」：已有档案' +
    '（较早的长期档案，可能为空）以及这位来访者最近的几次对话（按时间先后排列，' +
    '并标注日期）。\n\n' +
    '严格按以下格式输出（每部分各占一行，中文）：\n' +
    '档案：<这位来访者的更新版长期关怀档案，2–4 句话，涵盖主要困扰、已给的引导、' +
    '情绪状态与对修行的开放度；将已有档案与这些对话的新信息融合「演进」，而非重新开始；' +
    '档案必须反映日期最近的对话所显示的当前状态>\n' +
    `${gistLines}\n\n` +
    '要求：\n' +
    '- 只输出上述几行，不要任何前言、标题、解释或引号。\n' +
    '- 「档案」是跨多次对话累积演进的长期档案；每行「对话N」只反映对应那一次对话。\n\n' +
    `已有档案：\n${existingProfile.trim() || '（暂无）'}\n\n${blocks}`
  );
}

// Parse `档案：… / 对话1：… / 对话2：…`. Robust to colon variants; on a full parse
// miss the WHOLE text becomes the profile (a usable evolving profile matters more
// than strict format) and missing gists fall back to a clipped user line upstream.
export function parseBatchSummary(raw: string, count: number): { profile: string; gists: (string | null)[] } {
  const text = raw.trim();
  const profileMatch = text.match(/档案\s*[:：]\s*([\s\S]*?)(?=\n\s*对话\s*\d+\s*[:：]|$)/);
  const profile = profileMatch?.[1]?.trim() ?? '';
  const gists: (string | null)[] = Array.from({ length: count }, () => null);
  const gistRe = /对话\s*(\d+)\s*[:：]\s*([^\n]+)/g;
  for (const m of text.matchAll(gistRe)) {
    const idx = Number(m[1]) - 1;
    if (idx < 0 || idx >= count) continue;
    let gist = m[2].trim();
    if (gist.length > GIST_MAX_CHARS) gist = `${gist.slice(0, GIST_MAX_CHARS).trim()}…`;
    if (gist) gists[idx] = gist;
  }
  if (profile) return { profile, gists };
  return { profile: text, gists }; // parse-failure fallback
}

function formatTranscript(rows: { role: string; content: string | null }[]): string {
  return rows
    .slice(-MAX_TRANSCRIPT_MESSAGES)
    .map((m) => {
      const who = m.role === 'user' ? '访客' : '助手';
      const content = m.content ?? '';
      const clipped =
        content.length > MAX_MESSAGE_CHARS ? `${content.slice(0, MAX_MESSAGE_CHARS)}…` : content;
      return `${who}: ${clipped}`;
    })
    .join('\n');
}

// Degraded gist when the model output misses a 对话N line: the visitor's last
// message, clipped. Worse than a real gist, far better than 待生成 forever.
function fallbackGist(rows: { role: string; content: string | null }[]): string {
  const lastUser = [...rows].reverse().find((m) => m.role === 'user' && m.content?.trim());
  const text = (lastUser?.content ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return '（内容摘要生成失败）';
  return text.length > GIST_MAX_CHARS ? `${text.slice(0, GIST_MAX_CHARS).trim()}…` : text;
}

// ── The per-contact refresh ──────────────────────────────────────────────────

export type RefreshOptions = {
  // Only fold conversations idle since before this cutoff (ISO). Omit = no idle gate.
  idleCutoffIso?: string;
  // Force-include this conversation even if already summarized / not idle —
  // the takeover path, where the volunteer needs the gist of the LIVE conversation.
  forceConversationId?: string;
  // Apply the in-memory throttle (background self-heal only).
  throttled?: boolean;
};

// Regenerate ONE contact's rolling profile from its pending conversations, writing
// per-conversation gists along the way. Strictly scoped: every query below filters
// on this contact's id, so no other contact's messages can ever enter the prompt.
export async function refreshContactSummaries(
  db: Db,
  contactId: string,
  opts: RefreshOptions = {}
): Promise<RefreshResult> {
  if (opts.throttled) {
    const last = lastHealAttempt.get(contactId) ?? 0;
    if (Date.now() - last < HEAL_THROTTLE_MS) return noChange();
    lastHealAttempt.set(contactId, Date.now());
  }

  const { data: contact, error: contactError } = await db
    .from('contacts')
    .select('id, summary')
    .eq('id', contactId)
    .maybeSingle();
  if (contactError) {
    console.error(`[care-summary] contact ${contactId} fetch failed:`, contactError);
    return noChange('contact fetch failed');
  }
  if (!contact) return noChange('contact not found');

  // Pending = this contact's unsummarized conversations (idle-gated when asked),
  // NEWEST first so the profile always reflects the person's latest activity even
  // when an old backlog is still draining. Reversed to chronological for the prompt.
  let pendingQuery = db
    .from('conversations')
    .select('id, category, last_message_at')
    .eq('contact_id', contactId)
    .is('summarized_at', null)
    .order('last_message_at', { ascending: false })
    .limit(GISTS_PER_CALL + 8); // headroom so junk marking still drains extras
  if (opts.idleCutoffIso) pendingQuery = pendingQuery.lt('last_message_at', opts.idleCutoffIso);

  const { data: pendingRows, error: pendingError } = await pendingQuery;
  if (pendingError) {
    console.error(`[care-summary] pending select failed for contact ${contactId}:`, pendingError);
    return noChange('pending select failed');
  }

  let pending = (pendingRows ?? []) as PendingConv[];
  let marked = 0;

  const markOnly = async (convId: string) => {
    const { error } = await db
      .from('conversations')
      .update({ summarized_at: new Date().toISOString() })
      .eq('id', convId);
    if (error) console.error(`[care-summary] mark failed for conversation ${convId}:`, error);
    else marked++;
  };

  // Junk category → mark without a model call (saves credits on test/chit-chat).
  const junk = pending.filter((c) => c.category === JUNK_CATEGORY && c.id !== opts.forceConversationId);
  for (const c of junk) await markOnly(c.id);
  pending = pending.filter((c) => !junk.includes(c));

  // Force-include the takeover conversation (even if summarized/not idle/junk-tagged).
  if (opts.forceConversationId && !pending.some((c) => c.id === opts.forceConversationId)) {
    const { data: forced } = await db
      .from('conversations')
      .select('id, category, last_message_at, contact_id')
      .eq('id', opts.forceConversationId)
      .eq('contact_id', contactId) // scoping: never fold a conversation from another contact
      .maybeSingle();
    if (forced) pending.unshift({ id: forced.id, category: forced.category, last_message_at: forced.last_message_at });
  }

  // Newest GISTS_PER_CALL, then chronological order for the prompt.
  const batchDesc = pending.slice(0, GISTS_PER_CALL);
  const batch = [...batchDesc].sort((a, b) => a.last_message_at.localeCompare(b.last_message_at));
  if (batch.length === 0) return { ...noChange(), marked };

  // Load all transcripts in one query, grouped per conversation.
  const { data: messageRows, error: msgError } = await db
    .from('messages')
    .select('conversation_id, role, content, created_at')
    .in('conversation_id', batch.map((c) => c.id))
    .order('created_at', { ascending: true });
  if (msgError) {
    console.error(`[care-summary] messages fetch failed for contact ${contactId}:`, msgError);
    return { ...noChange('messages fetch failed'), marked };
  }

  const byConv = new Map<string, TranscriptMessage[]>();
  for (const m of (messageRows ?? []) as TranscriptMessage[]) {
    const list = byConv.get(m.conversation_id) ?? [];
    list.push(m);
    byConv.set(m.conversation_id, list);
  }

  // Nothing the person actually said → mark without a model call (like junk).
  const speaking: PendingConv[] = [];
  for (const conv of batch) {
    const rows = byConv.get(conv.id) ?? [];
    if (rows.some((m) => m.role === 'user' && m.content?.trim())) speaking.push(conv);
    else await markOnly(conv.id);
  }
  if (speaking.length === 0) return { ...noChange(), marked };

  const promptConvs = speaking.map((conv) => ({
    date: conv.last_message_at.slice(0, 10),
    transcript: formatTranscript(byConv.get(conv.id) ?? []),
  }));

  // One Claude call → evolving profile + numbered gists. Throws on empty output so
  // the caller leaves everything unmarked for a retry (never blank the profile).
  let profile: string;
  let gists: (string | null)[];
  try {
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300 + 80 * speaking.length,
      messages: [{ role: 'user', content: buildPrompt(contact.summary ?? '', promptConvs) }],
    });
    const textPart = result.content.find((b) => b.type === 'text');
    const text = textPart && textPart.type === 'text' ? textPart.text.trim() : '';
    if (!text) throw new Error('empty summary from model');
    ({ profile, gists } = parseBatchSummary(text, speaking.length));
  } catch (e) {
    console.error(`[care-summary] model call failed for contact ${contactId}:`, e);
    return { ...noChange('model call failed'), marked };
  }

  // Save the EVOLVING profile to the contact…
  const { error: profileError } = await db
    .from('contacts')
    .update({ summary: profile })
    .eq('id', contactId);
  if (profileError) {
    console.error(`[care-summary] profile write failed for contact ${contactId}:`, profileError);
    return { ...noChange('profile write failed'), marked };
  }

  // …then gist + summarized_at per conversation. A parse-missed gist gets the
  // degraded fallback and is STILL marked (logged, never silent) — an endless
  // retry loop would refold the same content into the profile every night.
  const nowIso = new Date().toISOString();
  const gistById = new Map<string, string>();
  let processed = 0;
  for (let i = 0; i < speaking.length; i++) {
    const conv = speaking[i];
    let gist = gists[i];
    if (!gist) {
      console.error(
        `[care-summary] gist missing in model output for conversation ${conv.id} (contact ${contactId}); using fallback`
      );
      gist = fallbackGist(byConv.get(conv.id) ?? []);
    }
    const { error: markError } = await db
      .from('conversations')
      .update({ summary: gist, summarized_at: nowIso })
      .eq('id', conv.id);
    if (markError) {
      console.error(`[care-summary] gist write failed for conversation ${conv.id}:`, markError);
      continue;
    }
    gistById.set(conv.id, gist);
    processed++;
  }

  return {
    ok: true,
    profile,
    profileUpdatedAt: nowIso,
    gists: gistById,
    processed,
    marked,
  };
}

// ── Staleness probe (conversation-detail GET) ────────────────────────────────

// Cheap check: does this contact have any unsummarized conversation that has been
// idle for HEAL_IDLE_MS? (Skips conversations mid-chat — they'll be caught once
// idle, or immediately on takeover.)
export async function contactHasPendingSummaries(db: Db, contactId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - HEAL_IDLE_MS).toISOString();
  const { data, error } = await db
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .is('summarized_at', null)
    .lt('last_message_at', cutoff)
    .limit(1);
  if (error) {
    console.error(`[care-summary] pending probe failed for contact ${contactId}:`, error);
    return false;
  }
  return (data ?? []).length > 0;
}

// When the profile was last refreshed: every profile write is accompanied by
// marking a conversation summarized, so max(summarized_at) over the contact's
// conversations is the honest "档案更新于" timestamp — no schema change needed.
export async function getProfileUpdatedAt(db: Db, contactId: string): Promise<string | null> {
  const { data, error } = await db
    .from('conversations')
    .select('summarized_at')
    .eq('contact_id', contactId)
    .not('summarized_at', 'is', null)
    .order('summarized_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`[care-summary] profile-updated-at probe failed for contact ${contactId}:`, error);
    return null;
  }
  return data?.summarized_at ?? null;
}
