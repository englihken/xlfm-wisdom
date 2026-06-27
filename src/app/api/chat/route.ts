// src/app/api/chat/route.ts
// Main chat endpoint for the 智慧问答 AI chatbot
// Streams responses using Claude API with RAG from Pinecone

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { getSystemPrompt } from '@/lib/system-prompt';
import { searchRelevantTeachings, formatPassagesAsContext } from '@/lib/vector-search';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs'; // Node runtime for Pinecone SDK compatibility
export const maxDuration = 60;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

interface ChatRequest {
  message: string;
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
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
// conversationId to surface back to the client (null if storage is unavailable).
async function persistInbound(params: {
  conversationId?: string;
  browserId?: string;
  language: 'zh' | 'en' | 'id';
  message: string;
}): Promise<{ conversationId: string | null }> {
  if (!supabaseAdmin) return { conversationId: null };

  let contactId: string | null = null;
  let convId: string | null = params.conversationId ?? null;

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

  // Find-or-create conversation.
  try {
    if (!convId) {
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

  return { conversationId: convId };
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

    // Step 1: Search for relevant teachings from vector DB (default top_k = 10)
    const passages = await searchRelevantTeachings(message, undefined, language);
    const contextBlock = formatPassagesAsContext(passages);

    console.log('[chat] Retrieved passages:', passages.map(t => ({ book: t.book, score: t.score.toFixed(3) })));

    // Step 2: Build the system prompt
    const baseSystemPrompt = getSystemPrompt(language);

    // Step 3: Build messages array
    const messages = [
      ...conversation.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      {
        role: 'user' as const,
        content: message,
      },
    ];

    // Step 4: Stream response from Claude.
    // System is split into two blocks so the stable base prompt hits
    // the 5-min ephemeral cache across turns; retrieved RAG context
    // varies per query and stays uncached.
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: [
        {
          type: 'text',
          text: baseSystemPrompt,
          cache_control: { type: 'ephemeral' },
        },
        ...(contextBlock ? [{ type: 'text' as const, text: contextBlock }] : []),
      ],
      messages,
    });

    // Step 5: Build rich sources — deduplicate by book+page combo
    const sourcesMap = new Map<string, {
      book: string;
      page_start?: number;
      page_end?: number;
      excerpt?: string;
      count: number;
    }>();

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

    const sources = Array.from(sourcesMap.values()).slice(0, 3);

    // Resolve storage setup (started concurrently above) so the conversationId
    // is ready to send at the very start of the stream.
    const { conversationId: convId } = await storagePromise;

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
