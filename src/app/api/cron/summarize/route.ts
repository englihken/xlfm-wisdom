// src/app/api/cron/summarize/route.ts
// Daily auto-summary cron — the BACKSTOP behind the on-demand refreshes (takeover +
// detail-view self-heal in src/lib/care-summary.ts). Once a conversation has been
// idle 2+ hours it is folded into its contact's rolling 有缘人档案 and given its own
// one-line gist.
//
// v3 (Batch API): the cron no longer calls Claude synchronously per contact.
// Each run does three things:
//   1. APPLY any earlier batch that has finished — write profiles + gists via
//      the shared applyFoldOutput, mark the batch row done.
//   2. SUBMIT tonight's work as ONE message batch (one request per contact,
//      prompts built by the shared prepareContactFold) at 50% token price, and
//      record the batch + its contact→conversation mapping in summary_batches.
//   3. POLL the fresh batch inside the remaining time budget — small batches
//      usually finish within minutes, so summaries still land the same night;
//      worst case they land when the next nightly run finds the batch ended.
//
// Conversations stay unsummarized (summarized_at NULL) until results are
// applied, so a lost/expired batch is simply re-folded on a later run — the
// same fail-safe contract as before. The takeover and self-heal paths are
// untouched: they still refresh synchronously (a volunteer can't wait for a
// batch).
//
// Triggered by Vercel Cron (see vercel.json), which sends
// `Authorization: Bearer <CRON_SECRET>`.

import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  prepareContactFold,
  applyFoldOutput,
  IDLE_MS,
  JUNK_CATEGORY,
  SUMMARY_MODEL,
} from '@/lib/care-summary';

export const runtime = 'nodejs';
// Fluid-compute ceiling on the Hobby plan. The poll phase (step 3) uses most of
// it; every phase respects TIME_BUDGET_MS so we always exit gracefully.
export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SCAN_LIMIT = 200; // pending conversations scanned per run (grouping input)
const MAX_CONTACTS_PER_RUN = 40; // upper bound on batch requests per run
const PREPARE_CONCURRENCY = 3; // parallel prompt builds (DB-only, cheap)
const TIME_BUDGET_MS = 270_000; // stop before Vercel's 300s maxDuration kills us
const POLL_INTERVAL_MS = 10_000; // batch status poll cadence in step 3
// A batch row still unfinished after this long is written off (Anthropic caps
// batch processing at 24h, so this only fires if a run crashed mid-apply).
const BATCH_EXPIRY_MS = 48 * 60 * 60 * 1000;

