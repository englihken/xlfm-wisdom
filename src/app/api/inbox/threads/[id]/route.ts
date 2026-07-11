// src/app/api/inbox/threads/[id]/route.ts
// GET   — one thread + its messages (walled; admin break-glass audits before content).
// PATCH — status / assign / transfer / link / contact edits. Owners+admin only; all audit.

import { NextResponse } from 'next/server';
import { resolveInbox, notFound, ownersByMailbox, loadEscalation, threadReach, type Db } from '@/lib/inbox-server';
import { ageDays, overdueLevel, linkedHref, statusLabel } from '@/lib/inbox';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const THREAD_SEL =
  'id, mailbox_id, kind, from_centre_id, subject, sender_name, sender_phone, sender_email, status, assigned_to, contact_id, linked_module, linked_record_id, linked_label, crisis_flag, first_response_at, last_message_at, created_at';

async function auditBreakGlass(db: Db, actorId: string, actorEmail: string, mailboxId: string) {
  // E3 dedupe (brief §5): the same actor re-opening the same mailbox within 30
  // minutes writes ONE break_glass_view row, not one per thread click — the log
  // stays readable while 代管 still always leaves a trace. Thread-action audits
  // are untouched. Fail-open: if the dedupe check errors, we WRITE (never skip
  // an audit because a read failed).
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: recent, error: dedupeErr } = await db
    .from('audit_log')
    .select('id')
    .eq('actor_id', actorId)
    .eq('action', 'break_glass_view')
    .eq('record_id', mailboxId)
    .gte('at', since)
    .limit(1);
  if (dedupeErr) {
    console.error('[inbox] break-glass dedupe check failed (writing anyway):', dedupeErr);
  } else if (recent && recent.length > 0) {
    return;
  }

  const { data: mb } = await db.from('inbox_mailboxes').select('centre:centres!centre_id ( name_cn )').eq('id', mailboxId).maybeSingle();
  const centre = mb ? (Array.isArray(mb.centre) ? mb.centre[0] : mb.centre) : null;
  await writeAudit({
    actorId,
    actorEmail,
    module: 'inbox',
    action: 'break_glass_view',
    tableName: 'inbox_mailboxes',
    recordId: mailboxId,
    after: { mailbox: mailboxId, centre: (centre?.name_cn as string) ?? null },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveInbox();
  if (!r.ok) return r.res;
  const { db, access, volunteer } = r;
  if (access.level === 'none') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;

  const { data: t } = await db.from('inbox_threads').select(THREAD_SEL).eq('id', id).maybeSingle();
  if (!t) return notFound();

  const breakglass = new URL(req.url).searchParams.get('breakglass') === '1';
  const reach = await threadReach(db, access, volunteer, t as never, breakglass);
  if (!reach.read) return notFound();
  if (reach.brokeGlass) await auditBreakGlass(db, volunteer.id, volunteer.email, t.mailbox_id as string);

  const mailboxId = t.mailbox_id as string;
  const [{ data: messages }, owners, esc, { data: mbRow }] = await Promise.all([
    db.from('inbox_messages').select('id, direction, body, author_id, author_name, created_at').eq('thread_id', id).order('created_at', { ascending: true }),
    ownersByMailbox(db, [mailboxId]),
    loadEscalation(db),
    db.from('inbox_mailboxes').select('centre:centres!centre_id ( name_cn )').eq('id', mailboxId).maybeSingle(),
  ]);

  let assignedName: string | null = null;
  if (t.assigned_to) {
    const { data: v } = await db.from('volunteers').select('display_name, email').eq('id', t.assigned_to as string).maybeSingle();
    assignedName = (v?.display_name as string) || (v?.email as string) || null;
  }
  let fromCentreName: string | null = null;
  if (t.from_centre_id) {
    const { data: c } = await db.from('centres').select('name_cn').eq('id', t.from_centre_id as string).maybeSingle();
    fromCentreName = (c?.name_cn as string) ?? null;
  }

  const mbCentre = mbRow ? (Array.isArray(mbRow.centre) ? mbRow.centre[0] : mbRow.centre) : null;
  const nowMs = Date.now();
  const age = ageDays(t.last_message_at as string, nowMs);

  return NextResponse.json({
    thread: {
      ...t,
      status_label: statusLabel(t.status as string),
      assigned_name: assignedName,
      from_centre_name: fromCentreName,
      mailbox_centre_name: (mbCentre?.name_cn as string) ?? null,
      linked_href: linkedHref(t.linked_module as string | null, t.linked_record_id as string | null),
      age_days: age,
      overdue: overdueLevel(t.status as string, age, esc),
      broke_glass: reach.brokeGlass,
    },
    messages: messages ?? [],
    mailbox_owners: owners.get(mailboxId) ?? [],
    can_act: reach.act,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveInbox();
  if (!r.ok) return r.res;
  const { db, access, volunteer } = r;
  if (access.level === 'none' || access.level === 'summary') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;

  const { data: t } = await db.from('inbox_threads').select(THREAD_SEL).eq('id', id).maybeSingle();
  if (!t) return notFound();
  const mailboxId = t.mailbox_id as string;

  const reach = await threadReach(db, access, volunteer, t as never, new URL(req.url).searchParams.get('breakglass') === '1');
  if (!reach.act) return notFound();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const update: Record<string, unknown> = {};
  const auditAfter: Record<string, unknown> = {};
  let action: 'status_changed' | 'assigned' | 'transferred' | 'update' = 'update';
  let systemNote: string | null = null;

  // ---- transfer (mailbox_id) ----
  if (typeof body.mailbox_id === 'string' && body.mailbox_id !== mailboxId) {
    const { data: dest } = await db.from('inbox_mailboxes').select('id, centre:centres!centre_id ( name_cn )').eq('id', body.mailbox_id).maybeSingle();
    if (!dest) return notFound();
    const destCentre = Array.isArray(dest.centre) ? dest.centre[0] : dest.centre;
    update.mailbox_id = body.mailbox_id;
    update.assigned_to = null; // assignee no longer valid in the new mailbox
    action = 'transferred';
    auditAfter.mailbox_id = body.mailbox_id;
    systemNote = `已转给 ${(destCentre?.name_cn as string) ?? '其他'} 信箱`;
  }

  // ---- status ----
  if (typeof body.status === 'string' && ['new', 'in_progress', 'replied', 'archived'].includes(body.status) && body.status !== t.status) {
    update.status = body.status;
    if (action === 'update') action = 'status_changed';
    auditAfter.status = body.status;
    if (body.status === 'replied' && !t.first_response_at) update.first_response_at = new Date().toISOString();
  }

  // ---- assign ----
  if ('assigned_to' in body) {
    const assignee = body.assigned_to === null || body.assigned_to === '' ? null : (body.assigned_to as string);
    if (assignee) {
      const owners = await ownersByMailbox(db, [mailboxId]);
      const ok = (owners.get(mailboxId) ?? []).some((o) => o.id === assignee);
      if (!ok) return NextResponse.json({ error: '负责人必须是本信箱的负责人' }, { status: 400 });
    }
    update.assigned_to = assignee;
    if (action === 'update') action = 'assigned';
    auditAfter.assigned_to = assignee;
  }

  // ---- link / contact ----
  for (const k of ['linked_module', 'linked_record_id', 'linked_label'] as const) {
    if (k in body) { update[k] = body[k] === '' ? null : body[k]; auditAfter[k] = update[k]; }
  }
  if ('contact_id' in body) { update.contact_id = body.contact_id || null; auditAfter.contact_id = update.contact_id; }

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true, unchanged: true });

  const { error: uErr } = await db.from('inbox_threads').update(update).eq('id', id);
  if (uErr) {
    console.error('[inbox/threads PATCH] update failed:', uErr);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }

  if (systemNote) {
    await db.from('inbox_messages').insert({
      thread_id: id,
      direction: 'note',
      body: systemNote,
      author_id: volunteer.id,
      author_name: volunteer.display_name ?? volunteer.email,
    });
  }

  await writeAudit({
    actorId: volunteer.id,
    actorEmail: volunteer.email,
    module: 'inbox',
    action,
    tableName: 'inbox_threads',
    recordId: id,
    before: { status: t.status, assigned_to: t.assigned_to, mailbox_id: mailboxId },
    after: auditAfter,
  });

  return NextResponse.json({ ok: true });
}
