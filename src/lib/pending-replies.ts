// src/lib/pending-replies.ts — 教义护栏 brief §7: volunteer messages a visitor
// has not seen yet (they left the page before the volunteer answered). Used by
// GET /api/chat/pending-replies (the /qa card) and by the chat pipeline (the bot
// is told what a volunteer recently told this visitor).

import { supabaseAdmin } from './supabase';

export type PendingVolunteerReply = {
  conversation_id: string;
  message_id: string;
  content: string;
  created_at: string;
  first_question: string;
};

/**
 * Volunteer messages this browser has not seen: newest per conversation, newer
 * than the visitor's last message there, within `days`. Shared with the chat
 * pipeline (the bot is told about recent corrections — §7 third bullet).
 * Returns null on a database error.
 */
export async function pendingVolunteerReplies(
  browserId: string,
  days: number,
  opts: { excludeConversationId?: string | null; includeSeen?: boolean } = {}
): Promise<PendingVolunteerReply[] | null> {
  if (!supabaseAdmin) return [];
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data: contacts, error: cErr } = await supabaseAdmin.from('contacts').select('id').eq('browser_id', browserId);
  if (cErr) {
    console.error('[pending-replies] contacts fetch failed:', cErr);
    return null;
  }
  const contactIds = (contacts ?? []).map((c) => c.id as string);
  if (contactIds.length === 0) return [];
  const { data: convs, error: vErr } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .in('contact_id', contactIds);
  if (vErr) {
    console.error('[pending-replies] conversations fetch failed:', vErr);
    return null;
  }
  const convIds = (convs ?? []).map((c) => c.id as string).filter((id) => id !== opts.excludeConversationId);
  if (convIds.length === 0) return [];
  const { data: msgs, error: mErr } = await supabaseAdmin
    .from('messages')
    .select('id, conversation_id, role, content, created_at')
    .in('conversation_id', convIds)
    .in('role', ['user', 'volunteer'])
    .order('created_at', { ascending: true });
  if (mErr) {
    console.error('[pending-replies] messages fetch failed:', mErr);
    return null;
  }
  const byConv = new Map<string, { id: string; role: string; content: string; created_at: string }[]>();
  for (const m of msgs ?? []) {
    const list = byConv.get(m.conversation_id as string) ?? [];
    list.push(m as { id: string; role: string; content: string; created_at: string });
    byConv.set(m.conversation_id as string, list);
  }
  const out: PendingVolunteerReply[] = [];
  for (const [convId, list] of byConv) {
    const firstUser = list.find((m) => m.role === 'user');
    const lastUserAt = [...list].reverse().find((m) => m.role === 'user')?.created_at ?? '';
    const vols = list.filter((m) => m.role === 'volunteer' && m.created_at >= since && (opts.includeSeen || m.created_at > lastUserAt));
    const latest = vols[vols.length - 1];
    if (!latest || !latest.content?.trim()) continue;
    out.push({
      conversation_id: convId,
      message_id: latest.id,
      content: latest.content,
      created_at: latest.created_at,
      first_question: (firstUser?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
    });
  }
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return out;
}
