// src/app/api/dashboard/conversations/[id]/route.ts
// GET one full conversation for the dashboard: the contact profile (right panel)
// plus every message in order (center thread). Auth-gated, then queried with the
// service-role client (supabaseAdmin).

import { NextResponse } from 'next/server';
import { getActiveVolunteer, getAuthenticatedUser } from '@/lib/supabase-server';
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

  // Layer 1: require an ACTIVE volunteer. Distinguish 401 (no session) from
  // 403 (logged in, but not an active volunteer row).
  const access = await getActiveVolunteer();
  if (!access) {
    const user = await getAuthenticatedUser();
    return NextResponse.json(
      { error: user ? 'Not an active volunteer' : 'Unauthorized' },
      { status: user ? 403 : 401 }
    );
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  // Conversation + its contact profile.
  const { data: conversation, error: convError } = await supabaseAdmin
    .from('conversations')
    .select(
      `id, channel, status, category, crisis_flag, language, summary, assigned_volunteer, created_at, last_message_at,
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

  // All messages in chronological order (sent_by attributes human replies).
  const { data: messages, error: msgError } = await supabaseAdmin
    .from('messages')
    .select('id, role, content, sources, created_at, sent_by')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  if (msgError) {
    console.error('[dashboard] messages fetch failed:', msgError);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }

  const rawContact = (conversation as { contact: ContactProfile | ContactProfile[] | null }).contact;
  const contact = Array.isArray(rawContact) ? rawContact[0] ?? null : rawContact;

  // Resolve volunteer names for the assignee + every sent_by, in one lookup.
  const rows = (messages ?? []) as { sent_by: string | null }[];
  const volunteerIds = new Set<string>();
  if (conversation.assigned_volunteer) volunteerIds.add(conversation.assigned_volunteer);
  for (const m of rows) if (m.sent_by) volunteerIds.add(m.sent_by);

  const nameById = new Map<string, string>();
  if (volunteerIds.size > 0) {
    const { data: vols } = await supabaseAdmin
      .from('volunteers')
      .select('id, display_name')
      .in('id', [...volunteerIds]);
    for (const v of vols ?? []) nameById.set(v.id, v.display_name ?? '义工');
  }

  const assignedVolunteer = conversation.assigned_volunteer;

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
      // Human-takeover fields.
      assignedVolunteerId: assignedVolunteer ?? null,
      assignedVolunteerName: assignedVolunteer ? nameById.get(assignedVolunteer) ?? '义工' : null,
      assignedToMe: assignedVolunteer === access.volunteer.id,
    },
    contact,
    messages: (messages ?? []).map((m) => ({
      ...m,
      sentByName: m.sent_by ? nameById.get(m.sent_by) ?? '义工' : null,
    })),
  });
}
