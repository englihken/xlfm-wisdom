// src/app/api/home/summary/route.ts
// GET — the 主页 v2 role-aware cockpit payload, assembled server-side in ONE response
// (no client fan-out, E2 §5.5). Iron rule: surfaces ONLY what the caller could already open
// in the modules — same wall logic, read-only counts + deep links, no new permissions.
// Every block is present only when the caller holds its gating grant; degrade gracefully.

import { NextResponse } from 'next/server';
import { getActiveVolunteer, getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { grantAllows, type Grants } from '@/lib/access';
import { getInboxAccess, contentMailboxIds } from '@/lib/inbox-scope';
import { loadVisibleMailboxes, countsByMailbox, ownersByMailbox, loadEscalation } from '@/lib/inbox-server';
import { ageDays, overdueLevel, snippet } from '@/lib/inbox';
import { countUnreadConversations } from '@/lib/care-inbox';

export const runtime = 'nodejs';

const ACTION_CN: Record<string, string> = {
  create: '新增', update: '更新', deactivate: '停用', reactivate: '启用', import: '导入',
  thread_created: '新建来信', replied: '回复', assigned: '指派', transferred: '转办',
  status_changed: '更新状态', 'outreach.person_create': '新增善缘', centre_created: '新增共修会',
};

export async function GET() {
  const access = await getActiveVolunteer();
  if (!access) {
    const user = await getAuthenticatedUser();
    return NextResponse.json({ error: user ? 'Not an active volunteer' : 'Unauthorized' }, { status: user ? 403 : 401 });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const db = supabaseAdmin;
  const me = access.volunteer;

  const grants: Grants = {};
  const { data: grantRows } = await db.from('role_grants').select('module, access').eq('role', me.role);
  for (const g of grantRows ?? []) grants[g.module as keyof Grants] = g.access;
  const careEdit = grantAllows(grants, 'care', 'edit');

  const nowMs = Date.now();
  const tiles: { key: string; label: string; value: number; sub?: string; href: string }[] = [];
  const out: {
    role: string;
    tiles: typeof tiles;
    crisis: { allowed: boolean; count: number } | null;
    inboxCard: unknown;
    myTasks: { id: string; kind: string; label: string; sub: string; href: string; chip: string }[];
    outreachMonth: { new_contacts: number; started_chanting: number } | null;
    recentMembers: { id: string; name: string; centreCode: string | null; updatedAt: string }[] | null;
    recentAudit: { id: number; line: string; at: string }[] | null;
  } = { role: me.role, tiles, crisis: null, inboxCard: null, myTasks: [], outreachMonth: null, recentMembers: null, recentAudit: null };

  // ── care unread tile (care ≥ edit) ─────────────────────────────────────────
  if (careEdit) {
    const unread = await countUnreadConversations(me.id);
    tiles.push({ key: 'care', label: '未读对话', value: unread, href: '/dashboard' });
  }

  // ── inbox blocks ────────────────────────────────────────────────────────────
  const inbox = await getInboxAccess(db, me);
  if (inbox.level !== 'none') {
    const visible = await loadVisibleMailboxes(db, inbox);
    const ids = visible.map((m) => m.id);
    const counts = await countsByMailbox(db, ids);

    if (inbox.level === 'admin' || inbox.level === 'summary') {
      // national totals + health mini-table + surfaced
      let totalNew = 0;
      let oldest = 0;
      for (const m of visible) {
        const c = counts.get(m.id)!;
        totalNew += c.new_n;
        if (c.oldest_unhandled_iso) oldest = Math.max(oldest, ageDays(c.oldest_unhandled_iso, nowMs));
      }
      tiles.push({ key: 'inbox', label: '事务未处理', value: totalNew, sub: totalNew ? `最旧 ${oldest} 天 · 全国` : undefined, href: '/dashboard/inbox' });

      const esc = await loadEscalation(db);
      const owners = await ownersByMailbox(db, ids);
      const top = visible
        .map((m) => ({ m, c: counts.get(m.id)! }))
        .sort((a, b) => b.c.new_n - a.c.new_n)
        .slice(0, 3)
        .map(({ m, c }) => ({
          mailbox_id: m.id,
          centre_name: m.centre_name,
          new_n: c.new_n,
          oldest_unhandled_days: c.oldest_unhandled_iso ? ageDays(c.oldest_unhandled_iso, nowMs) : 0,
          owners_label: (owners.get(m.id) ?? []).map((o) => o.name).join('、') || '未指派',
        }));

      // surfaced (>surface_hq_days) subjects — the sanctioned HQ exception
      let surfaced: { id: string; subject: string; age_days: number }[] = [];
      if (ids.length) {
        const { data: th } = await db.from('inbox_threads').select('id, subject, status, last_message_at').in('mailbox_id', ids);
        surfaced = (th ?? [])
          .map((t) => ({ id: t.id as string, subject: t.subject as string, status: t.status as string, age: ageDays(t.last_message_at as string, nowMs) }))
          .filter((t) => overdueLevel(t.status, t.age, esc) === 'surface')
          .sort((a, b) => b.age - a.age)
          .slice(0, 5)
          .map((t) => ({ id: t.id, subject: t.subject, age_days: t.age }));
      }
      out.inboxCard = { mode: 'health', health: top, surfaced };
    } else {
      // owner / centre_head: my mailbox's top unhandled threads
      const mine = new Set(contentMailboxIds(inbox));
      const myBoxes = visible.filter((m) => mine.has(m.id));
      let totalNew = 0;
      let oldest = 0;
      let centreLabel = '';
      for (const m of myBoxes) {
        const c = counts.get(m.id)!;
        totalNew += c.new_n;
        if (c.oldest_unhandled_iso) oldest = Math.max(oldest, ageDays(c.oldest_unhandled_iso, nowMs));
        if (!centreLabel) centreLabel = m.centre_name;
      }
      tiles.push({ key: 'inbox', label: '事务未处理', value: totalNew, sub: totalNew ? `最旧 ${oldest} 天 · ${centreLabel}` : undefined, href: '/dashboard/inbox' });

      let threads: { id: string; subject: string; sender_name: string | null; age_days: number; centre_name: string }[] = [];
      if (myBoxes.length) {
        const { data: th } = await db
          .from('inbox_threads')
          .select('id, mailbox_id, subject, sender_name, status, last_message_at')
          .in('mailbox_id', myBoxes.map((m) => m.id))
          .in('status', ['new', 'in_progress'])
          .order('last_message_at', { ascending: true })
          .limit(3);
        const nameByBox = new Map(myBoxes.map((m) => [m.id, m.centre_name]));
        threads = (th ?? []).map((t) => ({
          id: t.id as string,
          subject: t.subject as string,
          sender_name: (t.sender_name as string | null) ?? null,
          age_days: ageDays(t.last_message_at as string, nowMs),
          centre_name: nameByBox.get(t.mailbox_id as string) ?? '',
        }));
      }
      out.inboxCard = { mode: 'owner', threads };
    }
  }

  // ── members fallback tile (only if no care/inbox tile yet) ──────────────────
  if (tiles.length === 0 && grantAllows(grants, 'members', 'view')) {
    const { count } = await db.from('members').select('id', { count: 'exact', head: true }).eq('status', 'active');
    tiles.push({ key: 'members', label: '会员总数', value: count ?? 0, href: '/dashboard/members' });
  }

  // ── crisis strip (admin OR care ≥ edit) ────────────────────────────────────
  const isAdmin = grants.inbox === 'admin';
  if (isAdmin || careEdit) {
    const { count } = await db.from('inbox_threads').select('id', { count: 'exact', head: true }).eq('crisis_flag', true).neq('status', 'archived');
    out.crisis = { allowed: true, count: count ?? 0 };
  }

  // ── 我的事项: inbox threads assigned to me (new/in_progress) ────────────────
  if (inbox.level !== 'none') {
    const { data: assigned } = await db
      .from('inbox_threads')
      .select('id, subject, status, last_message_at, mailbox:inbox_mailboxes!mailbox_id ( centre:centres!centre_id ( name_cn ) )')
      .eq('assigned_to', me.id)
      .in('status', ['new', 'in_progress'])
      .order('last_message_at', { ascending: true })
      .limit(6);
    for (const t of assigned ?? []) {
      const mb = Array.isArray(t.mailbox) ? t.mailbox[0] : t.mailbox;
      const centre = mb ? (Array.isArray(mb.centre) ? mb.centre[0] : mb.centre) : null;
      out.myTasks.push({
        id: t.id as string,
        kind: 'inbox',
        label: snippet(t.subject as string, 40),
        sub: `${(centre?.name_cn as string) ?? ''} · ${ageDays(t.last_message_at as string, nowMs)} 天`,
        href: `/dashboard/inbox?thread=${t.id}`,
        chip: '事务',
      });
    }
  }

  // ── 渡人 · 本月 (outreach ≥ view; centre_head sees own-centre numbers) ───────
  if (grantAllows(grants, 'outreach', 'view')) {
    const monthStart = new Date(new Date(nowMs).toISOString().slice(0, 7) + '-01').toISOString().slice(0, 10);
    // centre scope for centre_head
    let scopeCentre: string | null = null;
    if (!grantAllows(grants, 'outreach', 'admin')) {
      const { data: vol } = await db.from('volunteers').select('scope, centre_id').eq('id', me.id).maybeSingle();
      if (vol?.scope !== 'all_centers') scopeCentre = (vol?.centre_id as string | null) ?? null;
    }
    const { data: ms } = await db
      .from('contact_milestones')
      .select('milestone, contact:contacts!contact_id ( centre_id )')
      .gte('happened_on', monthStart)
      .in('milestone', ['first_contact', 'started_chanting']);
    let newContacts = 0;
    let chanting = 0;
    for (const m of ms ?? []) {
      const c = Array.isArray(m.contact) ? m.contact[0] : m.contact;
      if (scopeCentre && (c?.centre_id as string | null) !== scopeCentre) continue;
      if (m.milestone === 'first_contact') newContacts++;
      if (m.milestone === 'started_chanting') chanting++;
    }
    out.outreachMonth = { new_contacts: newContacts, started_chanting: chanting };
  }

  // ── 最近会员动态 (members ≥ view; scope-aware) ──────────────────────────────
  if (grantAllows(grants, 'members', 'view')) {
    const { data: vol } = await db.from('volunteers').select('scope, centre_id').eq('id', me.id).maybeSingle();
    const scoped = vol?.scope !== 'all_centers';
    const centreId = (vol?.centre_id as string | null) ?? null;
    if (!scoped || centreId) {
      let rq = db.from('members').select('id, name_cn, name_en, updated_at, centre:centres ( code )').order('updated_at', { ascending: false }).limit(3);
      if (scoped && centreId) rq = rq.eq('gyt_centre_id', centreId);
      const { data: rows } = await rq;
      out.recentMembers = (rows ?? []).map((r) => {
        const centre = Array.isArray(r.centre) ? r.centre[0] : r.centre;
        return { id: r.id as string, name: (r.name_cn as string) || (r.name_en as string) || '（无名）', centreCode: (centre?.code as string) ?? null, updatedAt: r.updated_at as string };
      });
    } else {
      out.recentMembers = [];
    }
  }

  // ── 系统动态 (admin only) ───────────────────────────────────────────────────
  if (me.role === 'admin') {
    const { data: rows } = await db.from('audit_log').select('id, at, actor_email, action, table_name, record_id').order('id', { ascending: false }).limit(6);
    out.recentAudit = (rows ?? []).map((r) => {
      const actor = (r.actor_email as string | null) || '系统';
      const act = ACTION_CN[r.action as string] ?? (r.action as string);
      const ref = r.record_id ? ` (${String(r.record_id).slice(0, 8)})` : '';
      return { id: r.id as number, line: `${actor} ${act}${ref}`, at: r.at as string };
    });
  }

  return NextResponse.json(out);
}
