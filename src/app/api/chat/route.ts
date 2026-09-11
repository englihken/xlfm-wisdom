// src/app/api/chat/route.ts
// Main chat endpoint for the 智慧问答 AI chatbot
// Streams responses using Claude API with RAG from Pinecone

import { NextRequest } from 'next/server';
import { after } from 'next/server';
import { searchRelevantTeachings, formatPassagesAsContext } from '@/lib/vector-search';
import { supabaseAdmin } from '@/lib/supabase';
import {
  buildSources,
  chooseReplyEffort,
  classifyAndSaveCategory,
  crisisFastLaneText,
  flagCrisisByKeywords,
  generateGuardedReplyText,
  retrievalContextFrom,
  REPLY_MODEL,
  type CareMessage,
  type CareSource,
  type ReplyStage,
} from '@/lib/care-pipeline';
import { isAiDraftEnabled } from '@/lib/org-settings';
import { recordReplyFailure } from '@/lib/ops-alerts';
import { processFailedReplies } from '@/lib/reply-recovery';
import { matchChip } from '@/lib/quick-questions';
import { lookupChipAnswer, storeChipAnswer } from '@/lib/chip-answers';
import { detectCrisisKeywords, matchedCrisisKeywords } from '@/lib/crisis-keywords';
import { checkChatRateLimit, RATE_LIMITED_REPLY } from '@/lib/chat-rate-limit';