type BatchPayloadEntry = { contact_id: string; conversation_ids: string[] };
type BatchRow = {
  id: string;
  batch_id: string;
  payload: BatchPayloadEntry[];
  created_at: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(req: Request) {
  const startTime = Date.now();
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - startTime);

  // Security: Vercel Cron sends a bearer token. Missing env or any mismatch → 401.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ skipped: true });
  }
  const db = supabaseAdmin;

  let applied = 0; // conversations whose summaries landed this run
  let appliedBatches = 0;
  let failed = 0;

  // ── Step 1: apply earlier batches that have finished ───────────────────────
  const { data: inflightRows, error: inflightError } = await db
    .from('summary_batches')
    .select('id, batch_id, payload, created_at')
    .eq('status', 'submitted')
    .order('created_at', { ascending: true });
  if (inflightError) {
    console.error('[cron/summarize] summary_batches select failed:', inflightError);
    return NextResponse.json({ error: 'Batch bookkeeping select failed' }, { status: 500 });
  }

  const stillInflight: BatchRow[] = [];
  for (const row of (inflightRows ?? []) as BatchRow[]) {
    try {
      const batch = await anthropic.messages.batches.retrieve(row.batch_id);
      if (batch.processing_status === 'ended') {
        const result = await applyBatchResults(db, row);
        applied += result.applied;
        failed += result.failed;
        appliedBatches++;
        await db
          .from('summary_batches')
          .update({ status: 'done', processed_at: new Date().toISOString() })
          .eq('id', row.id);
      } else if (Date.now() - new Date(row.created_at).getTime() > BATCH_EXPIRY_MS) {
        console.error(`[cron/summarize] batch ${row.batch_id} written off after 48h`);
        await db.from('summary_batches').update({ status: 'expired' }).eq('id', row.id);
      } else {
        stillInflight.push(row);
      }
    } catch (e) {
      // Fail-safe: leave the row submitted; conversations stay excluded below
      // and we retry applying on the next run.
      console.error(`[cron/summarize] batch ${row.batch_id} retrieve/apply failed:`, e);
      failed++;
      stillInflight.push(row);
    }
  }

  // Conversations already riding an in-flight batch must not be resubmitted.
  const inflightConvIds = new Set(
    stillInflight.flatMap((r) => r.payload.flatMap((p) => p.conversation_ids))
  );

  // ── Step 2: gather tonight's work and submit ONE batch ─────────────────────
  const idleCutoff = new Date(Date.now() - IDLE_MS).toISOString();

  // Newest-idle-first: with a backlog, freshening the profiles of RECENTLY active
  // contacts matters more than draining June first (the per-contact prompt carries
  // conversation dates, so late-folded old conversations can't regress a profile).
  const { data: conversations, error: selectError } = await db
    .from('conversations')
    .select('id, contact_id, category')
    .is('summarized_at', null)
    .lt('last_message_at', idleCutoff)
    .order('last_message_at', { ascending: false })
    .limit(SCAN_LIMIT);
  if (selectError) {
    console.error('[cron/summarize] conversation select failed:', selectError);
    return NextResponse.json({ error: 'Select failed' }, { status: 500 });
  }

  let junkSkipped = 0;
  const markSummarized = (id: string) =>
    db.from('conversations').update({ summarized_at: new Date().toISOString() }).eq('id', id);

  // Orphans (no contact to attach a profile to) and junk chit-chat: mark without
  // an AI call. Junk WITH a contact is also marked inside prepareContactFold,
  // but doing it here keeps orphan junk from lingering forever.
  const contactIds: string[] = [];
  const seen = new Set<string>();
  for (const conv of conversations ?? []) {
    if (inflightConvIds.has(conv.id)) continue; // already in a pending batch
    if (!conv.contact_id || conv.category === JUNK_CATEGORY) {
      const { error } = await markSummarized(conv.id);
      if (error) console.error(`[cron/summarize] mark failed for conversation ${conv.id}:`, error);
      else junkSkipped++;
      continue;
    }
    if (!seen.has(conv.contact_id)) {
      seen.add(conv.contact_id);
      contactIds.push(conv.contact_id); // insertion order = newest activity first
    }
  }

  const queue = contactIds.slice(0, MAX_CONTACTS_PER_RUN);
  const skippedContacts = contactIds.length - queue.length;

  // Build the per-contact prompts (DB-only, no model calls) with a small pool.
  type PreparedRequest = { contactId: string; prompt: string; maxTokens: number; conversationIds: string[] };
  const preparedRequests: PreparedRequest[] = [];
  let cursor = 0;
  const prepareWorker = async () => {
    while (cursor < queue.length && timeLeft() > 30_000) {
      const contactId = queue[cursor++];
      try {
        const { prepared, error } = await prepareContactFold(db, contactId, { idleCutoffIso: idleCutoff });
        if (error) failed++;
        if (prepared) {
          preparedRequests.push({
            contactId,
            prompt: prepared.prompt,
            maxTokens: prepared.maxTokens,
            conversationIds: prepared.conversationIds,
          });
        }
      } catch (e) {
        console.error(`[cron/summarize] prepare failed for contact ${contactId}:`, e);
        failed++;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PREPARE_CONCURRENCY, queue.length) }, () => prepareWorker())
  );

  let submittedBatchId: string | null = null;
  let submittedRow: BatchRow | null = null;
  if (preparedRequests.length > 0) {
    try {
      const batch = await anthropic.messages.batches.create({
        requests: preparedRequests.map((r) => ({
          custom_id: r.contactId,
          params: {
            model: SUMMARY_MODEL,
            max_tokens: r.maxTokens,
            messages: [{ role: 'user' as const, content: r.prompt }],
          },
        })),
      });
      submittedBatchId = batch.id;

      const payload: BatchPayloadEntry[] = preparedRequests.map((r) => ({
        contact_id: r.contactId,
        conversation_ids: r.conversationIds,
      }));
      const { data: rowData, error: insertError } = await db
        .from('summary_batches')
        .insert({ batch_id: batch.id, payload })
        .select('id, batch_id, payload, created_at')
        .single();
      if (insertError || !rowData) {
        // Bookkeeping failed → we could never apply the results. Cancel so the
        // conversations (still unsummarized) get resubmitted cleanly next run.
        console.error('[cron/summarize] summary_batches insert failed — canceling batch:', insertError);
        await anthropic.messages.batches.cancel(batch.id).catch(() => {});
        submittedBatchId = null;
      } else {
        submittedRow = rowData as BatchRow;
      }
    } catch (e) {
      console.error('[cron/summarize] batch submit failed:', e);
      failed++;
    }
  }

  // ── Step 3: poll tonight's batch inside the remaining budget ───────────────
  // Small batches usually end within a few minutes; landing them now keeps the
  // dashboard fresh the same night instead of a day later.
  let sameRunApplied = false;
  if (submittedRow && submittedBatchId) {
    while (timeLeft() > POLL_INTERVAL_MS + 15_000) {
      await sleep(POLL_INTERVAL_MS);
      try {
        const batch = await anthropic.messages.batches.retrieve(submittedBatchId);
        if (batch.processing_status !== 'ended') continue;
        const result = await applyBatchResults(db, submittedRow);
        applied += result.applied;
        failed += result.failed;
        appliedBatches++;
        sameRunApplied = true;
        await db
          .from('summary_batches')
          .update({ status: 'done', processed_at: new Date().toISOString() })
          .eq('id', submittedRow.id);
        break;
      } catch (e) {
        console.error('[cron/summarize] same-run poll failed:', e);
        break; // next nightly run will apply it
      }
    }
  }

  return NextResponse.json({
    appliedConversations: applied,
    appliedBatches,
    junkSkipped,
    failed,
    submittedBatch: submittedBatchId,
    submittedContacts: preparedRequests.length,
    sameRunApplied,
    ...(skippedContacts > 0 ? { skippedContacts } : {}),
  });
}

