// src/app/api/cron/summarize/route.ts
// Daily auto-summary cron (our first scheduled job). Once a conversation has been
// idle 2+ hours, this job folds it into an EVOLVING care summary on its CONTACT —
// cheaply (one small Claude call, bounded batch) and idempotently (each
// conversation is summarised at most once, tracked by conversations.summarized_at).
//
// Triggered by Vercel Cron (see vercel.json), which sends
// `Authorization: Bearer <CRON_SECRET>`. Everything per-conversation is fail-safe:
// any error is caught and logged, and that conversation stays UNMARKED so the next
// run retries it.

import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const IDLE_MS = 2 * 60 * 60 * 1000; // summarise only once idle 2+ hours
const BATCH_LIMIT = 20; // bound cost per run
const MAX_TRANSCRIPT_MESSAGES = 30; // cap transcript length fed to the model
const MAX_MESSAGE_CHARS = 500; // truncate very long individual messages
const JUNK_CATEGORY = '闲聊测试'; // never worth an AI call

type MessageRow = { role: 'user' | 'assistant'; content: string | null };

// Build the model prompt: merge the contact's existing running profile with this
// conversation's transcript into an updated 2–4 sentence care profile. No system
// prompt, no RAG — kept deliberately small.
function buildPrompt(existingSummary: string, transcript: string): string {
  return (
    '你是一位佛教人文关怀助理的记录员。请根据「已有档案」和「本次对话」，' +
    '输出这位来访者的更新版关怀档案。\n\n' +
    '要求：\n' +
    '- 只输出档案正文，不要任何前言、标题、解释或引号。\n' +
    '- 用中文，2–4 句话。\n' +
    '- 涵盖：主要困扰、已给的引导、情绪状态与对修行的开放度。\n' +
    '- 将已有档案与本次对话的新信息融合更新（这位来访者可能是回访者，' +
    '档案应「演进」，而非重新开始）。\n\n' +
    `已有档案：\n${existingSummary.trim() || '（暂无）'}\n\n` +
    `本次对话：\n${transcript}`
  );
}

// One small Claude call. Returns the trimmed profile text, or throws so the caller
// leaves the conversation unmarked for a retry (never overwrite a summary with an
// empty result).
async function generateSummary(existingSummary: string, transcript: string): Promise<string> {
  const result = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 250,
    messages: [{ role: 'user', content: buildPrompt(existingSummary, transcript) }],
  });
  const textPart = result.content.find((b) => b.type === 'text');
  const text = textPart && textPart.type === 'text' ? textPart.text.trim() : '';
  if (!text) throw new Error('empty summary from model');
  return text;
}

export async function GET(req: Request) {
  // Security: Vercel Cron sends a bearer token. Missing env or any mismatch → 401.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ skipped: true });
  }
  const db = supabaseAdmin;

  const idleCutoff = new Date(Date.now() - IDLE_MS).toISOString();

  // Oldest-idle-first, so a backlog drains in age order across successive runs.
  const { data: conversations, error: selectError } = await db
    .from('conversations')
    .select('id, contact_id, category')
    .is('summarized_at', null)
    .lt('last_message_at', idleCutoff)
    .order('last_message_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (selectError) {
    console.error('[cron/summarize] conversation select failed:', selectError);
    return NextResponse.json({ error: 'Select failed' }, { status: 500 });
  }

  let processed = 0;
  let junkSkipped = 0;
  let failed = 0;

  const markSummarized = (id: string) =>
    db.from('conversations').update({ summarized_at: new Date().toISOString() }).eq('id', id);

  for (const conv of conversations ?? []) {
    try {
      // (a) Junk category → mark, no AI call (saves credits on test/chit-chat).
      if (conv.category === JUNK_CATEGORY) {
        await markSummarized(conv.id);
        junkSkipped++;
        continue;
      }

      // (b) Load transcript + contact (with its current running summary).
      const { data: messages, error: msgError } = await db
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: true });
      if (msgError) throw msgError;

      const rows = (messages ?? []) as MessageRow[];
      const hasUserMessage = rows.some((m) => m.role === 'user');

      // No contact to attach the summary to, or nothing the person actually said →
      // treat like junk: mark without an AI call.
      if (!conv.contact_id || !hasUserMessage) {
        await markSummarized(conv.id);
        junkSkipped++;
        continue;
      }

      const { data: contact, error: contactError } = await db
        .from('contacts')
        .select('id, summary')
        .eq('id', conv.contact_id)
        .maybeSingle();
      if (contactError) throw contactError;
      if (!contact) {
        await markSummarized(conv.id);
        junkSkipped++;
        continue;
      }

      const transcript = rows
        .slice(-MAX_TRANSCRIPT_MESSAGES)
        .map((m) => {
          const who = m.role === 'user' ? '访客' : '助手';
          const content = m.content ?? '';
          const clipped =
            content.length > MAX_MESSAGE_CHARS ? `${content.slice(0, MAX_MESSAGE_CHARS)}…` : content;
          return `${who}: ${clipped}`;
        })
        .join('\n');

      // (c) One small Claude call → evolving profile.
      const summary = await generateSummary(contact.summary ?? '', transcript);

      // (d) Save to the CONTACT, then mark the conversation done. Leave
      // conversations.summary untouched (null) for now, per design.
      const { error: updateError } = await db
        .from('contacts')
        .update({ summary })
        .eq('id', contact.id);
      if (updateError) throw updateError;

      const { error: markError } = await markSummarized(conv.id);
      if (markError) throw markError;

      processed++;
    } catch (e) {
      // Fail-safe: log and leave this conversation UNMARKED for the next run.
      console.error(`[cron/summarize] conversation ${conv.id} failed:`, e);
      failed++;
    }
  }

  return NextResponse.json({ processed, junkSkipped, failed });
}
