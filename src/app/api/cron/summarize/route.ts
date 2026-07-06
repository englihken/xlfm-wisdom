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
const BATCH_LIMIT = 12; // bound cost per run
const TIME_BUDGET_MS = 45_000; // stop before Vercel's 60s maxDuration kills us mid-run
const MAX_TRANSCRIPT_MESSAGES = 30; // cap transcript length fed to the model
const MAX_MESSAGE_CHARS = 500; // truncate very long individual messages
const JUNK_CATEGORY = '闲聊测试'; // never worth an AI call

type MessageRow = { role: 'user' | 'assistant'; content: string | null };

// Build the model prompt: in ONE call, produce two labelled parts — (档案) the merged,
// evolving long-term care profile for the CONTACT, and (本次) a one-line gist of THIS
// conversation only. No system prompt, no RAG — kept deliberately small.
function buildPrompt(existingSummary: string, transcript: string): string {
  return (
    '你是一位佛教人文关怀助理的记录员。请根据「已有档案」和「本次对话」，输出两部分内容。\n\n' +
    '严格按以下两行格式输出（各占一行，中文）：\n' +
    '档案：<这位来访者的更新版长期关怀档案，2–4 句话，涵盖主要困扰、已给的引导、' +
    '情绪状态与对修行的开放度；将已有档案与本次对话的新信息融合「演进」，而非重新开始>\n' +
    '本次：<仅概括「本次对话」这一次的重点，一句话，40 字以内>\n\n' +
    '要求：\n' +
    '- 只输出上述两行，不要任何前言、标题、解释或引号。\n' +
    '- 「档案」是跨多次对话累积演进的长期档案；「本次」只反映这一次对话。\n\n' +
    `已有档案：\n${existingSummary.trim() || '（暂无）'}\n\n` +
    `本次对话：\n${transcript}`
  );
}

// Parse the two-part model output. Robust to colon variants (：/:) and a missing 本次
// label. On ANY parse miss the WHOLE text becomes the profile and the gist is null — a
// usable evolving profile matters more than a strict format, and the run must never fail.
function parseSummary(raw: string): { profile: string; gist: string | null } {
  const text = raw.trim();
  const profileMatch = text.match(/档案\s*[:：]\s*([\s\S]*?)(?=\n\s*本次\s*[:：]|$)/);
  const gistMatch = text.match(/本次\s*[:：]\s*([\s\S]+)$/);
  const profile = profileMatch?.[1]?.trim() ?? '';
  let gist = (gistMatch?.[1] ?? '').trim().split('\n')[0].trim();
  if (gist.length > 80) gist = `${gist.slice(0, 80).trim()}…`; // defensive UI cap
  if (profile) return { profile, gist: gist || null };
  return { profile: text, gist: null }; // parse-failure fallback
}

// One small Claude call → { evolving profile, this-conversation gist }. Throws on an
// empty model response so the caller leaves the conversation unmarked for a retry
// (never overwrite the profile with nothing).
async function generateSummary(existingSummary: string, transcript: string): Promise<{ profile: string; gist: string | null }> {
  const result = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 320,
    messages: [{ role: 'user', content: buildPrompt(existingSummary, transcript) }],
  });
  const textPart = result.content.find((b) => b.type === 'text');
  const text = textPart && textPart.type === 'text' ? textPart.text.trim() : '';
  if (!text) throw new Error('empty summary from model');
  return parseSummary(text);
}

export async function GET(req: Request) {
  const startTime = Date.now();

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
  let timeBudgetHit = false;

  const markSummarized = (id: string) =>
    db.from('conversations').update({ summarized_at: new Date().toISOString() }).eq('id', id);

  const batch = conversations ?? [];
  let index = 0;
  for (; index < batch.length; index++) {
    const conv = batch[index];

    // Time-budget guard: maxDuration is 60s but a full batch of AI calls can exceed
    // it. If we're past the budget, stop before starting another call — unprocessed
    // conversations stay unmarked (summarized_at null) so the next nightly run picks
    // them up. Graceful instead of killed mid-run.
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      timeBudgetHit = true;
      break;
    }

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

      // (c) One small Claude call → { evolving profile, this-conversation gist }.
      const { profile, gist } = await generateSummary(contact.summary ?? '', transcript);

      // (d) Save the EVOLVING profile to the CONTACT, and the one-line gist to THIS
      // conversation — marking it summarized in the same update.
      const { error: updateError } = await db
        .from('contacts')
        .update({ summary: profile })
        .eq('id', contact.id);
      if (updateError) throw updateError;

      const { error: markError } = await db
        .from('conversations')
        .update({ summary: gist, summarized_at: new Date().toISOString() })
        .eq('id', conv.id);
      if (markError) throw markError;

      processed++;
    } catch (e) {
      // Fail-safe: log and leave this conversation UNMARKED for the next run.
      console.error(`[cron/summarize] conversation ${conv.id} failed:`, e);
      failed++;
    }
  }

  return NextResponse.json({
    processed,
    junkSkipped,
    failed,
    ...(timeBudgetHit ? { timeBudgetHit: true, remaining: batch.length - index } : {}),
  });
}
