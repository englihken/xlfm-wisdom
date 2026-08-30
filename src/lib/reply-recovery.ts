// src/lib/reply-recovery.ts
// Dead-letter queue for failed AI replies (brief "别再把访客弄丢" §3, async side).
//
// Table failed_replies (architect-created):
//   conversation_id · error_kind · error_detail · attempts ·
//   status (queued | retrying | recovered | handed_off) · created_at · last_attempt_at
//
// Backoff by attempts: 1m / 5m / 30m / 2h, then handed_off (→ conversation
// status needs_human so it is in the care inbox). Quota failures never burn
// attempts: a canary ping gates them, and they replay once the balance is back.
//
// Vercel Hobby allows only the two daily crons already in vercel.json, so the
// worker is event-driven instead of a 5-minute cron:
//   - the visitor's own /api/chat/updates poll (every 8 s) drives recovery of
//     THAT conversation → the 1-minute retry lands while they are still there
//   - every /api/chat request drains one due item after its own reply
//   - the daily review cron sweeps the rest; /api/cron/recover-replies exists
//     for an external pinger (cron-job.org etc.) with CRON_SECRET
// Concurrency: a row is CLAIMED by a conditional update (status + attempts
// must still match what we read) before any generation, so two triggers can
// never both answer the same conversation.

import { supabaseAdmin } from './supabase';
import { generateReply, type CareMessage, type Language } from './care-pipeline';
import { classifyAnthropicError, type ReplyErrorKind } from './ops-alerts';
import { writeAudit } from './audit';
import Anthropic from '@anthropic-ai/sdk';

export const RETRY_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000] as const;
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length;

type FailedReplyRow = {
  id: string;
  conversation_id: string;
  error_kind: string;
  error_detail: string | null;
  attempts: number;
  status: string;
  created_at: string;
  last_attempt_at: string | null;
};

function dueAtMs(row: FailedReplyRow): number {
  const base = new Date(row.last_attempt_at ?? row.created_at).getTime();
  return base + RETRY_BACKOFF_MS[Math.min(row.attempts, RETRY_BACKOFF_MS.length - 1)];
}

async function canaryOk(): Promise<boolean> {
  try {
    await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 0 }).messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return true;
  } catch (e) {
    console.error('[reply-recovery] canary failed:', classifyAnthropicError(e));
    return false;
  }
}

export type RecoveryOutcome = 'recovered' | 'already_answered' | 'handed_off' | 'retry_later' | 'quota_wait' | 'skipped';

// Regenerate the missing reply for one conversation. Returns what happened.
async function recoverConversation(row: FailedReplyRow): Promise<{ outcome: RecoveryOutcome; kind?: ReplyErrorKind; detail?: string }> {
  const db = supabaseAdmin!;
  const { data: conv } = await db
    .from('conversations')
    .select('id, status, language, channel')
    .eq('id', row.conversation_id)
    .maybeSingle();
  if (!conv) return { outcome: 'skipped', detail: 'conversation missing' };
  if (conv.status === 'volunteer_handling') return { outcome: 'handed_off', detail: 'volunteer handling' };

  const { data: msgs } = await db
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', row.conversation_id)
    .order('created_at', { ascending: true });
  const all = (msgs ?? []) as { role: string; content: string; created_at: string }[];
  const lastUserIdx = all.map((m) => m.role).lastIndexOf('user');
  if (lastUserIdx < 0) return { outcome: 'skipped', detail: 'no user message' };
  if (all.slice(lastUserIdx + 1).some((m) => m.role === 'assistant' || m.role === 'volunteer')) {
    return { outcome: 'already_answered' };
  }
  // WhatsApp delivery lives in the webhook route; a recovered WA reply would
  // sit unsent in the DB, so hand those to a volunteer (the reply UI sends).
  if (conv.channel === 'whatsapp') return { outcome: 'handed_off', detail: 'whatsapp channel' };

  const history: CareMessage[] = all
    .filter((m) => m.content && m.content.trim().length > 0)
    .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.content }));
  const language = ((conv.language as string) || 'zh') as Language;

  try {
    const { fullText, sources } = await generateReply(history, language, { conversationId: row.conversation_id });
    const { error: insErr } = await db.from('messages').insert({
      conversation_id: row.conversation_id,
      role: 'assistant',
      content: fullText,
      sources,
    });
    if (insErr) throw new Error(`message insert failed: ${insErr.message}`);
    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', row.conversation_id);
    return { outcome: 'recovered' };
  } catch (e) {
    const c = classifyAnthropicError(e);
    if (c.kind === 'quota') return { outcome: 'quota_wait', kind: c.kind, detail: c.detail };
    return { outcome: 'retry_later', kind: c.kind, detail: c.detail };
  }
}

export type RecoveryRun = {
  scanned: number;
  due: number;
  attempted: number;
  recovered: number;
  handedOff: number;
  quotaWaiting: number;
  skippedTableMissing: boolean;
};

