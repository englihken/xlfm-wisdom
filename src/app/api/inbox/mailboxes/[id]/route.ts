// src/app/api/inbox/mailboxes/[id]/route.ts
// PATCH a mailbox's config: is_enabled / auto_reply_enabled / auto_reply_text.
// Access: settings ≥ edit. Audits module='inbox' action='mailbox_updated'.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const me = access.volunteer;
  const { id } = await params;

  const { data: mb } = await supabaseAdmin.from('inbox_mailboxes').select('id, is_enabled, auto_reply_enabled, auto_reply_text').eq('id', id).maybeSingle();
  if (!mb) return NextResponse.json({ error: '不存在' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.is_enabled === 'boolean') update.is_enabled = body.is_enabled;
  if (typeof body.auto_reply_enabled === 'boolean') update.auto_reply_enabled = body.auto_reply_enabled;
  if ('auto_reply_text' in body) update.auto_reply_text = body.auto_reply_text ? String(body.auto_reply_text) : null;

  const { error } = await supabaseAdmin.from('inbox_mailboxes').update(update).eq('id', id);
  if (error) {
    console.error('[inbox/mailboxes PATCH] failed:', error);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inbox',
    action: 'mailbox_updated',
    tableName: 'inbox_mailboxes',
    recordId: id,
    before: { is_enabled: mb.is_enabled, auto_reply_enabled: mb.auto_reply_enabled },
    after: update,
  });
  return NextResponse.json({ ok: true });
}
