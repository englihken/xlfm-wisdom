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
import { testContactIds, excludeTestContacts } from '@/lib/test-traffic';

export const runtime = 'nodejs';

const PREVIEW_MAX = 120;

type ContactLite = {
  display_name: string | null;
  channel: string | null;
  stage: string | null;
  wa_id: string | null;
  phone?: string | null;
};
type MessageLite = { content: string | null; created_at: string; role?: string | null };

// "别再把访客弄丢" §4: a conversation whose latest message is the visitor's and
// has waited this long with no reply of any kind is surfaced in the 未回复 tab.
const AWAITING_REPLY_AFTER_MS = 10 * 60 * 1000;
// Contact details typed into the message itself (phone / email / WhatsApp
// number) — the visitor said how to reach them, so they sort first.
const CONTACT_IN_TEXT_RE = /(\+?6?0?1\d[\d\s-]{7,10}\d)|([\w.+-]+@[\w-]+\.[\w.]+)|(wa\.me\/\d+)/i;
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
  // (ordered desc, limited to 1 per conversation for the preview). Synthetic
  // contacts (chip warm-ups / test suites) are excluded from the list, which is
  // what the 全部 / 我接手的 / 未回复 tabs all count off.
  const testIds = await testContactIds(supabaseAdmin);
  const { data, error } = await excludeTestContacts(
    supabaseAdmin
      .from('conversations')
      .select(
        `id, channel, status, category, crisis_flag, assigned_volunteer, last_message_at,
       contact:contacts ( display_name, channel, stage, wa_id, phone ),
       messages ( content, created_at, role )`
      ),
    testIds
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

      // Awaiting reply = the newest message is the visitor's (no AI or
      // volunteer reply after it) and it has waited past the threshold.
      const latestRole = row.messages?.[0]?.role ?? null;
      const waitingSinceMs = latestRole === 'user' ? Date.now() - new Date(row.last_message_at).getTime() : 0;
      const awaitingReply = latestRole === 'user' && waitingSinceMs >= AWAITING_REPLY_AFTER_MS && row.status !== 'volunteer_handling';
      const hasContactInfo = Boolean(contact?.wa_id || contact?.phone) || CONTACT_IN_TEXT_RE.test(latest);

      const item = {
        awaitingReply,
        waitingSinceMs,
        hasContactInfo,
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
