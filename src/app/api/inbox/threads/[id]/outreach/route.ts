// src/app/api/inbox/threads/[id]/outreach/route.ts
// POST 加入渡人名单 — bridge a form thread's sender into the 渡人 (outreach) ledger, reusing
// the E1b create shape: channel='manual' (never the chat-trigger channel) + an explicit
// first_contact milestone (E2 §7.1). Idempotent on thread.contact_id. Audits module='outreach'.
//
// source_type='form' is permitted by the DB CHECK as of migration 031; the 渡人卡 shows a
// 表单 source chip. The first_contact milestone note 「自动记录：初次接触（表单）」 also carries
// the provenance in the journey ledger.

import { NextResponse } from 'next/server';
import { resolveInbox, notFound, threadReach } from '@/lib/inbox-server';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveInbox();
  if (!r.ok) return r.res;
  const { db, access, volunteer } = r;
  if (access.level === 'none' || access.level === 'summary') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;

  const { data: t } = await db
    .from('inbox_threads')
    .select('id, mailbox_id, kind, from_centre_id, crisis_flag, status, subject, sender_name, sender_phone, contact_id')
    .eq('id', id)
    .maybeSingle();
  if (!t) return notFound();

  const mailboxId = t.mailbox_id as string;
  const reach = await threadReach(db, access, volunteer, t as never, new URL(req.url).searchParams.get('breakglass') === '1');
  if (!reach.act) return notFound();

  // Idempotent — already linked.
  if (t.contact_id) {
    return NextResponse.json({ error: '已在渡人名单中', existing: { id: t.contact_id } }, { status: 409 });
  }

  const displayName = ((t.sender_name as string | null) ?? '').trim();
  if (!displayName) return NextResponse.json({ error: '此来信没有姓名，无法加入名单' }, { status: 400 });

  // mailbox's centre → the contact's centre
  const { data: mb } = await db.from('inbox_mailboxes').select('centre_id').eq('id', mailboxId).maybeSingle();
  const centreId = (mb?.centre_id as string | null) ?? null;

  const nowIso = new Date().toISOString();
  const { data: contact, error: insErr } = await db
    .from('contacts')
    .insert({
      channel: 'manual',
      display_name: displayName,
      stage: '初次接触',
      phone: (t.sender_phone as string | null) ?? null,
      source_type: 'form', // permitted by migration 031; surfaces as the 表单 source chip
      source_note: (t.subject as string | null) ?? null,
      centre_id: centreId,
      first_seen: nowIso,
      last_seen: nowIso,
    })
    .select('id, display_name')
    .single();
  if (insErr || !contact) {
    console.error('[inbox/outreach] contact insert failed:', insErr);
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }
  const contactId = contact.id as string;

  const firstOn = nowIso.slice(0, 10);
  const { error: msErr } = await db
    .from('contact_milestones')
    .insert({ contact_id: contactId, milestone: 'first_contact', happened_on: firstOn, note: '自动记录：初次接触（表单）', noted_by: volunteer.id });
  if (msErr) {
    console.error('[inbox/outreach] first_contact insert failed, rolling back contact:', msErr);
    await db.from('contacts').delete().eq('id', contactId);
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }

  // link back onto the thread
  await db.from('inbox_threads').update({ contact_id: contactId }).eq('id', id);

  await writeAudit({
    actorId: volunteer.id,
    actorEmail: volunteer.email,
    module: 'outreach',
    action: 'outreach.person_create',
    tableName: 'contacts',
    recordId: contactId,
    after: { display_name: displayName, source_type: 'form', from_inbox_thread: id },
  });

  return NextResponse.json({ ok: true, contact_id: contactId }, { status: 201 });
}