export async function processFailedReplies(opts: {
  limit?: number;
  budgetMs?: number;
  conversationId?: string;
} = {}): Promise<RecoveryRun> {
  const run: RecoveryRun = { scanned: 0, due: 0, attempted: 0, recovered: 0, handedOff: 0, quotaWaiting: 0, skippedTableMissing: false };
  if (!supabaseAdmin) return run;
  const db = supabaseAdmin;
  const limit = opts.limit ?? 5;
  const deadline = Date.now() + (opts.budgetMs ?? 200_000);

  let q = db
    .from('failed_replies')
    .select('id, conversation_id, error_kind, error_detail, attempts, status, created_at, last_attempt_at')
    .in('status', ['queued', 'retrying'])
    .order('created_at', { ascending: true })
    .limit(50);
  if (opts.conversationId) q = q.eq('conversation_id', opts.conversationId);
  const { data, error } = await q;
  if (error) {
    if (error.code === '42P01' || /failed_replies/.test(error.message)) {
      run.skippedTableMissing = true;
    } else {
      console.error('[reply-recovery] queue select failed:', error);
    }
    return run;
  }
  const rows = (data ?? []) as FailedReplyRow[];
  run.scanned = rows.length;
  const now = Date.now();
  const due = rows.filter((r) => dueAtMs(r) <= now);
  run.due = due.length;
  if (due.length === 0) return run;

  // Quota-class rows: one canary per run; if the balance is still out, leave
  // them untouched (no attempt burned) and skip them this run.
  let quotaGateOpen: boolean | null = null;
  const gate = async () => {
    if (quotaGateOpen === null) quotaGateOpen = await canaryOk();
    return quotaGateOpen;
  };

  for (const row of due) {
    if (run.attempted >= limit || Date.now() > deadline - 15_000) break;
    if (row.error_kind === 'quota' && !(await gate())) {
      run.quotaWaiting++;
      continue;
    }
    // Claim: only proceeds if nobody else touched the row since we read it.
    const { data: claimed } = await db
      .from('failed_replies')
      .update({ status: 'retrying', attempts: row.attempts + 1, last_attempt_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', row.status)
      .eq('attempts', row.attempts)
      .select('id')
      .maybeSingle();
    if (!claimed) continue;
    run.attempted++;
    const attemptsNow = row.attempts + 1;

    const result = await recoverConversation(row);
    if (result.outcome === 'recovered' || result.outcome === 'already_answered') {
      await db.from('failed_replies').update({ status: 'recovered' }).eq('id', row.id);
      run.recovered++;
      await writeAudit({
        actorId: null, actorEmail: null, module: 'care', action: 'care.reply_recovered',
        tableName: 'conversations', recordId: row.conversation_id,
        after: { attempts: attemptsNow, outcome: result.outcome, originalKind: row.error_kind },
      });
      console.log(`[reply-recovery] conversation=${row.conversation_id} ${result.outcome} after ${attemptsNow} attempt(s)`);
      continue;
    }
    if (result.outcome === 'quota_wait') {
      // Give the attempt back — quota failures must not burn the ladder.
      await db.from('failed_replies').update({ status: 'queued', attempts: row.attempts, error_kind: 'quota', error_detail: result.detail ?? null }).eq('id', row.id);
      run.quotaWaiting++;
      quotaGateOpen = false;
      continue;
    }
    if (result.outcome === 'handed_off' || result.outcome === 'skipped' || attemptsNow >= MAX_ATTEMPTS) {
      await db.from('failed_replies').update({
        status: 'handed_off',
        error_kind: result.kind ?? row.error_kind,
        error_detail: result.detail ?? row.error_detail,
      }).eq('id', row.id);
      if (result.outcome !== 'skipped') {
        await db.from('conversations').update({ status: 'needs_human' }).eq('id', row.conversation_id).neq('status', 'volunteer_handling');
      }
      run.handedOff++;
      await writeAudit({
        actorId: null, actorEmail: null, module: 'care', action: 'care.handed_off',
        tableName: 'conversations', recordId: row.conversation_id,
        after: { attempts: attemptsNow, reason: result.detail ?? result.outcome, kind: result.kind ?? row.error_kind },
      });
      console.error(`[reply-recovery] conversation=${row.conversation_id} handed_off (${result.detail ?? result.outcome})`);
      continue;
    }
    // retry_later
    await db.from('failed_replies').update({
      status: 'retrying',
      error_kind: result.kind ?? row.error_kind,
      error_detail: result.detail ?? row.error_detail,
    }).eq('id', row.id);
  }
  return run;
}

// Cheap gate for the visitor poll: is there anything queued for this
// conversation at all? (Due-ness is checked inside processFailedReplies.)
export async function hasOpenFailedReply(conversationId: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const { data, error } = await supabaseAdmin
    .from('failed_replies')
    .select('id')
    .eq('conversation_id', conversationId)
    .in('status', ['queued', 'retrying'])
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}
