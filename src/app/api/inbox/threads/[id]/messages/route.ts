// src/app/api/inbox/threads/[id]/messages/route.ts
// POST an outbound reply or an internal note to a thread. Outbound stamps first_response_at,
// auto-advances status new→in_progress, and bumps last_message_at. Notes never count as a
// reply and never move the escalation clock. Owners/admin/internal-sender only; all audit.

import { NextResponse } from 'next/server';
import { resolveInbox, notFound, threadReach, auditBreakGlass } from '@/lib/inbox-server';
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
    .select('id, mailbox_id, kind, from_centre_id, crisis_flag, status, first_response_at')
    .eq('id', id)
    .maybeSingle();
  if (!t) return notFound();

  const reach = await threadReach(db, access, volunteer, t as never, new URL(req.url).searchParams.get('breakglass') === '1');
  if (!reach.act) return notFound();
  // 代管 write leaves a trace BEFORE the mutation (security audit H3).
  if (reach.brokeGlass) await auditBreakGlass(db, volunteer.id, volunteer.email, t.mailbox_id as string);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const direction = body.direction === 'note' ? 'note' : body.direction === 'outbound' ? 'outbound' : null;
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!direction) return NextResponse.json({ error: 'direction 必须是 outbound 或 note' }, { status: 400 });
  if (!text) return NextResponse.json({ error: '请填写内容' }, { status: 400 });

  const nowIso = new Date().toISOString();
  const { data: msg, error: mErr } = await db
    .from('inbox_messages')
    .insert({ thread_id: id, direction, body: text, author_id: volunteer.id, author_name: volunteer.display_name ?? volunteer.email })
    .select('id')
    .single();
  if (mErr || !msg) {
    console.error('[inbox/messages] insert failed:', mErr);
    return NextResponse.json({ error: '发送失败' }, { status: 500 });
  }

  if (direction === 'outbound') {
    const update: Record<string, unknown> = { last_message_at: nowIso };
    if (!t.first_response_at) update.first_response_at = nowIso;
    if (t.status === 'new') update.status = 'in_progress';
    await db.from('inbox_threads').update(update).eq('id', id);
  }

  await writeAudit({
    actorId: volunteer.id,
    actorEmail: volunteer.email,
    module: 'inbox',
    action: direction === 'outbound' ? 'replied' : 'note_added',
    tableName: 'inbox_messages',
    recordId: msg.id as string,
    after: { thread_id: id, direction, ...(reach.brokeGlass ? { broke_glass: true } : {}) },
  });

  return NextResponse.json({ ok: true, id: msg.id }, { status: 201 });
}
