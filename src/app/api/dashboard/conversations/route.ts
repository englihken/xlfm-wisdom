// src/app/api/dashboard/conversations/route.ts
// GET the volunteer inbox: all conversations, newest activity first, each shaped
// for the left-panel list item. Auth-gated (401 if the caller isn't a logged-in
// volunteer), then queried with the service-role client (supabaseAdmin).
//
// Adds per-volunteer `unread` (via conversation_reads) and an optional ?q= search
// over contact name / wa_id / last-message content. Data volumes are small, so the
// search + unread joins are resolved in JS rather than pushed into PostgREST.
//
// Tab counts (09-13 prayer-form brief §3): PostgREST returns at most 1,000 rows
// per request, so counting 未回复 off the list showed 261 while the database
// held 461. `counts` is now exact: 全部 / 我接手的 are count-exact head queries,
// 未回复 is a paginated scan of (status, last_message_at, latest role) — there
// is no column for the latest message's role, so no head count can express it.
// Awaiting conversations older than the first 1,000 rows are appended to the
// list so the 未回复 tab shows every one it counts.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isUnread } from '@/lib/care-inbox';
import { testContactIds, excludeTestContacts } from '@/lib/test-traffic';

export const runtime = 'nodejs';

const PREVIEW_MAX = 120;
// PostgREST max-rows on this project.
const PAGE_SIZE = 1000;

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

const LIST_SELECT = `id, channel, status, category, crisis_flag, assigned_volunteer, last_message_at,
       contact:contacts ( display_name, channel, stage, wa_id, phone ),
       messages ( content, created_at, role )`;

/** The one 未回复 predicate — used for list items and the exact count alike. */
function isAwaitingReply(latestRole: string | null, lastMessageAt: string, status: string, nowMs: number): boolean {
  return (
    latestRole === 'user' &&
    nowMs - new Date(lastMessageAt).getTime() >= AWAITING_REPLY_AFTER_MS &&
    status !== 'volunteer_handling'
  );
}

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
  const db = supabaseAdmin;

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().toLowerCase();
  const nowMs = Date.now();

  // Synthetic contacts (chip warm-ups / test suites) are excluded from the
  // list and from every tab count.
  const testIds = await testContactIds(db);

  // Every awaiting-reply conversation id, across all pages. Rows carry only
  // the latest message's role, so each page is small.
  const scanAwaiting = async (): Promise<string[]> => {
    const ids = new Set<string>();
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await excludeTestContacts(
        db.from('conversations').select('id, status, last_message_at, messages ( role, created_at )'),
        testIds
      )
        .order('last_message_at', { ascending: false })
        .order('id', { ascending: true })
        .order('created_at', { referencedTable: 'messages', ascending: false })
        .limit(1, { referencedTable: 'messages' })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as { id: string; status: string; last_message_at: string; messages: { role: string | null }[] | null }[];
      for (const r of page) {
        if (isAwaitingReply(r.messages?.[0]?.role ?? null, r.last_message_at, r.status, nowMs)) ids.add(r.id);
      }
      if (page.length < PAGE_SIZE) break;
    }
    return [...ids];
  };

  // One query for the list: conversations + their contact + only their latest
  // message (ordered desc, limited to 1 per conversation for the preview).
  const [listRes, allRes, mineRes, awaitingIds, readsRes] = await Promise.all([
    excludeTestContacts(db.from('conversations').select(LIST_SELECT), testIds)
      .order('last_message_at', { ascending: false })
      .order('created_at', { referencedTable: 'messages', ascending: false })
      .limit(1, { referencedTable: 'messages' }),
    excludeTestContacts(db.from('conversations').select('id', { count: 'exact', head: true }), testIds),
    excludeTestContacts(db.from('conversations').select('id', { count: 'exact', head: true }), testIds).eq(
      'assigned_volunteer',
      access.volunteer.id
    ),
    scanAwaiting().catch((e) => {
      console.error('[dashboard] awaiting-reply scan failed:', e);
      return null;
    }),
    // This volunteer's read markers → a map of conversation_id → last_read_at.
    db.from('conversation_reads').select('conversation_id, last_read_at').eq('volunteer_id', access.volunteer.id),
  ]);

  if (listRes.error) {
    console.error('[dashboard] conversations list failed:', listRes.error);
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 });
  }

  const readMap = new Map<string, string>();
  if (readsRes.error) {
    // Non-fatal: without reads everything simply shows as unread.
    console.error('[dashboard] conversation_reads fetch failed:', readsRes.error);
  } else {
    for (const r of readsRes.data ?? []) readMap.set(r.conversation_id, r.last_read_at);
  }

  const rows = (listRes.data ?? []) as unknown as ConversationRow[];

  // Awaiting conversations beyond the first page: fetch and append (they are
  // older than every listed row, so appending keeps newest-first order).
  if (awaitingIds) {
    const listed = new Set(rows.map((r) => r.id));
    const missing = awaitingIds.filter((id) => !listed.has(id));
    const extra: ConversationRow[] = [];
    for (let i = 0; i < missing.length; i += 100) {
      const { data, error } = await db
        .from('conversations')
        .select(LIST_SELECT)
        .in('id', missing.slice(i, i + 100))
        .order('created_at', { referencedTable: 'messages', ascending: false })
        .limit(1, { referencedTable: 'messages' });
      if (error) {
        console.error('[dashboard] awaiting-reply rows fetch failed:', error);
        break;
      }
      extra.push(...((data ?? []) as unknown as ConversationRow[]));
    }
    extra.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
    rows.push(...extra);
  }

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
      const waitingSinceMs = latestRole === 'user' ? nowMs - new Date(row.last_message_at).getTime() : 0;
      const awaitingReply = isAwaitingReply(latestRole, row.last_message_at, row.status, nowMs);
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

  // Exact whole-inbox tab counts (null when that count query failed — the UI
  // then falls back to counting the list).
  const counts = {
    all: allRes.error ? null : allRes.count,
    mine: mineRes.error ? null : mineRes.count,
    unanswered: awaitingIds ? awaitingIds.length : null,
  };

  return NextResponse.json({ conversations, counts });
}
