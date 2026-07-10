// src/app/api/inbox/templates/[id]/route.ts
// PATCH (edit / activate) + DELETE a reply template. Access: settings ≥ edit.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const me = access.volunteer;
  const { id } = await params;

  const { data: tpl } = await supabaseAdmin.from('message_templates').select('id, title, is_active').eq('id', id).eq('module', 'inbox').maybeSingle();
  if (!tpl) return NextResponse.json({ error: '不存在' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === 'string' && body.title.trim()) update.title = body.title.trim();
  if (typeof body.body === 'string' && body.body.trim()) update.body = body.body.trim();
  if (typeof body.is_active === 'boolean') update.is_active = body.is_active;

  const { error } = await supabaseAdmin.from('message_templates').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: '更新失败' }, { status: 500 });
  await writeAudit({ actorId: me.id, actorEmail: me.email, module: 'inbox', action: 'template_updated', tableName: 'message_templates', recordId: id, before: { is_active: tpl.is_active }, after: update });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const me = access.volunteer;
  const { id } = await params;

  const { data: tpl } = await supabaseAdmin.from('message_templates').select('id, title').eq('id', id).eq('module', 'inbox').maybeSingle();
  if (!tpl) return NextResponse.json({ error: '不存在' }, { status: 404 });

  const { error } = await supabaseAdmin.from('message_templates').delete().eq('id', id);
  if (error) return NextResponse.json({ error: '删除失败' }, { status: 500 });
  await writeAudit({ actorId: me.id, actorEmail: me.email, module: 'inbox', action: 'template_deleted', tableName: 'message_templates', recordId: id, before: { title: tpl.title } });
  return NextResponse.json({ ok: true });
}
