// src/app/api/inbox/templates/route.ts
// GET list + POST create reply templates (message_templates, module='inbox').
// GET is available to anyone with inbox content access (they insert templates into replies);
// POST requires settings ≥ edit. Audits template_created.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { resolveInbox } from '@/lib/inbox-server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  // Reply composers (owners/centre_head/admin) need active templates; settings-editors need all.
  const r = await resolveInbox();
  if (!r.ok) return r.res;
  if (r.access.level === 'none') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const activeOnly = new URL(req.url).searchParams.get('all') !== '1';
  let q = r.db.from('message_templates').select('id, title, body, is_active, created_at').eq('module', 'inbox').order('created_at', { ascending: true });
  if (activeOnly) q = q.eq('is_active', true);
  const { data } = await q;
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: Request) {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const me = access.volunteer;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!title || !text) return NextResponse.json({ error: '请填写标题与内容' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('message_templates')
    .insert({ module: 'inbox', title, body: text, is_active: body.is_active === false ? false : true, created_by: me.id })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[inbox/templates POST] failed:', error);
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }
  await writeAudit({ actorId: me.id, actorEmail: me.email, module: 'inbox', action: 'template_created', tableName: 'message_templates', recordId: data.id as string, after: { title } });
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}
