// src/app/api/chat/route.ts
// Main chat endpoint for the 智慧问答 AI chatbot
// Streams responses using Claude API with RAG from Pinecone

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { searchRelevantTeachings, formatPassagesAsContext } from '@/lib/vector-search';
import { supabaseAdmin } from '@/lib/supabase';
import { buildSystemBlocks, buildSources, classifyAndSaveCategory } from '@/lib/care-pipeline';
import { isAiDraftEnabled } from '@/lib/org-settings';

export const runtime = 'nodejs'; // Node runtime for Pinecone SDK compatibility
export const maxDuration = 60;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

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
async function persistInbound(params: {
  conversationId?: string;
  browserId?: string;
  language: 'zh' | 'en' | 'id';
  message: string;
}): Promise<{ conversationId: string | null; status: string | null }> {
  if (!supabaseAdmin) return { conversationId: null, status: null };

  let contactId: string | null = null;
  let convId: string | null = params.conversationId ?? null;
  // A freshly created conversation is always AI-handled; only an existing one the
  // client passes back could already be under human takeover.
  let status: string | null = params.conversationId ? null : 'ai_handling';

  // Find-or-create contact (web case) by persistent anonymous browserId.
  try {
    if (params.browserId) {
      const { data: existing } = await supabaseAdmin
        .from('contacts')
        .select('id')
        .eq('browser_id', params.browserId)
        .maybeSingle();

      if (existing) {
        contactId = existing.id;
        await supabaseAdmin
          .from('contacts')
          .update({ last_seen: new Date().toISOString() })
          .eq('id', contactId);
      } else {
        const { data: created } = await supabaseAdmin
          .from('contacts')
          .insert({ channel: 'web', browser_id: params.browserId, display_name: '匿名访客' })
          .select('id')
          .single();
        contactId = created?.id ?? null;
      }
    }
  } catch (e) {
    console.error('[supabase] contact find-or-create failed:', e);
    contactId = null;
  }

  // OWNERSHIP CHECK (security audit H1): a client-supplied conversationId is only
  // honoured when the conversation's contact belongs to THIS browser — the same check
  // chat/updates does. Anything else (unknown id, no browserId, orphan conversation,
  // different browser) falls through to a NEW conversation instead, so an attacker who
  // learns another visitor's conversation UUID can't inject into their thread.
  try {
    if (convId) {
      const { data: claimed } = await supabaseAdmin
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
        convId = null;
        status = 'ai_handling';
      } else {
        status = (claimed?.status as string | null) ?? status;
      }
    }
  } catch (e) {
    // Fail closed: if we can't verify ownership, don't write into the claimed thread.
    console.error('[supabase] conversation ownership check failed:', e);
    convId = null;
    status = 'ai_handling';
  }

  // Find-or-create conversation. For an existing one, read back its status so a
  // human takeover can silence the AI (below).
  try {
    if (!convId) {
      // Tripwire: a conversation without a contact is an ORPHAN (no browserId supplied) —
      // it can never build a care profile. Surface it in Vercel logs so new orphan sources
      // are visible rather than silently degrading the dashboard.
      if (!contactId) {
        console.warn('[care] conversation created without contact (no browserId)');
      }
      const { data: created } = await supabaseAdmin
        .from('conversations')
        .insert({
          channel: 'web',
          status: 'ai_handling',
          language: params.language,
          contact_id: contactId,
        })
        .select('id')
        .single();
      convId = created?.id ?? null;
    }
    // (an existing convId already had its status read during the ownership check)
  } catch (e) {
    console.error('[supabase] conversation create failed:', e);
    convId = null;
  }

  // Save the inbound user message.
  try {
    if (convId) {
      await supabaseAdmin
        .from('messages')
        .insert({ conversation_id: convId, role: 'user', content: params.message });
    }
  } catch (e) {
    console.error('[supabase] user message save failed:', e);
  }

  return { conversationId: convId, status };
}

// Runs AFTER the full reply streams: save the assistant message + bump
// last_message_at. Awaited before the stream closes (keeps the Vercel lambda
// alive so the write lands) but only after [DONE] is sent to the client.
async function persistAssistant(params: {
  conversationId: string | null;
  content: string;
  sources: unknown;
}): Promise<void> {
  if (!supabaseAdmin || !params.conversationId) return;
  try {
    await supabaseAdmin.from('messages').insert({
      conversation_id: params.conversationId,
      role: 'assistant',
      content: params.content,
      sources: params.sources,
    });
    await supabaseAdmin
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', params.conversationId);
  } catch (e) {
    console.error('[supabase] assistant message save failed:', e);
  }
}

