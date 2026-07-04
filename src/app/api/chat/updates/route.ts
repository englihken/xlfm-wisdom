// src/app/api/chat/updates/route.ts
// PUBLIC endpoint (no volunteer auth) — lets a /qa visitor's page poll in the
// volunteer replies that arrive when a human takes over their conversation.
//
// Returns ONLY role='volunteer' messages newer than `after`, plus a `handling`
// flag (is a human currently on this conversation) so the page can show the honest
// indicator. No AI or user messages, no volunteer identities — just the reply text.
//
// SECURITY: this is unauthenticated, so we require BOTH the conversationId AND the
// caller's browserId, and verify server-side that the browserId matches the
// conversation's contact (contacts.browser_id). Without that, anyone could poll a
// stranger's thread by guessing conversation ids. A mismatch returns 403.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

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

  // Only volunteer replies, only newer than `after` (defaults to epoch).
  let query = supabaseAdmin
    .from('messages')
    .select('id, content, created_at')
    .eq('conversation_id', conversationId)
    .eq('role', 'volunteer')
    .order('created_at', { ascending: true });
  if (after) query = query.gt('created_at', after);

  const { data: messages, error: msgError } = await query;
  if (msgError) {
    console.error('[chat/updates] messages fetch failed:', msgError);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }

  return NextResponse.json({ messages: messages ?? [], handling });
}
