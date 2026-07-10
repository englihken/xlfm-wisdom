// src/lib/inbox-server.ts
// Server-only query helpers shared by the 收件箱 API routes. Keeps the wall logic
// (inbox-scope.ts) and the read shapes in one place so meta / health / threads stay
// consistent. All reads go through the service-role client — inbox-scope IS the wall.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from './supabase';
import { getActiveVolunteer, type Volunteer } from './supabase-server';
import { getInboxAccess, canOpenMailbox, type InboxAccess } from './inbox-scope';
import { ACCESS_RANK, type AccessLevel } from './access';
import { DEFAULT_ESCALATION, type Escalation } from './inbox';

export type Db = NonNullable<typeof supabaseAdmin>;

// Resolve the caller + their inbox access, or a ready-to-return gate response.
export async function resolveInbox(): Promise<
  | { ok: true; db: Db; volunteer: Volunteer; access: InboxAccess }
  | { ok: false; res: NextResponse }
> {
  const active = await getActiveVolunteer();
  if (!active || !supabaseAdmin) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const access = await getInboxAccess(supabaseAdmin, active.volunteer);
  return { ok: true, db: supabaseAdmin, volunteer: active.volunteer, access };
}

export const notFound = () => NextResponse.json({ error: '不存在' }, { status: 404 });
export const forbidden = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 });

type ThreadReachInput = { mailbox_id: string; kind: string; from_centre_id: string | null; crisis_flag: boolean; status: string };

// The single thread-level wall. Returns whether the caller may READ the thread, ACT on it,
// and whether reading it counts as an admin break-glass (the caller must audit that). Paths:
//  - owns/centre-scopes the mailbox → full access;
//  - internal thread sender side → full access;
//  - crisis (non-archived) + care≥edit or admin → national follow-up access (E2 §1.4, no glass);
//  - admin + ?breakglass=1 on a non-owned mailbox → access via audited break-glass.
export async function threadReach(
  db: Db,
  access: InboxAccess,
  volunteer: Volunteer,
  thread: ThreadReachInput,
  breakglass: boolean
): Promise<{ read: boolean; act: boolean; brokeGlass: boolean }> {
  if (canOpenMailbox(access, thread.mailbox_id)) return { read: true, act: true, brokeGlass: false };

  if (thread.kind === 'internal' && thread.from_centre_id) {
    const { data: myBoxes } = await db.from('inbox_mailboxes').select('id').eq('centre_id', thread.from_centre_id);
    const sender =
      (myBoxes ?? []).some((m) => canOpenMailbox(access, m.id as string)) || access.centreId === thread.from_centre_id;
    if (sender) return { read: true, act: true, brokeGlass: false };
  }

  if (thread.crisis_flag && thread.status !== 'archived') {
    let careEdit = false;
    if (access.level !== 'admin') {
      const { data: g } = await db.from('role_grants').select('access').eq('role', volunteer.role).eq('module', 'care').maybeSingle();
      careEdit = !!g && ACCESS_RANK[(g.access as AccessLevel) ?? 'none'] >= ACCESS_RANK['edit'];
    }
    if (access.level === 'admin' || careEdit) return { read: true, act: true, brokeGlass: false };
  }

  if (access.level === 'admin' && breakglass) return { read: true, act: true, brokeGlass: true };

  return { read: false, act: false, brokeGlass: false };
}

export type MailboxRow = {
  id: string;
  centre_id: string;
  centre_name: string;
  centre_code: string;
  centre_sort: number;
  is_enabled: boolean;
  auto_reply_enabled: boolean;
  auto_reply_text: string | null;
};

type CentreJoin = { name_cn: string | null; code: string | null; sort: number | null } | { name_cn: string | null; code: string | null; sort: number | null }[] | null;
function centreOf(j: CentreJoin) {
  const c = Array.isArray(j) ? j[0] : j;
  return { name: c?.name_cn ?? '—', code: c?.code ?? '', sort: c?.sort ?? 0 };
}

