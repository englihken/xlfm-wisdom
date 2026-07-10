// src/app/api/dashboard/centres/route.ts
// GET list + POST create centres (共修会管理). A new centre auto-gets a mailbox via the DB
// trigger centres_auto_mailbox (migration 030). Access: settings ≥ edit.
// Audits module='settings' action='centre_created'.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

export async function GET() {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const { data } = await supabaseAdmin
    .from('centres')
    .select('id, code, name_cn, name_en, state, aliases, is_active, sort')
    .order('sort', { ascending: true })
    .order('name_cn', { ascending: true });
  return NextResponse.json({ centres: data ?? [] });
}

export async function POST(req: Request) {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const me = access.volunteer;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const nameCn = typeof body.name_cn === 'string' ? body.name_cn.trim() : '';
  const nameEn = typeof body.name_en === 'string' ? body.name_en.trim() : '';
  const state = typeof body.state === 'string' ? body.state.trim() : '';
  if (!code || !nameCn || !nameEn || !state) return NextResponse.json({ error: '请填写代码、中英文名称与州属' }, { status: 400 });

  const { data: dup } = await supabaseAdmin.from('centres').select('id').eq('code', code).maybeSingle();
  if (dup) return NextResponse.json({ error: '代码已存在' }, { status: 409 });

  const aliases = Array.isArray(body.aliases) ? (body.aliases as unknown[]).map((a) => String(a).trim()).filter(Boolean) : [];
  const sort = Number.isFinite(Number(body.sort)) ? Math.round(Number(body.sort)) : 0;

  const { data, error } = await supabaseAdmin
    .from('centres')
    .insert({ code, name_cn: nameCn, name_en: nameEn, state, aliases, sort, is_active: body.is_active === false ? false : true })
    .select('id, code')
    .single();
  if (error || !data) {
    console.error('[centres POST] failed:', error);
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }
  await writeAudit({ actorId: me.id, actorEmail: me.email, module: 'settings', action: 'centre_created', tableName: 'centres', recordId: data.id as string, after: { code, name_cn: nameCn } });
  // The DB trigger auto-created the mailbox; tell the client so it can toast.
  return NextResponse.json({ ok: true, id: data.id, mailbox_auto_created: true }, { status: 201 });
}
