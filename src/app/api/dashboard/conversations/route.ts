// src/app/api/dashboard/conversations/route.ts
// GET the volunteer inbox: all conversations, newest activity first, each shaped
// for the left-panel list item. Auth-gated (401 if the caller isn't a logged-in
// volunteer), then queried with the service-role client (supabaseAdmin).

import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const PREVIEW_MAX = 120;

type ContactLite = { display_name: string | null; channel: string | null; stage: string | null };
type MessageLite = { content: string | null; created_at: string };
type ConversationRow = {
  id: string;
  channel: string;
  status: string;
  last_message_at: string;
  contact: ContactLite | ContactLite[] | null;
  messages: MessageLite[] | null;
};

export async function GET() {
  // Layer 1: verify a logged-in volunteer.
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  // One query: conversations + their contact + only their latest message
  // (ordered desc, limited to 1 per conversation for the preview).
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select(
      `id, channel, status, last_message_at,
       contact:contacts ( display_name, channel, stage ),
       messages ( content, created_at )`
    )
    .order('last_message_at', { ascending: false })
    .order('created_at', { referencedTable: 'messages', ascending: false })
    .limit(1, { referencedTable: 'messages' });

  if (error) {
    console.error('[dashboard] conversations list failed:', error);
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as ConversationRow[];

  const conversations = rows.map((row) => {
    const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
    const latest = row.messages?.[0]?.content?.trim() ?? '';
    const preview =
      latest.length > PREVIEW_MAX ? `${latest.slice(0, PREVIEW_MAX)}…` : latest;

    return {
      id: row.id,
      contactName: contact?.display_name || '匿名访客',
      channel: row.channel,
      stage: contact?.stage ?? null,
      status: row.status,
      lastMessagePreview: preview,
      lastMessageAt: row.last_message_at,
    };
  });

  return NextResponse.json({ conversations });
}
