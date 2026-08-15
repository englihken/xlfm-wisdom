// src/app/api/cron/review/route.ts
// P1 quality loop — nightly review pass + daily unanswered alarm (brief §1.1/§1.3).
//
// Review pass: conversations with ≥1 assistant message, idle >24h, not crisis,
// and NO conversation_reviews row yet (one review per conversation EVER — the
// UNIQUE constraint enforces it; inserts ignore duplicates). A bounded
// synchronous Haiku loop (concurrency 3, ≤150/night) instead of the Message
// Batches pattern: reviews have no bookkeeping table (no migrations allowed),
// and the nightly volume is small — idempotence + outage-safety come entirely
// from "eligibility = no row yet", so a failed night self-heals the next night.
//
// Unanswered alarm: count yesterday-MYT conversations with ≥1 user message and
// NO reply of any kind (no assistant message, no volunteer reply via sent_by).
// Logged here + surfaced as a banner through /api/dashboard/reviews (computed
// live so it clears on its own); if a Resend key is configured we also email.

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '@/lib/supabase';
import {
  REVIEW_MODEL,
  REVIEW_MAX_TOKENS,
  buildReviewPrompt,
  parseReviewOutput,
  reviewRow,
  mytDayWindows,
  countUnanswered,
  type TranscriptMessage,
} from '@/lib/care-review';

export const runtime = 'nodejs';
export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SCAN_LIMIT = 600; // newest idle candidates scanned per run
const MAX_REVIEWS_PER_RUN = 150;
const CONCURRENCY = 3;
const TIME_BUDGET_MS = 270_000;
const IDLE_MS = 24 * 60 * 60 * 1000;

async function sendAlertEmail(yesterdayCount: number): Promise<'sent' | 'skipped' | 'failed'> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.REVIEW_ALERT_EMAIL_TO;
  if (!key || !to) return 'skipped';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.REVIEW_ALERT_EMAIL_FROM ?? 'xlfm-wisdom <onboarding@resend.dev>',
        to: to.split(',').map((s) => s.trim()),
        subject: `[智慧问答] 昨日有 ${yesterdayCount} 个对话未获回复`,
        text: `昨日（MYT）有 ${yesterdayCount} 个对话有访客留言但没有任何回复。\n请检查 Anthropic API 余额与部署状态：https://xlfm-wisdom.vercel.app/dashboard`,
      }),
    });
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function GET(req: Request) {
  const startTime = Date.now();
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - startTime);

  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!supabaseAdmin) return NextResponse.json({ skipped: true });
  const db = supabaseAdmin;

  // ── Unanswered alarm (§1.3) ────────────────────────────────────────────────
  const windows = mytDayWindows(Date.now());
  const [unansweredYesterday, unansweredToday] = await Promise.all([
    countUnanswered(db, windows.yesterday.start, windows.yesterday.end),
    countUnanswered(db, windows.today.start, windows.today.end),
  ]);
  const email = unansweredYesterday > 0 ? await sendAlertEmail(unansweredYesterday) : 'skipped';

  // ── Review pass (§1.1) ─────────────────────────────────────────────────────
  const idleCutoff = new Date(Date.now() - IDLE_MS).toISOString();
  const { data: candidates, error: candError } = await db
    .from('conversations')
    .select('id')
    .lt('last_message_at', idleCutoff)
    .eq('crisis_flag', false)
    .order('last_message_at', { ascending: false })
    .limit(SCAN_LIMIT);
  if (candError) {
    console.error('[cron/review] candidate select failed:', candError);
    return NextResponse.json({ error: 'Select failed' }, { status: 500 });
  }

  const candidateIds = (candidates ?? []).map((c) => c.id as string);

  // Drop already-reviewed + assistant-less conversations (plain queries — the
  // one-review-per-conversation invariant lives in the UNIQUE constraint anyway).
  let eligible: string[] = [];
  if (candidateIds.length > 0) {
    const [reviewedRes, assistantRes] = await Promise.all([
      db.from('conversation_reviews').select('conversation_id').in('conversation_id', candidateIds),
      db.from('messages').select('conversation_id').in('conversation_id', candidateIds).eq('role', 'assistant'),
    ]);
    const reviewed = new Set((reviewedRes.data ?? []).map((r) => r.conversation_id as string));
    const hasAssistant = new Set((assistantRes.data ?? []).map((r) => r.conversation_id as string));
    eligible = candidateIds.filter((id) => !reviewed.has(id) && hasAssistant.has(id));
  }

  const queue = eligible.slice(0, MAX_REVIEWS_PER_RUN);
  let reviewed = 0;
  let failed = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length && timeLeft() > 20_000) {
      const conversationId = queue[cursor++];
      try {
        const { data: msgs } = await db
          .from('messages')
          .select('role, content')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true });
        const transcript = (msgs ?? []) as TranscriptMessage[];
        if (!transcript.some((m) => m.role === 'assistant')) continue;

        const result = await anthropic.messages.create({
          model: REVIEW_MODEL,
          max_tokens: REVIEW_MAX_TOKENS,
          messages: [{ role: 'user', content: buildReviewPrompt(transcript) }],
        });
        const text = result.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        const review = parseReviewOutput(text);
        if (!review) {
          console.error(`[cron/review] unparseable review output for ${conversationId}`);
          failed++;
          continue;
        }
        const { error: insertError } = await db
          .from('conversation_reviews')
          .upsert(reviewRow(conversationId, review, REVIEW_MODEL), {
            onConflict: 'conversation_id',
            ignoreDuplicates: true, // ON CONFLICT DO NOTHING — one review EVER
          });
        if (insertError) {
          console.error(`[cron/review] insert failed for ${conversationId}:`, insertError);
          failed++;
        } else {
          reviewed++;
        }
      } catch (e) {
        console.error(`[cron/review] review failed for ${conversationId}:`, e);
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));

  const summary = {
    reviewed,
    failed,
    eligible: eligible.length,
    queued: queue.length,
    unansweredYesterday,
    unansweredToday,
    alertEmail: email,
  };
  // One-line JSON result, same convention as the summarize cron.
  console.log('[cron/review]', JSON.stringify(summary));
  return NextResponse.json(summary);
}
