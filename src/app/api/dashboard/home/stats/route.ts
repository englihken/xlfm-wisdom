// src/app/api/dashboard/home/stats/route.ts
// GET — the hub "My Day" payload, in ONE response. Gated to any active volunteer,
// but each block is present ONLY when the caller holds its gating grant (never
// leaks a cross-wing block). Service-role queries apply centre scope EXPLICITLY.
//
//   care ≥ view    → stats.care { unread, myAssignedUnread } + myConversations[≤3]
//   members ≥ view → stats.members { activeCount } + recentMembers[≤3]  (scope-aware)
//   audit ≥ view   → recentAudit[≤5]  (human-readable one-liners, built server-side)

import { NextResponse } from 'next/server';
import { getActiveVolunteer, getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { grantAllows, type Grants } from '@/lib/access';
import { countUnreadConversations, isUnread } from '@/lib/care-inbox';

export const runtime = 'nodejs';

const PREVIEW_MAX = 80;

type ContactLite = { display_name: string | null };
type MessageLite = { content: string | null; created_at: string };
type AssignedRow = {
  id: string;
  last_message_at: string;
  contact: ContactLite | ContactLite[] | null;
  messages: MessageLite[] | null;
};

const ACTION_CN: Record<string, string> = {
  create: '新增',
  update: '更新',
  deactivate: '停用',
  reactivate: '启用',
  import: '导入',
};
const TABLE_CN: Record<string, string> = {
  members: '会员',
  member_teams: '会员组别',
  member_skills: '会员专长',
  import_batches: '导入批次',
  legacy_rows: '导入记录',
};

export async function GET() {
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

  const me = access.volunteer;

  // Grants for this role (which blocks to build).
  const grants: Grants = {};
  const { data: grantRows } = await supabaseAdmin
    .from('role_grants')
    .select('module, access')
    .eq('role', me.role);
  for (const g of grantRows ?? []) grants[g.module as keyof Grants] = g.access;

  const body: {
    stats: { care?: { unread: number; myAssignedUnread: number }; members?: { activeCount: number } };
    myConversations?: { id: string; contactName: string; preview: string; lastMessageAt: string; unread: boolean }[];
    recentMembers?: { id: string; name: string; centreCode: string | null; updatedAt: string }[];
    recentAudit?: { id: number; line: string; at: string }[];
  } = { stats: {} };

  // ── care ≥ view : unread totals + my assigned conversations ────────────────
  if (grantAllows(grants, 'care', 'view')) {
    const [unread, { data: assigned }, { data: myReads }] = await Promise.all([
      countUnreadConversations(me.id),
      supabaseAdmin
        .from('conversations')
        .select('id, last_message_at, contact:contacts ( display_name ), messages ( content, created_at )')
        .eq('assigned_volunteer', me.id)
        .order('last_message_at', { ascending: false })
        .order('created_at', { referencedTable: 'messages', ascending: false })
        .limit(1, { referencedTable: 'messages' }),
      supabaseAdmin.from('conversation_reads').select('conversation_id, last_read_at').eq('volunteer_id', me.id),
    ]);

    const readMap = new Map<string, string>();
    for (const r of myReads ?? []) readMap.set(r.conversation_id, r.last_read_at);

    const mine = ((assigned ?? []) as unknown as AssignedRow[]).map((row) => {
      const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
      const latest = row.messages?.[0]?.content?.trim() ?? '';
      const preview = latest.length > PREVIEW_MAX ? `${latest.slice(0, PREVIEW_MAX)}…` : latest;
      return {
        id: row.id,
        contactName: contact?.display_name || '匿名访客',
        preview,
        lastMessageAt: row.last_message_at,
        unread: isUnread(row.last_message_at, readMap.get(row.id) ?? null),
      };
    });

    const myAssignedUnread = mine.filter((c) => c.unread).length;
    // Unread first, then most-recent activity.
    const top = [...mine]
      .sort((a, b) => {
        if (a.unread !== b.unread) return a.unread ? -1 : 1;
        return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
      })
      .slice(0, 3);

    body.stats.care = { unread, myAssignedUnread };
    body.myConversations = top;
  }

  // ── members ≥ view : active count + recent members (scope-aware) ───────────
  if (grantAllows(grants, 'members', 'view')) {
    const { data: vol } = await supabaseAdmin
      .from('volunteers')
      .select('scope, centre_id')
      .eq('id', me.id)
      .maybeSingle();
    const scope = vol?.scope === 'all_centers' ? 'all_centers' : 'own_center';
    const centreId = (vol?.centre_id as string | null) ?? null;
    const scoped = scope === 'own_center'; // own_center → must filter to centreId

    let activeCount = 0;
    let recentMembers: { id: string; name: string; centreCode: string | null; updatedAt: string }[] = [];

    if (!scoped || centreId) {
      // active count
      let cq = supabaseAdmin.from('members').select('id', { count: 'exact', head: true }).eq('status', 'active');
      if (scoped && centreId) cq = cq.eq('gyt_centre_id', centreId);
      const { count } = await cq;
      activeCount = count ?? 0;

      // recent members (created or updated) — updated_at is set on insert AND update
      let rq = supabaseAdmin
        .from('members')
        .select('id, name_cn, name_en, updated_at, centre:centres ( code )')
        .order('updated_at', { ascending: false })
        .limit(3);
      if (scoped && centreId) rq = rq.eq('gyt_centre_id', centreId);
      const { data: rows } = await rq;
      recentMembers = ((rows ?? []) as {
        id: string;
        name_cn: string | null;
        name_en: string | null;
        updated_at: string;
        centre: { code: string } | { code: string }[] | null;
      }[]).map((r) => {
        const centre = Array.isArray(r.centre) ? r.centre[0] : r.centre;
        return {
          id: r.id,
          name: r.name_cn || r.name_en || '（无名）',
          centreCode: centre?.code ?? null,
          updatedAt: r.updated_at,
        };
      });
    } // else own_center + no centre → fail-closed (0 / empty)

    body.stats.members = { activeCount };
    body.recentMembers = recentMembers;
  }

  // ── audit ≥ view : last 5 audit rows as one-liners (admin only today) ──────
  if (grantAllows(grants, 'audit', 'view')) {
    const { data: rows } = await supabaseAdmin
      .from('audit_log')
      .select('id, at, actor_email, action, table_name, record_id')
      .order('id', { ascending: false })
      .limit(5);
    body.recentAudit = ((rows ?? []) as {
      id: number;
      at: string;
      actor_email: string | null;
      action: string;
      table_name: string;
      record_id: string | null;
    }[]).map((r) => {
      const actor = r.actor_email || '系统';
      const act = ACTION_CN[r.action] ?? r.action;
      const table = TABLE_CN[r.table_name] ?? r.table_name;
      const ref = r.record_id ? ` (${String(r.record_id).slice(0, 8)})` : '';
      return { id: r.id, line: `${actor} ${act}了${table}${ref}`, at: r.at };
    });
  }

  return NextResponse.json(body);
}
