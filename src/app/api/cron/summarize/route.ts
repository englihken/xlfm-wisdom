// src/app/api/cron/summarize/route.ts
// Daily auto-summary cron — the BACKSTOP behind the on-demand refreshes (takeover +
// detail-view self-heal in src/lib/care-summary.ts). Once a conversation has been
// idle 2+ hours it is folded into its contact's rolling 有缘人档案 and given its own
// one-line gist.
//
// v2 (fixes the starvation that froze profiles on the first-ever conversation):
// the old loop made one Claude call PER CONVERSATION, sequentially, capped at 12 —
// arrivals outran the drain and recent conversations were never reached. Now
// pending conversations are grouped BY CONTACT, one Claude call folds up to 6 of a
// contact's conversations at once (newest first, so profiles reflect the latest
// activity even mid-backlog), and contacts are processed with bounded concurrency.
//
// Triggered by Vercel Cron (see vercel.json), which sends
// `Authorization: Bearer <CRON_SECRET>`. Everything per-contact is fail-safe: any
// error is logged and that contact's conversations stay UNMARKED for the next run.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshContactSummaries, IDLE_MS, JUNK_CATEGORY } from '@/lib/care-summary';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SCAN_LIMIT = 200; // pending conversations scanned per run (grouping input)
const MAX_CONTACTS_PER_RUN = 40; // upper bound on Claude calls per run
const CONTACT_CONCURRENCY = 3; // parallel contacts (each contact stays sequential inside)
const TIME_BUDGET_MS = 45_000; // stop before Vercel's 60s maxDuration kills us mid-run

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

  let processed = 0;
  let junkSkipped = 0;
  let failed = 0;
  let timeBudgetHit = false;

  const markSummarized = (id: string) =>
    db.from('conversations').update({ summarized_at: new Date().toISOString() }).eq('id', id);

  // Orphans (no contact to attach a profile to) and junk chit-chat: mark without
  // an AI call. Junk WITH a contact is also marked inside the per-contact refresh,
  // but doing it here keeps orphan junk from lingering forever.
  const contactIds: string[] = [];
  const seen = new Set<string>();
  for (const conv of conversations ?? []) {
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
  let cursor = 0;

  // Small worker pool: contacts in parallel, each contact's fold internally
  // sequential (its profile evolves in one call — no write races possible).
  const worker = async () => {
    while (cursor < queue.length) {
      // Time-budget guard: unprocessed contacts stay unmarked (summarized_at null)
      // so the next nightly run picks them up. Graceful instead of killed mid-run.
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        timeBudgetHit = true;
        return;
      }
      const contactId = queue[cursor++];
      try {
        const result = await refreshContactSummaries(db, contactId, { idleCutoffIso: idleCutoff });
        processed += result.processed;
        junkSkipped += result.marked;
        if (!result.ok) failed++;
      } catch (e) {
        // Fail-safe: log and leave this contact's conversations UNMARKED for the next run.
        console.error(`[cron/summarize] contact ${contactId} failed:`, e);
        failed++;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONTACT_CONCURRENCY, queue.length) }, () => worker())
  );

  return NextResponse.json({
    processed,
    junkSkipped,
    failed,
    contacts: cursor,
    ...(skippedContacts > 0 ? { skippedContacts } : {}),
    ...(timeBudgetHit ? { timeBudgetHit: true, remainingContacts: queue.length - cursor } : {}),
  });
}
