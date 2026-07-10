// src/app/api/inbox/meta/route.ts
// GET the caller's visible mailboxes (rail + health board), counts, escalation config,
// and their effective inbox level. Service-role reads; inbox-scope is the wall.

import { NextResponse } from 'next/server';
import {
  resolveInbox,
  loadVisibleMailboxes,
  countsByMailbox,
  ownersByMailbox,
  loadEscalation,
  myCentreIds,
} from '@/lib/inbox-server';
import { contentMailboxIds } from '@/lib/inbox-scope';
import { ageDays } from '@/lib/inbox';

export const runtime = 'nodejs';

export async function GET() {
  const r = await resolveInbox();
  if (!r.ok) return r.res;
  const { db, access } = r;
  if (access.level === 'none') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [mailboxes, escalation] = await Promise.all([loadVisibleMailboxes(db, access), loadEscalation(db)]);
  const ids = mailboxes.map((m) => m.id);
  const [counts, owners, centreIds] = await Promise.all([
    countsByMailbox(db, ids),
    ownersByMailbox(db, ids),
    myCentreIds(db, access),
  ]);

  const nowMs = Date.now();
  const openable = new Set(contentMailboxIds(access));

  const out = mailboxes.map((m) => {
    const c = counts.get(m.id)!;
    const owned = openable.has(m.id);
    return {
      id: m.id,
      centre_id: m.centre_id,
      centre_name: m.centre_name,
      centre_code: m.centre_code,
      is_enabled: m.is_enabled,
      auto_reply_enabled: m.auto_reply_enabled,
      auto_reply_text: m.auto_reply_text,
      owners: owners.get(m.id) ?? [],
      // admin can open non-owned mailboxes only via break-glass; summary can't open content at all.
      owned,
      locked: !owned,
      counts: { new_n: c.new_n, in_progress_n: c.in_progress_n, crisis_n: c.crisis_n },
      oldest_unhandled_days: c.oldest_unhandled_iso ? ageDays(c.oldest_unhandled_iso, nowMs) : 0,
    };
  });

  // Internal folder: count of unhandled internal threads touching my centres (either side).
  let internalNew = 0;
  if (centreIds.length > 0) {
    const myBoxIds = mailboxes.filter((m) => centreIds.includes(m.centre_id)).map((m) => m.id);
    const { data: internal } = await db
      .from('inbox_threads')
      .select('id, status, mailbox_id, from_centre_id')
      .eq('kind', 'internal')
      .or(`mailbox_id.in.(${myBoxIds.length ? myBoxIds.join(',') : '00000000-0000-0000-0000-000000000000'}),from_centre_id.in.(${centreIds.join(',')})`);
    internalNew = (internal ?? []).filter((t) => t.status === 'new').length;
  }

  // Compose/transfer targets: ALL enabled mailboxes (any centre). Sending/transferring TO a
  // mailbox is not reading it, so this is intentionally NOT wall-scoped — a 分会负责人 must be
  // able to address 总会 (the 分会→总会 调货/批核 flow, E2 §4). Only exposed to content roles.
  const canCompose = access.level === 'admin' || access.level === 'edit' || access.level === 'owner-only';
  let composeTargets: { id: string; centre_name: string }[] = [];
  if (canCompose) {
    const { data: allEnabled } = await db
      .from('inbox_mailboxes')
      .select('id, centre:centres!centre_id ( name_cn, sort )')
      .eq('is_enabled', true);
    composeTargets = (allEnabled ?? [])
      .map((m) => {
        const c = Array.isArray(m.centre) ? m.centre[0] : m.centre;
        return { id: m.id as string, centre_name: (c?.name_cn as string) ?? '—', sort: (c?.sort as number) ?? 0 };
      })
      .sort((a, b) => a.sort - b.sort || a.centre_name.localeCompare(b.centre_name))
      .map(({ id, centre_name }) => ({ id, centre_name }));
  }

  return NextResponse.json({
    level: access.level,
    escalation,
    mailboxes: out,
    internal: { new_n: internalNew },
    can_compose_internal: canCompose,
    compose_targets: composeTargets,
    my_centre_ids: centreIds,
  });
}