// Every mailbox the caller may SEE in the rail/health board (not necessarily open content):
//  - admin / summary: all enabled mailboxes (+ their own owned, even if disabled)
//  - centre_head (edit): their own centre's mailbox (enabled or not)
//  - owner-only: their owned mailboxes
export async function loadVisibleMailboxes(db: Db, access: InboxAccess): Promise<MailboxRow[]> {
  const sel = 'id, centre_id, is_enabled, auto_reply_enabled, auto_reply_text, centre:centres!centre_id ( name_cn, code, sort )';
  const rows = new Map<string, MailboxRow>();

  const push = (r: Record<string, unknown>) => {
    const c = centreOf(r.centre as CentreJoin);
    rows.set(r.id as string, {
      id: r.id as string,
      centre_id: r.centre_id as string,
      centre_name: c.name,
      centre_code: c.code,
      centre_sort: c.sort,
      is_enabled: r.is_enabled as boolean,
      auto_reply_enabled: r.auto_reply_enabled as boolean,
      auto_reply_text: (r.auto_reply_text as string | null) ?? null,
    });
  };

  if (access.level === 'admin' || access.level === 'summary') {
    const { data } = await db.from('inbox_mailboxes').select(sel).eq('is_enabled', true);
    (data ?? []).forEach(push);
  }
  // owned + own-centre mailboxes (by id) — always included so a disabled mailbox a person
  // owns still shows their existing threads.
  const extraIds = new Set<string>(access.ownedMailboxIds);
  if (access.centreMailboxId) extraIds.add(access.centreMailboxId);
  if (extraIds.size > 0) {
    const { data } = await db.from('inbox_mailboxes').select(sel).in('id', [...extraIds]);
    (data ?? []).forEach(push);
  }
  return [...rows.values()].sort((a, b) => a.centre_sort - b.centre_sort || a.centre_name.localeCompare(b.centre_name));
}

export type MailboxCounts = { new_n: number; in_progress_n: number; crisis_n: number; oldest_unhandled_iso: string | null };

// Per-mailbox counts from a single threads read. new_n = status 'new' (E2 §7.2 unread rule).
export async function countsByMailbox(db: Db, mailboxIds: string[]): Promise<Map<string, MailboxCounts>> {
  const map = new Map<string, MailboxCounts>();
  mailboxIds.forEach((id) => map.set(id, { new_n: 0, in_progress_n: 0, crisis_n: 0, oldest_unhandled_iso: null }));
  if (mailboxIds.length === 0) return map;
  const { data } = await db
    .from('inbox_threads')
    .select('mailbox_id, status, crisis_flag, last_message_at')
    .in('mailbox_id', mailboxIds);
  for (const t of data ?? []) {
    const m = map.get(t.mailbox_id as string);
    if (!m) continue;
    const status = t.status as string;
    if (status === 'new') m.new_n++;
    if (status === 'in_progress') m.in_progress_n++;
    if (t.crisis_flag && status !== 'archived') m.crisis_n++;
    if (status === 'new' || status === 'in_progress') {
      const iso = t.last_message_at as string;
      if (!m.oldest_unhandled_iso || iso < m.oldest_unhandled_iso) m.oldest_unhandled_iso = iso;
    }
  }
  return map;
}

// Owners per mailbox: { mailboxId -> [{id, name}] }.
export async function ownersByMailbox(db: Db, mailboxIds: string[]): Promise<Map<string, { id: string; name: string }[]>> {
  const map = new Map<string, { id: string; name: string }[]>();
  if (mailboxIds.length === 0) return map;
  const { data } = await db
    .from('inbox_mailbox_owners')
    .select('mailbox_id, volunteer_id, volunteer:volunteers!volunteer_id ( display_name, email )')
    .in('mailbox_id', mailboxIds);
  for (const r of data ?? []) {
    const v = Array.isArray(r.volunteer) ? r.volunteer[0] : r.volunteer;
    const name = (v?.display_name as string | undefined) || (v?.email as string | undefined) || '义工';
    const list = map.get(r.mailbox_id as string) ?? [];
    list.push({ id: r.volunteer_id as string, name });
    map.set(r.mailbox_id as string, list);
  }
  return map;
}

export async function loadEscalation(db: Db): Promise<Escalation> {
  const { data } = await db.from('org_settings').select('value').eq('key', 'inbox.escalation').maybeSingle();
  const v = (data?.value as Partial<Escalation> | undefined) ?? {};
  return {
    remind_centre_days: typeof v.remind_centre_days === 'number' ? v.remind_centre_days : DEFAULT_ESCALATION.remind_centre_days,
    surface_hq_days: typeof v.surface_hq_days === 'number' ? v.surface_hq_days : DEFAULT_ESCALATION.surface_hq_days,
  };
}

export async function loadCrisisKeywords(db: Db): Promise<string[]> {
  const { data } = await db.from('org_settings').select('value').eq('key', 'inbox.crisis_keywords').maybeSingle();
  const v = data?.value;
  return Array.isArray(v) ? (v as string[]).filter((s) => typeof s === 'string') : [];
}

// The mailbox centres this caller is a SENDER side of, for internal-thread visibility.
export async function myCentreIds(db: Db, access: InboxAccess): Promise<string[]> {
  const ids = new Set<string>();
  if (access.centreId) ids.add(access.centreId);
  // centres of owned mailboxes
  const boxIds = new Set(access.ownedMailboxIds);
  if (access.centreMailboxId) boxIds.add(access.centreMailboxId);
  if (boxIds.size > 0) {
    const { data } = await db.from('inbox_mailboxes').select('centre_id').in('id', [...boxIds]);
    (data ?? []).forEach((r) => ids.add(r.centre_id as string));
  }
  return [...ids];
}
