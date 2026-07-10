// src/app/api/inbox/threads/route.ts
// GET  — list threads for one visible mailbox, or the cross-centre 内部往来 folder.
// POST — compose an internal (内部往来) thread to another mailbox.
// Service-role reads/writes; inbox-scope is the wall (uniform 404 on cross-wall).

import { NextResponse } from 'next/server';
import { resolveInbox, notFound, myCentreIds, loadEscalation, type Db } from '@/lib/inbox-server';
import { canOpenMailbox } from '@/lib/inbox-scope';
import { snippet, overdueLevel, ageDays } from '@/lib/inbox';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type ThreadRow = Record<string, unknown>;

// Shape a set of thread rows into list rows (latest-message snippet + escalation age).
async function toListRows(db: Db, threads: ThreadRow[]) {
  const ids = threads.map((t) => t.id as string);
  const esc = await loadEscalation(db);
  const nowMs = Date.now();

  const snippets = new Map<string, string>();
  const assignedNames = new Map<string, string>();
  const centreNames = new Map<string, string>();

  if (ids.length > 0) {
    const { data: msgs } = await db
      .from('inbox_messages')
      .select('thread_id, body, created_at')
      .in('thread_id', ids)
      .order('created_at', { ascending: false });
    for (const m of msgs ?? []) {
      const tid = m.thread_id as string;
      if (!snippets.has(tid)) snippets.set(tid, snippet(m.body as string));
    }
    const assignedIds = [...new Set(threads.map((t) => t.assigned_to).filter(Boolean) as string[])];
    if (assignedIds.length > 0) {
      const { data: vs } = await db.from('volunteers').select('id, display_name, email').in('id', assignedIds);
      for (const v of vs ?? []) assignedNames.set(v.id as string, (v.display_name as string) || (v.email as string) || '义工');
    }
    const fromCentreIds = [...new Set(threads.map((t) => t.from_centre_id).filter(Boolean) as string[])];
    if (fromCentreIds.length > 0) {
      const { data: cs } = await db.from('centres').select('id, name_cn').in('id', fromCentreIds);
      for (const c of cs ?? []) centreNames.set(c.id as string, (c.name_cn as string) ?? '—');
    }
  }

  return threads.map((t) => {
    const status = t.status as string;
    const age = ageDays(t.last_message_at as string, nowMs);
    return {
      id: t.id as string,
      mailbox_id: t.mailbox_id as string,
      kind: t.kind as string,
      subject: t.subject as string,
      sender_name: (t.sender_name as string | null) ?? null,
      from_centre_id: (t.from_centre_id as string | null) ?? null,
      from_centre_name: t.from_centre_id ? centreNames.get(t.from_centre_id as string) ?? null : null,
      status,
      crisis_flag: !!t.crisis_flag,
      assigned_to: (t.assigned_to as string | null) ?? null,
      assigned_name: t.assigned_to ? assignedNames.get(t.assigned_to as string) ?? null : null,
      contact_id: (t.contact_id as string | null) ?? null,
      linked_label: (t.linked_label as string | null) ?? null,
      last_message_at: t.last_message_at as string,
      snippet: snippets.get(t.id as string) ?? '',
      age_days: age,
      overdue: overdueLevel(status, age, esc),
    };
  });
}

const THREAD_COLS = 'id, mailbox_id, kind, from_centre_id, subject, sender_name, status, assigned_to, contact_id, linked_module, linked_record_id, linked_label, crisis_flag, last_message_at';