// Stream one finished batch's results and write them back through the shared
// apply half. Errored/expired requests are logged; their conversations stay
// unsummarized and get re-folded on a later run.
async function applyBatchResults(
  db: NonNullable<typeof supabaseAdmin>,
  row: BatchRow
): Promise<{ applied: number; failed: number }> {
  const byContact = new Map(row.payload.map((p) => [p.contact_id, p.conversation_ids]));
  let applied = 0;
  let failed = 0;

  for await (const entry of await anthropic.messages.batches.results(row.batch_id)) {
    const conversationIds = byContact.get(entry.custom_id);
    if (!conversationIds) {
      console.error(`[cron/summarize] batch ${row.batch_id}: unknown custom_id ${entry.custom_id}`);
      continue;
    }
    if (entry.result.type !== 'succeeded') {
      console.error(
        `[cron/summarize] batch ${row.batch_id}: request for contact ${entry.custom_id} ${entry.result.type}`
      );
      failed++;
      continue;
    }
    const text = entry.result.message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    try {
      const result = await applyFoldOutput(db, entry.custom_id, conversationIds, text);
      if (result.ok) applied += result.processed;
      else failed++;
    } catch (e) {
      console.error(`[cron/summarize] apply failed for contact ${entry.custom_id}:`, e);
      failed++;
    }
  }

  return { applied, failed };
}
