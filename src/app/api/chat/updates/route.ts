// src/app/api/chat/updates/route.ts
// PUBLIC endpoint (no volunteer auth) — lets a /qa visitor's page poll in the
// volunteer replies that arrive when a human takes over their conversation.
//
// Returns role='volunteer' messages newer than `after`, plus — since the
// "别再把访客弄丢" brief — role='assistant' messages newer than `after`, which
// are RECOVERED replies written by the dead-letter worker after a generation
// failure (the live reply is streamed, persisted, and its timestamp handed to
// the client as the `after` cursor, so it is never re-delivered here). Also
// a `handling` flag (is a human currently on this conversation). No user
// messages, no volunteer identities — just the reply text.
//
// This poll (every 8 s while the visitor is on the page) is also what drives
// recovery for THIS conversation: if a failed reply is queued and due, it is
// regenerated inline, so the 1-minute retry lands while they are still here.
//
// SECURITY: this is unauthenticated, so we require BOTH the conversationId AND the
// caller's browserId, and verify server-side that the browserId matches the
// conversation's contact (contacts.browser_id). Without that, anyone could poll a
// stranger's thread by guessing conversation ids. A mismatch returns 403.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { hasOpenFailedReply, processFailedReplies } from '@/lib/reply-recovery';

export const runtime = 'nodejs';
// A recovery regeneration (Opus reply + guard retry) can take 20-120 s; the
// 08-30 backfill drain saw one hit a 120 s ceiling (504, row stuck retrying).
// Use the Fluid-compute ceiling so the inline recovery is never cut off.
export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const conversationId = url.searchParams.get('conversationId');
  const browserId = url.searchParams.get('browserId');
  const after = url.searchParams.get('after');

  if (!conversationId || !browserId) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }
  if (!supabaseAdmin) {
    // Storage off → nothing to deliver, but don't error the visitor's page.
    return NextResponse.json({ messages: [], handling: false });
  }

  // Ownership check: the conversation's contact must be THIS browser.
  const { data: conv, error: convError } = await supabaseAdmin
    .from('conversations')
    .select('id, status, contact:contacts ( browser_id )')
    .eq('id', conversationId)
    .maybeSingle();
  if (convError) {
    console.error('[chat/updates] conversation fetch failed:', convError);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const rawContact = (conv as { contact: { browser_id: string | null } | { browser_id: string | null }[] | null }).contact;
  const contact = Array.isArray(rawContact) ? rawContact[0] ?? null : rawContact;
  if (!contact || contact.browser_id !== browserId) {
    // Don't confirm existence to a non-owner.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const handling = conv.status === 'volunteer_handling';

  // Recovery hook: a queued failed reply for this conversation, if due, is
  // regenerated now (claim-protected, so concurrent polls can't double-answer).
  if (!handling) {
    try {
      if (await hasOpenFailedReply(conversationId)) {
        const run = await processFailedReplies({ conversationId, limit: 1, budgetMs: 240_000 });
        if (run.attempted > 0) console.log('[chat/updates] recovery', JSON.stringify(run));
      }
    } catch (e) {
      console.error('[chat/updates] recovery failed:', e);
    }
  }

  // Volunteer replies + recovered assistant replies, only newer than `after`
  // (defaults to epoch).
  let query = supabaseAdmin
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .in('role', ['volunteer', 'assistant'])
    .order('created_at', { ascending: true });
  if (after) query = query.gt('created_at', after);

  const { data: messages, error: msgError } = await query;
  if (msgError) {
    console.error('[chat/updates] messages fetch failed:', msgError);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }

  return NextResponse.json({ messages: messages ?? [], handling });
}