// Conversation categorisation (the cheap, post-reply classification pass) now
// lives in @/lib/care-pipeline (classifyConversation / classifyAndSaveCategory),
// shared verbatim with the WhatsApp channel.

export async function POST(req: NextRequest) {
  try {
    const body: ChatRequest = await req.json();
    const { message, conversation = [], language = 'zh', conversationId, browserId } = body;

    if (!message || message.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Kick off conversation storage concurrently with retrieval so the DB
    // latency overlaps the vector search — near-zero added wall-clock before
    // the first token. persistInbound never throws.
    const storagePromise = persistInbound({ conversationId, browserId, language, message });

    // E3 (brief §3.3): the AI-draft master switch. When 设置 turns it off, the
    // reply pipeline skips Claude entirely — the inbound is stored, the
    // conversation goes straight to the human queue (needs_human), and the
    // client gets the same silent volunteer-handling stream it already knows.
    // Missing key / unreachable table → true (today's behavior).
    const aiDraftEnabled = await isAiDraftEnabled();

    // Step 1: Search for relevant teachings from vector DB (default top_k = 10)
    const passages = await searchRelevantTeachings(message, undefined, language);
    const contextBlock = formatPassagesAsContext(passages);

    console.log('[chat] Retrieved passages:', passages.map(t => ({ book: t.book, score: t.score.toFixed(3) })));

    // Resolve storage (started concurrently with retrieval). We need the status
    // BEFORE deciding whether to call Claude, so a human takeover isn't billed a
    // wasted generation.
    const { conversationId: convId, status } = await storagePromise;

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
      const encoder = new TextEncoder();
      const silentStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'conversation', conversationId: convId })}\n\n`
          ));
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'volunteer_handling' })}\n\n`
          ));
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });
      return new Response(silentStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
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
      const encoder = new TextEncoder();
      const silentStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'conversation', conversationId: convId })}\n\n`
          ));
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'volunteer_handling' })}\n\n`
          ));
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });
      return new Response(silentStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // Step 3: Build the messages array for Claude. Normalise history roles —
    // Anthropic only accepts 'user'|'assistant', but after a human takeover the
    // history can carry 'volunteer' turns; a volunteer's reply is prior
    // assistant-side context from the model's POV, so it maps to 'assistant'.
    // Empty/whitespace-only turns (e.g. an aborted streaming placeholder) are
    // dropped defensively.
    const messages = [
      ...conversation
        .filter((msg) => msg.content && msg.content.trim().length > 0)
        .map((msg) => ({
          role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
          content: msg.content,
        })),
      {
        role: 'user' as const,
        content: message,
      },
    ];

    // Step 4: Stream response from Claude. The system param (stable base prompt +
    // per-query RAG context, base block cached) is assembled by the shared pipeline.
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: buildSystemBlocks(language, contextBlock),
      messages,
    });

    // Step 5: Build rich sources — deduplicate by book+page combo (shared helper).
    const sources = buildSources(passages);

    // Step 6: Convert stream to web ReadableStream
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        let fullText = '';
        try {
          // Send conversationId first (new event type — older clients ignore it)
          // so the frontend can persist it and send it back on the next message.
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'conversation', conversationId: convId })}\n\n`
          ));

          // Send sources next so UI can show them immediately
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'sources', sources })}\n\n`
          ));

          // Stream the response text
          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              fullText += event.delta.text;
              const data = JSON.stringify({
                type: 'text',
                text: event.delta.text,
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }

          // Send done signal first so the UI flips out of "streaming" instantly,
          // THEN await the assistant-message save before closing — this keeps the
          // Vercel lambda alive long enough for the write to land. The reply text
          // is already fully delivered, so this never slows the visible reply.
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          await persistAssistant({ conversationId: convId, content: fullText, sources });

          // Categorise the conversation in the same keep-alive window. The user
          // already has their full reply, so this adds ZERO visible latency.
          // Fail-safe: never throws, never blocks the chat. Re-tags on later
          // messages too — last classification wins.
          if (convId) {
            await classifyAndSaveCategory(convId, [
              ...messages,
              { role: 'assistant', content: fullText },
            ]);
          }

          controller.close();
        } catch (error) {
          console.error('Streaming error:', error);
          const errorData = JSON.stringify({
            type: 'error',
            error: 'Streaming failed',
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
