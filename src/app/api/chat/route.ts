// src/app/api/chat/route.ts
// Main chat endpoint for the 智慧问答 AI chatbot
// Streams responses using Claude API with RAG from Pinecone

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { getSystemPrompt } from '@/lib/system-prompt';
import { searchRelevantTeachings, formatPassagesAsContext } from '@/lib/vector-search';

export const runtime = 'nodejs'; // Node runtime for Pinecone SDK compatibility
export const maxDuration = 60;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

interface ChatRequest {
  message: string;
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  language?: 'zh' | 'en' | 'id';
}

export async function POST(req: NextRequest) {
  try {
    const body: ChatRequest = await req.json();
    const { message, conversation = [], language = 'zh' } = body;

    if (!message || message.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Step 1: Search for relevant teachings from vector DB (default top_k = 10)
    const passages = await searchRelevantTeachings(message);
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
    // The base system prompt (~50K tokens, stable across turns) gets a
    // 5-min ephemeral cache breakpoint. Retrieved RAG context is a
    // separate block with no cache_control because it varies per query
    // — caching it would invalidate the whole prefix on every turn.
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

    // Step 6: Convert stream to web ReadableStream
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          // Send sources first so UI can show them immediately
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'sources', sources })}\n\n`
          ));

          // Stream the response text
          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              const data = JSON.stringify({
                type: 'text',
                text: event.delta.text,
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }

          // Log cache stats for monitoring (cache_creation on first call,
          // cache_read on subsequent calls within the 5-min TTL).
          const finalMessage = await stream.finalMessage();
          console.log('[chat] Cache usage:', {
            cache_creation: finalMessage.usage.cache_creation_input_tokens,
            cache_read: finalMessage.usage.cache_read_input_tokens,
            input: finalMessage.usage.input_tokens,
            output: finalMessage.usage.output_tokens,
          });

          // Send done signal
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
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
