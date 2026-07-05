// src/lib/care-inbox.ts
// Shared care-inbox helpers so the unread logic lives in ONE place (used by the
// conversations list route and the home stats strip — no duplication).

import { supabaseAdmin } from './supabase';

// A conversation is unread for a volunteer when there's new activity since they last
// opened it (or they never opened it). This is the single unread predicate.
export function isUnread(lastMessageAt: string, lastReadAt: string | null | undefined): boolean {
  return !lastReadAt || new Date(lastMessageAt).getTime() > new Date(lastReadAt).getTime();
}

// Count unread conversations for a volunteer (home stats). Fail-safe: 0 without
// storage or on error.
export async function countUnreadConversations(volunteerId: string): Promise<number> {
  if (!supabaseAdmin) return 0;
  try {
    const [{ data: convs }, { data: reads }] = await Promise.all([
      supabaseAdmin.from('conversations').select('id, last_message_at'),
      supabaseAdmin
        .from('conversation_reads')
        .select('conversation_id, last_read_at')
        .eq('volunteer_id', volunteerId),
    ]);
    const readMap = new Map<string, string>();
    for (const r of reads ?? []) readMap.set(r.conversation_id, r.last_read_at);
    let n = 0;
    for (const c of convs ?? []) {
      if (isUnread(c.last_message_at as string, readMap.get(c.id as string))) n++;
    }
    return n;
  } catch (e) {
    console.error('[care-inbox] unread count failed:', e);
    return 0;
  }
}