export async function GET(req: Request) {
  const r = await resolveInbox();
  if (!r.ok) return r.res;
  const { db, access } = r;
  if (access.level === 'none') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const folder = sp.get('folder');
  const statusFilter = sp.get('status');
  const mailboxId = sp.get('mailbox');

  // ---- 内部往来 folder: internal threads touching my centres (both directions) ----
  if (folder === 'internal') {
    const centreIds = await myCentreIds(db, access);
    if (centreIds.length === 0) return NextResponse.json({ threads: [] });
    // mailboxes belonging to my centres (recipient side)
    const { data: myBoxes } = await db.from('inbox_mailboxes').select('id').in('centre_id', centreIds);
    const myBoxIds = (myBoxes ?? []).map((m) => m.id as string);
    let q = db
      .from('inbox_threads')
      .select(THREAD_COLS)
      .eq('kind', 'internal')
      .or(
        `mailbox_id.in.(${myBoxIds.length ? myBoxIds.join(',') : '00000000-0000-0000-0000-000000000000'}),from_centre_id.in.(${centreIds.join(',')})`
      )
      .order('last_message_at', { ascending: false });
    if (statusFilter && statusFilter !== 'all') q = q.eq('status', statusFilter);
    const { data } = await q;
    return NextResponse.json({ threads: await toListRows(db, (data ?? []) as ThreadRow[]) });
  }

  // ---- single mailbox ----
  if (!mailboxId) return NextResponse.json({ error: 'mailbox required' }, { status: 400 });
  const { data: mb } = await db.from('inbox_mailboxes').select('id, centre_id, centre:centres!centre_id ( name_cn )').eq('id', mailboxId).maybeSingle();
  if (!mb) return notFound();

  const canOpen = canOpenMailbox(access, mailboxId);
  const adminBreakGlass = access.level === 'admin' && sp.get('breakglass') === '1';
  if (!canOpen && !adminBreakGlass) return notFound();

  if (adminBreakGlass && !canOpen) {
    const centre = Array.isArray(mb.centre) ? mb.centre[0] : mb.centre;
    await writeAudit({
      actorId: r.volunteer.id,
      actorEmail: r.volunteer.email,
      module: 'inbox',
      action: 'break_glass_view',
      tableName: 'inbox_mailboxes',
      recordId: mailboxId,
      after: { mailbox: mailboxId, centre: (centre?.name_cn as string) ?? null },
    });
  }

  let q = db.from('inbox_threads').select(THREAD_COLS).eq('mailbox_id', mailboxId).order('last_message_at', { ascending: false });
  if (statusFilter && statusFilter !== 'all') q = q.eq('status', statusFilter);
  const { data } = await q;
  return NextResponse.json({ threads: await toListRows(db, (data ?? []) as ThreadRow[]) });
}

export async function POST(req: Request) {
  const r = await resolveInbox();
  if (!r.ok) return r.res;
  const { db, access, volunteer } = r;
  const canCompose = access.level === 'admin' || access.level === 'edit' || access.level === 'owner-only';
  if (!canCompose) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const toMailboxId = typeof body.to_mailbox_id === 'string' ? body.to_mailbox_id : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!toMailboxId || !subject || !messageBody) return NextResponse.json({ error: '请填写收件信箱、主题与内容' }, { status: 400 });

  const { data: toMb } = await db.from('inbox_mailboxes').select('id').eq('id', toMailboxId).maybeSingle();
  if (!toMb) return notFound();

  // from_centre_id: locked account → its centre; admin/national → body.from_centre_id or HQ.
  let fromCentreId: string | null = access.centreId;
  if (!fromCentreId) {
    const centreIds = await myCentreIds(db, access);
    fromCentreId = centreIds[0] ?? null;
  }
  if (!fromCentreId && typeof body.from_centre_id === 'string') fromCentreId = body.from_centre_id;
  if (!fromCentreId) {
    const { data: hq } = await db.from('centres').select('id').eq('code', 'HQ').maybeSingle();
    fromCentreId = (hq?.id as string | undefined) ?? null;
  }
  if (!fromCentreId) return NextResponse.json({ error: '无法确定发件共修会' }, { status: 400 });

  const nowIso = new Date().toISOString();
  const linkedModule = typeof body.linked_module === 'string' ? body.linked_module : null;
  const linkedRecordId = typeof body.linked_record_id === 'string' ? body.linked_record_id : null;
  const linkedLabel = typeof body.linked_label === 'string' ? body.linked_label : null;

  const { data: thread, error: tErr } = await db
    .from('inbox_threads')
    .insert({
      mailbox_id: toMailboxId,
      kind: 'internal',
      from_centre_id: fromCentreId,
      subject,
      status: 'new',
      linked_module: linkedModule,
      linked_record_id: linkedRecordId,
      linked_label: linkedLabel,
      last_message_at: nowIso,
      created_by: volunteer.id,
    })
    .select('id')
    .single();
  if (tErr || !thread) {
    console.error('[inbox/threads] internal create failed:', tErr);
    return NextResponse.json({ error: '发送失败' }, { status: 500 });
  }
  const threadId = thread.id as string;

  const { error: mErr } = await db.from('inbox_messages').insert({
    thread_id: threadId,
    direction: 'inbound',
    body: messageBody,
    author_id: volunteer.id,
    author_name: volunteer.display_name ?? volunteer.email,
  });
  if (mErr) {
    console.error('[inbox/threads] internal message insert failed, rolling back:', mErr);
    await db.from('inbox_threads').delete().eq('id', threadId);
    return NextResponse.json({ error: '发送失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: volunteer.id,
    actorEmail: volunteer.email,
    module: 'inbox',
    action: 'thread_created',
    tableName: 'inbox_threads',
    recordId: threadId,
    after: { kind: 'internal', to_mailbox_id: toMailboxId, from_centre_id: fromCentreId, subject },
  });

  return NextResponse.json({ ok: true, id: threadId }, { status: 201 });
}
