// src/app/api/dashboard/conversations/route.ts
// GET the volunteer inbox: all conversations, newest activity first, each shaped
// for the left-panel list item. Auth-gated (401 if the caller isn't a logged-in
// volunteer), then queried with the service-role client (supabaseAdmin).
//
// Adds per-volunteer `unread` (via conversation_reads) and an optional ?q= search
// over contact name / wa_id / last-message content. Data volumes are small, so the
// search + unread joins are resolved in JS rather than pushed into PostgREST.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isUnread } from '@/lib/care-inbox';

export const runtime = 'nodejs';

const PREVIEW_MAX = 120;

type ContactLite = {
  display_name: string | null;
  channel: string | null;
  stage: string | null;
  wa_id: string | null;
};
type MessageLite = { content: string | null; created_at: string };
type ConversationRow = {
  id: string;
  channel: string;
  status: string;
  category: string | null;
  crisis_flag: boolean;
  assigned_volunteer: string | null;
  last_message_at: string;
  contact: ContactLite | ContactLite[] | null;
  messages: MessageLite[] | null;
};

export async function GET(req: Request) {
  // Layer 1: require an ACTIVE volunteer. Distinguish 401 (no session) from
  // 403 (logged in, but not an active volunteer row).
  const access = await requireModuleAccess('care', 'view');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().toLowerCase();

  // One query: conversations + their contact + only their latest message
  // (ordered desc, limited to 1 per conversation for the preview).
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select(
      `id, channel, status, category, crisis_flag, assigned_volunteer, last_message_at,
       contact:contacts ( display_name, channel, stage, wa_id ),
       messages ( content, created_at )`
    )
    .order('last_message_at', { ascending: false })
    .order('created_at', { referencedTable: 'messages', ascending: false })
    .limit(1, { referencedTable: 'messages' });

  if (error) {
    console.error('[dashboard] conversations list failed:', error);
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 });
  }

  // This volunteer's read markers → a map of conversation_id → last_read_at.
  const readMap = new Map<string, string>();
  const { data: reads, error: readsError } = await supabaseAdmin
    .from('conversation_reads')
    .select('conversation_id, last_read_at')
    .eq('volunteer_id', access.volunteer.id);
  if (readsError) {
    // Non-fatal: without reads everything simply shows as unread.
    console.error('[dashboard] conversation_reads fetch failed:', readsError);
  } else {
    for (const r of reads ?? []) readMap.set(r.conversation_id, r.last_read_at);
  }

  const rows = (data ?? []) as unknown as ConversationRow[];

  const conversations = rows
    .map((row) => {
      const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
      const latest = row.messages?.[0]?.content?.trim() ?? '';
      const preview = latest.length > PREVIEW_MAX ? `${latest.slice(0, PREVIEW_MAX)}…` : latest;

      // Unread = new activity since this volunteer last opened it (or never opened).
      // Shared predicate (see src/lib/care-inbox.ts) so the home stats strip reuses it.
      const unread = isUnread(row.last_message_at, readMap.get(row.id) ?? null);

      const item = {
        id: row.id,
        contactName: contact?.display_name || '匿名访客',
        channel: row.channel,
        stage: contact?.stage ?? null,
        status: row.status,
        category: row.category ?? null,
        crisisFlag: row.crisis_flag ?? false,
        lastMessagePreview: preview,
        lastMessageAt: row.last_message_at,
        unread,
        assignedToMe: row.assigned_volunteer === access.volunteer.id,
      };

      // ?q= matches contact name, wa_id, or the FULL last-message content
      // (case-insensitive substring — the ILIKE equivalent for our small dataset).
      const haystack = `${contact?.display_name ?? ''}\n${contact?.wa_id ?? ''}\n${latest}`.toLowerCase();
      return { item, haystack };
    })
    .filter(({ haystack }) => !q || haystack.includes(q))
    .map(({ item }) => item);

  return NextResponse.json({ conversations });
}
