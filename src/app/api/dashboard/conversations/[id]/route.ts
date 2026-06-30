// src/app/api/dashboard/conversations/[id]/route.ts
// GET one full conversation for the dashboard: the contact profile (right panel)
// plus every message in order (center thread). Auth-gated, then queried with the
// service-role client (supabaseAdmin).

import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

type ContactProfile = {
  id: string;
  display_name: string | null;
  channel: string | null;
  wa_id: string | null;
  browser_id: string | null;
  stage: string | null;
  summary: string | null;
  notes: string | null;
  first_seen: string;
  last_seen: string;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Layer 1: verify a logged-in volunteer.
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  // Conversation + its contact profile.
  const { data: conversation, error: convError } = await supabaseAdmin
    .from('conversations')
    .select(
      `id, channel, status, category, crisis_flag, language, summary, created_at, last_message_at,
       contact:contacts ( id, display_name, channel, wa_id, browser_id, stage, summary, notes, first_seen, last_seen )`
    )
    .eq('id', id)
    .maybeSingle();

  if (convError) {
    console.error('[dashboard] conversation fetch failed:', convError);
    return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // All messages in chronological order.
  const { data: messages, error: msgError } = await supabaseAdmin
    .from('messages')
    .select('id, role, content, sources, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  if (msgError) {
    console.error('[dashboard] messages fetch failed:', msgError);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }

  const rawContact = (conversation as { contact: ContactProfile | ContactProfile[] | null }).contact;
  const contact = Array.isArray(rawContact) ? rawContact[0] ?? null : rawContact;

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      channel: conversation.channel,
      status: conversation.status,
      category: conversation.category ?? null,
      crisisFlag: conversation.crisis_flag ?? false,
      language: conversation.language,
      summary: conversation.summary,
      created_at: conversation.created_at,
      last_message_at: conversation.last_message_at,
    },
    contact,
    messages: messages ?? [],
  });
}