// F03 request-body limits (batch 2 §3): runtime-validated before any work.
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_TURNS = 20;
const MAX_HISTORY_TURN_CHARS = 6000;
const LANGUAGES = new Set(['zh', 'en', 'id']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateBody(raw: unknown): { ok: true; body: ChatRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid body' };
  const r = raw as Record<string, unknown>;
  const message = typeof r.message === 'string' ? r.message : '';
  if (message.trim().length === 0) return { ok: false, error: 'Message is required' };
  if (message.length > MAX_MESSAGE_CHARS) return { ok: false, error: `Message too long (max ${MAX_MESSAGE_CHARS} chars)` };
  const language = typeof r.language === 'string' && LANGUAGES.has(r.language) ? (r.language as ChatRequest['language']) : 'zh';
  const conversation: ChatRequest['conversation'] = [];
  if (r.conversation !== undefined) {
    if (!Array.isArray(r.conversation)) return { ok: false, error: 'conversation must be an array' };
    if (r.conversation.length > MAX_HISTORY_TURNS) return { ok: false, error: `conversation too long (max ${MAX_HISTORY_TURNS} turns)` };
    for (const t of r.conversation) {
      if (!t || typeof t !== 'object') return { ok: false, error: 'invalid conversation turn' };
      const turn = t as Record<string, unknown>;
      if (turn.role !== 'user' && turn.role !== 'assistant') return { ok: false, error: 'conversation role must be user or assistant' };
      if (typeof turn.content !== 'string' || turn.content.length > MAX_HISTORY_TURN_CHARS) return { ok: false, error: 'invalid conversation turn content' };
      conversation.push({ role: turn.role, content: turn.content });
    }
  }
  const conversationId = typeof r.conversationId === 'string' && UUID_RE.test(r.conversationId) ? r.conversationId : undefined;
  const browserId = typeof r.browserId === 'string' && r.browserId.length > 0 && r.browserId.length <= 64 ? r.browserId : undefined;
  return { ok: true, body: { message, conversation, language, conversationId, browserId } };
}

// Honest message when generation fails after the fast retries (brief "别再把
// 访客弄丢" §3). The visitor's question IS stored (persistInbound ran), it is
// queued for automatic retry, and the care inbox shows it — so we say so.
// Not persisted as an assistant message: that would hide the failure from
// the unanswered stats.
const GENERATION_FAILED_REPLY: Record<string, string> = {
  zh: '不好意思，系统这会儿有点问题，没能马上回你 🙏 你的问题我们已经记下来了，义工会尽快跟进。如果方便，可以留个联系方式。',
  en: "Sorry — the system is having a problem right now and could not answer you immediately 🙏 Your question has been recorded and a volunteer will follow up soon. If convenient, please leave a way to contact you.",
  id: 'Maaf, sistem sedang bermasalah dan belum bisa membalas sekarang 🙏 Pertanyaan Anda sudah kami catat dan relawan akan segera menindaklanjuti. Jika berkenan, tinggalkan kontak Anda.',
};

export const runtime = 'nodejs'; // Node runtime for Pinecone SDK compatibility
// Opus 5 thinks before replying and the verbatim guard may regenerate once, so
// a hard turn can run well past the old 60s. 300s is the Fluid-compute ceiling
// on the Hobby plan.
export const maxDuration = 300;

interface ChatRequest {
  message: string;
  // History may include 'volunteer' turns once a human has replied (they're
  // normalised to 'assistant' before the Claude call — see Step 3).
  conversation?: Array<{ role: 'user' | 'assistant' | 'volunteer'; content: string }>;
  language?: 'zh' | 'en' | 'id';
  conversationId?: string;
  browserId?: string;
}

// ── Conversation storage (Supabase) ───────────────────────────────────────
// CORE PRINCIPLE: every write is non-blocking and fail-safe. If supabaseAdmin
// is null or any write throws, the chat continues perfectly — these helpers
// NEVER throw and NEVER let a storage error reach the user.

// Runs BEFORE streaming (concurrently with retrieval): find-or-create the
// contact + conversation, and save the inbound user message. Returns the
// conversationId to surface back to the client (null if storage is unavailable)
// plus the conversation's current status, so the caller can stay silent when a
// human has taken over ('volunteer_handling').
// Batch 2 §5 (chip <1 s): the contact find-or-create and the ownership check
// run IN PARALLEL (the check needs only browserId + conversationId), and the
// inbound user message is NOT written here — the caller writes it, so a chip
// hit can insert user + assistant in ONE call. Ownership semantics unchanged.
async function persistInbound(params: {
  conversationId?: string;
  browserId?: string;
  language: 'zh' | 'en' | 'id';
}): Promise<{ conversationId: string | null; status: string | null; created: boolean }> {
  if (!supabaseAdmin) return { conversationId: null, status: null, created: false };
  const db = supabaseAdmin;

  let convId: string | null = params.conversationId ?? null;
  // A freshly created conversation is always AI-handled; only an existing one the
  // client passes back could already be under human takeover.
  let status: string | null = params.conversationId ? null : 'ai_handling';

  // Find-or-create contact (web case) by persistent anonymous browserId.
  const contactPromise = (async (): Promise<string | null> => {
    try {
      if (!params.browserId) return null;
      const { data: existing } = await db.from('contacts').select('id').eq('browser_id', params.browserId).maybeSingle();
      if (existing) {
        await db.from('contacts').update({ last_seen: new Date().toISOString() }).eq('id', existing.id);
        return existing.id;
      }
      const { data: created } = await db
        .from('contacts')
        .insert({ channel: 'web', browser_id: params.browserId, display_name: '匿名访客' })
        .select('id')
        .single();
      return created?.id ?? null;
    } catch (e) {
      console.error('[supabase] contact find-or-create failed:', e);
      return null;
    }
  })();

  // OWNERSHIP CHECK (security audit H1): a client-supplied conversationId is only
  // honoured when the conversation's contact belongs to THIS browser — the same check
  // chat/updates does. Anything else (unknown id, no browserId, orphan conversation,
  // different browser) falls through to a NEW conversation instead, so an attacker who
  // learns another visitor's conversation UUID can't inject into their thread.
  const ownershipPromise = (async (): Promise<{ convId: string | null; status: string | null }> => {
    if (!convId) return { convId: null, status };
    try {
      const { data: claimed } = await db
        .from('conversations')
        .select('id, status, contact:contacts ( browser_id )')
        .eq('id', convId)
        .maybeSingle();
      const rawContact = claimed
        ? (claimed as { contact: { browser_id: string | null } | { browser_id: string | null }[] | null }).contact
        : null;
      const contact = Array.isArray(rawContact) ? rawContact[0] ?? null : rawContact;
      const owned = Boolean(
        claimed && params.browserId && contact?.browser_id && contact.browser_id === params.browserId
      );
      if (!owned) {
        console.warn('[chat] conversationId ownership check failed — starting a new conversation');
        return { convId: null, status: 'ai_handling' };
      }
      return { convId, status: (claimed?.status as string | null) ?? status };
    } catch (e) {
      // Fail closed: if we can't verify ownership, don't write into the claimed thread.
      console.error('[supabase] conversation ownership check failed:', e);
      return { convId: null, status: 'ai_handling' };
    }
  })();

  const [contactId, owned] = await Promise.all([contactPromise, ownershipPromise]);
  convId = owned.convId;
  status = owned.status;

  // Find-or-create conversation. For an existing one, its status was read during
  // the ownership check so a human takeover can silence the AI (below).
  let created = false;
  try {
    if (!convId) {
      // Tripwire: a conversation without a contact is an ORPHAN (no browserId supplied) —
      // it can never build a care profile. Surface it in Vercel logs so new orphan sources
      // are visible rather than silently degrading the dashboard.
      if (!contactId) {
        console.warn('[care] conversation created without contact (no browserId)');
      }
      const { data: row } = await db
        .from('conversations')
        .insert({
          channel: 'web',
          status: 'ai_handling',
          language: params.language,
          contact_id: contactId,
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      convId = row?.id ?? null;
      created = Boolean(convId);
    }
  } catch (e) {
    console.error('[supabase] conversation create failed:', e);
    convId = null;
  }

  return { conversationId: convId, status, created };
}

// The inbound user message, written by the caller once it knows whether the
// assistant reply can go in the same insert (chip hit) or must wait for
// generation (normal turn — the question must be on record even if the reply fails).
async function persistUserMessage(conversationId: string | null, content: string): Promise<void> {
  if (!supabaseAdmin || !conversationId) return;
  try {
    await supabaseAdmin.from('messages').insert({ conversation_id: conversationId, role: 'user', content });
  } catch (e) {
    console.error('[supabase] user message save failed:', e);
  }
}

// Chip hit: user + assistant rows in ONE insert; last_message_at bumped only
// when the conversation already existed (a new one was created with it set).
async function persistChipTurn(params: {
  conversationId: string | null;
  created: boolean;
  question: string;
  answer: string;
  sources: unknown;
}): Promise<string | null> {
  if (!supabaseAdmin || !params.conversationId) return null;
  try {
    const { data } = await supabaseAdmin
      .from('messages')
      .insert([
        { conversation_id: params.conversationId, role: 'user', content: params.question },
        { conversation_id: params.conversationId, role: 'assistant', content: params.answer, sources: params.sources },
      ])
      .select('role, created_at');
    if (!params.created) {
      await supabaseAdmin
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', params.conversationId);
    }
    const assistantRow = (data ?? []).find((r) => r.role === 'assistant');
    return (assistantRow?.created_at as string | undefined) ?? new Date().toISOString();
  } catch (e) {
    console.error('[supabase] chip turn save failed:', e);
    return null;
  }
}

// Runs AFTER the reply is final: save the assistant message + bump
// last_message_at. Awaited before [DONE] so the client learns the row's
// timestamp (its late-reply poll starts strictly after it).
async function persistAssistant(params: {
  conversationId: string | null;
  content: string;
  sources: unknown;
}): Promise<string | null> {
  if (!supabaseAdmin || !params.conversationId) return null;
  try {
    const { data } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: params.conversationId,
        role: 'assistant',
        content: params.content,
        sources: params.sources,
      })
      .select('created_at')
      .maybeSingle();
    await supabaseAdmin
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', params.conversationId);
    return (data?.created_at as string | undefined) ?? new Date().toISOString();
  } catch (e) {
    console.error('[supabase] assistant message save failed:', e);
    return null;
  }
}

// Conversation categorisation (the cheap, post-reply classification pass) now
// lives in @/lib/care-pipeline (classifyConversation / classifyAndSaveCategory),
// shared verbatim with the WhatsApp channel.

// ── SSE plumbing ──────────────────────────────────────────────────────────────
// Events the visitor page understands (src/app/qa/page.tsx):
//   stage        — retrieving | drafting | verifying (progress hint, 09-10 §4)
//   conversation — the conversationId to send back on the next turn
//   sources · text · persisted · volunteer_handling · error · [DONE]
// The response is returned BEFORE any work starts so the stage events reach
// the visitor while retrieval and generation run; [DONE] closes the stream
// immediately — classification and the dead-letter drain run in after(), once
// the connection is gone (09-10 §1: the send key used to stay grey for up to
// 60 s while they ran inside the open stream).
type Emit = (event: Record<string, unknown>) => void;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

// Everything that runs AFTER the stream is closed. Bounded so the function
// never nears the 300 s ceiling: classification is one Haiku call; the drain
// answers at most one queued conversation.
async function postReplyWork(params: {
  convId: string | null;
  transcript: CareMessage[];
  generationFailed: boolean;
  chipToStore: Parameters<typeof storeChipAnswer>[0] | null;
}): Promise<void> {
  const { convId, transcript, generationFailed, chipToStore } = params;
  if (chipToStore) {
    const stored = await storeChipAnswer(chipToStore);
    if (stored) console.log(`[chat] chip cache stored key=${chipToStore.chipKey} lang=${chipToStore.language} guard=${chipToStore.guard}`);
  }
  // Categorise the conversation. Fail-safe: never throws. Re-tags on later
  // messages too — last classification wins.
  if (convId && !generationFailed) {
    await classifyAndSaveCategory(convId, transcript);
  }
  // Drain ONE due item from the dead-letter queue (Hobby plan: no
  // minute-level cron). Skipped when this turn itself failed — the API is
  // probably the reason, and the queue would just burn an attempt.
  if (!generationFailed) {
    try {
      const run = await processFailedReplies({ limit: 1, budgetMs: 60_000 });
      if (run.attempted > 0) console.log('[chat] recovery drain', JSON.stringify(run));
    } catch (e) {
      console.error('[chat] recovery drain failed:', e);
    }
  }
}

// One visitor turn, end to end. Emits SSE events through `emit`, returns the
// post-stream work (or null). Never throws for storage reasons; a generation
// failure becomes the honest failure reply.
async function handleTurn(
  body: ChatRequest,
  emit: Emit
): Promise<Parameters<typeof postReplyWork>[0] | null> {
  const { message, conversation = [], language = 'zh', conversationId, browserId } = body;

  emit({ type: 'stage', stage: 'retrieving' satisfies ReplyStage });

  const history: CareMessage[] = conversation
    .filter((msg) => msg.content && msg.content.trim().length > 0)
    .map((msg) => ({
      role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: msg.content,
    }));
  const ctx = retrievalContextFrom(history);
  const messages: CareMessage[] = [...history, { role: 'user', content: message }];

  // F07 crisis fast lane (batch 2 §4): a crisis keyword in the visitor's turn
  // puts the hotline in front of them BEFORE retrieval and generation (R15 ran
  // 107 s end-to-end). The full reply follows as a second text block.
  const crisisText = detectCrisisKeywords(message) ? crisisFastLaneText(language) : null;
  if (crisisText) {
    console.error(`[chat] crisis fast lane keywords=${JSON.stringify(matchedCrisisKeywords(message))}`);
    emit({ type: 'text', text: `${crisisText}\n\n` });
  }

  // Kick off conversation storage concurrently with retrieval so the DB
  // latency overlaps the vector search — near-zero added wall-clock before
  // the first token. persistInbound never throws.
  const storagePromise = persistInbound({ conversationId, browserId, language });

  // Chip cache (09-10 §2, migration 046): one of the six homepage questions,
  // asked as the opening turn, is served from chip_answers when a fresh
  // guard-verified answer exists. Only the opening turn — mid-conversation the
  // history changes the right answer (入门锚定). Looked up in parallel with the
  // AI-draft switch and storage so a hit costs no extra round trip.
  //
  // E3 (brief §3.3): the AI-draft master switch. When 设置 turns it off, the
  // reply pipeline skips Claude entirely — the inbound is stored, the
  // conversation goes straight to the human queue (needs_human), and the
  // client gets the same silent volunteer-handling stream it already knows.
  // Missing key / unreachable table → true (today's behavior).
  const chip = history.length === 0 && !crisisText ? matchChip(message) : null;
  const [aiDraftEnabled, chipHit] = await Promise.all([
    isAiDraftEnabled(),
    chip ? lookupChipAnswer(chip.question, chip.language) : Promise.resolve(null),
  ]);

  // Step 1: Search for relevant teachings from vector DB (default top_k = 10).
  // Context-aware (入门锚定): a short follow-up like 「没有学过」 is retrieved
  // together with the previous visitor turn, and a reply to the beginner
  // triage question is routed onto the 功课 baseline. A volunteer's turn in
  // the history counts as the assistant side (same mapping as Step 3).
  const passages = chipHit ? [] : await searchRelevantTeachings(message, undefined, language, ctx);
  const contextBlock = formatPassagesAsContext(passages);
  if (!chipHit) {
    console.log('[chat] Retrieved passages:', passages.map((t) => ({ book: t.book, score: t.score.toFixed(3) })));
  }

  // Resolve storage (started concurrently with retrieval). We need the status
  // BEFORE deciding whether to call Claude, so a human takeover isn't billed a
  // wasted generation.
  const { conversationId: convId, status, created } = await storagePromise;
  // The visitor's question goes on record now unless a chip hit writes it
  // together with the answer below.
  if (!chipHit) await persistUserMessage(convId, message);
  // Crisis flag lands at this moment too — not after generation (F07).
  if (crisisText && convId) await flagCrisisByKeywords(convId, messages);

  // Send conversationId first (older clients ignore it) so the frontend can
  // persist it and send it back on the next message.
  emit({ type: 'conversation', conversationId: convId });

  // AI drafting disabled (E3): mark the conversation needs_human so it lands
  // in the human queue with NO draft, bump activity, and go silent exactly
  // like a human takeover. Never applies when a volunteer already owns it —
  // that path below stays authoritative.
  if (!aiDraftEnabled && status !== 'volunteer_handling') {
    if (supabaseAdmin && convId) {
      try {
        await supabaseAdmin
          .from('conversations')
          .update({ status: 'needs_human', last_message_at: new Date().toISOString() })
          .eq('id', convId);
      } catch (e) {
        console.error('[chat] needs_human flip failed (ai draft off):', e);
      }
    }
    emit({ type: 'volunteer_handling' });
    return null;
  }

  // PART 2 — AI silence under human takeover. The inbound user message is already
  // persisted (persistInbound); bump last_message_at so it surfaces in the inbox,
  // then stream a single volunteer_handling event (no assistant text) and stop.
  // The human owns this conversation now.
  if (status === 'volunteer_handling') {
    if (supabaseAdmin && convId) {
      try {
        await supabaseAdmin
          .from('conversations')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', convId);
      } catch (e) {
        console.error('[chat] handover last_message_at bump failed:', e);
      }
    }
    emit({ type: 'volunteer_handling' });
    return null;
  }

  // Step 4: Generate the reply through the shared GUARDED pipeline (model +
  // token budget + refusal handling + verbatim/numbers guard identical to the
  // WhatsApp channel). This BUFFERS the whole reply before anything reaches
  // the visitor — a deliberate trade: token-by-token streaming would show
  // fabricated 遍数/开示 before the guard could catch them (convs 29cfd74c /
  // 6b6f74ff). The client receives the text in one event.
  let fullText: string;
  let refused = false;
  let generationFailed = false;
  let sources: CareSource[] = [];
  let chipToStore: Parameters<typeof storeChipAnswer>[0] | null = null;

  if (chipHit) {
    const ageMin = Math.round((Date.now() - new Date(chipHit.generatedAt).getTime()) / 60_000);
    console.log(`[chat] chip cache hit key=${chipHit.chipKey} lang=${chipHit.language} age_min=${ageMin} model=${chipHit.model}`);
    fullText = chipHit.answerText;
    sources = chipHit.sources;
  } else {
    const effort = chooseReplyEffort({ message, messages, ctx });
    try {
      const out = await generateGuardedReplyText({
        messages,
        language,
        passages,
        contextBlock,
        conversationId: convId,
        effort,
        onStage: (stage) => emit({ type: 'stage', stage }),
      });
      fullText = out.fullText;
      refused = out.refused;
      if (chip) {
        chipToStore = {
          chipKey: chip.key,
          language: chip.language,
          question: chip.question,
          answerText: out.fullText,
          sources: [],
          model: REPLY_MODEL,
          guard: out.guard,
          refused: out.refused,
        };
      }
    } catch (genError) {
      // After the SDK's fast retries. Never a silent 500: tell the visitor
      // honestly, record the failure (audit + dead-letter queue), and let the
      // burst alert decide whether Ken gets an email right now.
      generationFailed = true;
      await recordReplyFailure({ conversationId: convId, channel: 'web', error: genError });
      // The classifier will not run for this turn — set the crisis flag from
      // the visitor's own words so 「轻生」 during an outage still tops the inbox.
      if (convId) await flagCrisisByKeywords(convId, messages);
      fullText = GENERATION_FAILED_REPLY[language] ?? GENERATION_FAILED_REPLY.zh;
    }
    // Step 5: Build rich sources — deduplicate by book+page combo (shared helper).
    sources = refused || generationFailed ? [] : buildSources(passages, fullText);
    if (chipToStore) chipToStore.sources = sources;
  }

  // Step 6: Emit the reply. Sources first so the UI can show them immediately,
  // then the full guarded reply as a single text event (appended after the
  // crisis block when one was sent).
  emit({ type: 'sources', sources });
  emit({ type: 'text', text: fullText });
  // What the visitor saw, as one stored message.
  const storedText = crisisText ? `${crisisText}\n\n${fullText}` : fullText;

  // Persist the assistant message BEFORE [DONE] and tell the client its
  // timestamp, so the visitor page's late-reply poll (which also returns
  // recovered assistant replies) can start strictly after it and never
  // re-shows this one. The failure notice is NOT persisted — the conversation
  // must still count as unanswered until recovery lands.
  if (chipHit) {
    const persistedAt = await persistChipTurn({ conversationId: convId, created, question: message, answer: storedText, sources });
    if (persistedAt) emit({ type: 'persisted', createdAt: persistedAt });
  } else if (!generationFailed) {
    const persistedAt = await persistAssistant({ conversationId: convId, content: storedText, sources });
    if (persistedAt) emit({ type: 'persisted', createdAt: persistedAt });
  }

  return {
    convId,
    transcript: [...messages, { role: 'assistant', content: storedText }],
    generationFailed,
    chipToStore,
  };
}

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const validated = validateBody(raw);
  if (!validated.ok) {
    return new Response(JSON.stringify({ error: validated.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const body = validated.body;

  // F03 persistent rate limit (batch 2 §3): browserId + IP, 10-minute windows
  // in Supabase (survives cold starts). Over the limit → 429 with an honest
  // sentence, and NO retrieval or model call — this protects the balance.
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  const limited = await checkChatRateLimit({ browserId: body.browserId, ip });
  if (limited) {
    console.error(`[chat] rate_limited key=${limited.key} count=${limited.count} limit=${limited.limit}`);
    return new Response(
      JSON.stringify({ error: 'rate_limited', message: RATE_LIMITED_REPLY[body.language ?? 'zh'], retryAfterSec: limited.retryAfterSec }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(limited.retryAfterSec) } }
    );
  }

  // Post-stream work is registered with after() HERE, in the request scope, and
  // resolved from inside the stream once [DONE] is out. On Vercel, after() ==
  // waitUntil: the function stays alive until this promise settles, so the
  // classification and the drain really run — without holding the visitor's
  // connection open for them.
  let releasePostWork!: (work: Promise<void>) => void;
  const postWork = new Promise<void>((resolve) => {
    releasePostWork = (work) => resolve(work.catch((e) => console.error('[chat] post-reply work failed:', e)));
  });
  after(() => postWork);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit: Emit = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The visitor navigated away / started a new conversation (AbortController):
          // the controller is gone. Finish the work silently — the reply is
          // persisted anyway and reaches them through the updates poll.
          closed = true;
        }
      };
      let work: Parameters<typeof postReplyWork>[0] | null = null;
      try {
        work = await handleTurn(body, emit);
      } catch (error) {
        console.error('Chat API error:', error);
        emit({ type: 'error', error: 'Streaming failed' });
      }
      if (!closed) {
        try {
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch {
          /* already closed by the client */
        }
        closed = true;
      }
      releasePostWork(work ? postReplyWork(work) : Promise.resolve());
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
