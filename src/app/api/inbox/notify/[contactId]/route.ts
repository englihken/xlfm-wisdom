// src/app/api/inbox/notify/[contactId]/route.ts
// PATCH a contact's WhatsApp opt-in flag + note (通知名单). 「只联系明确同意的人」 — opt-in only.
// Access: settings ≥ edit. Audits module='outreach' action='outreach.notify_opt_in_changed'.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: Promise<{ contactId: string }> }) {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const me = access.volunteer;
  const { contactId } = await params;

  const { data: c } = await supabaseAdmin.from('contacts').select('id, notify_opt_in').eq('id', contactId).maybeSingle();
  if (!c) return NextResponse.json({ error: '不存在' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (typeof body.notify_opt_in === 'boolean') {
    update.notify_opt_in = body.notify_opt_in;
    update.notify_opt_in_at = body.notify_opt_in ? new Date().toISOString() : null;
  }
  if ('note' in body) update.notify_opt_in_note = body.note ? String(body.note) : null;
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true, unchanged: true });

  const { error } = await supabaseAdmin.from('contacts').update(update).eq('id', contactId);
  if (error) return NextResponse.json({ error: '更新失败' }, { status: 500 });

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'outreach',
    action: 'outreach.notify_opt_in_changed',
    tableName: 'contacts',
    recordId: contactId,
    before: { notify_opt_in: c.notify_opt_in },
    after: update,
  });
  return NextResponse.json({ ok: true });
}
