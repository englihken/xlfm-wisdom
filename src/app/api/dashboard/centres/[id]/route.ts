// src/app/api/dashboard/centres/[id]/route.ts
// PATCH edit / deactivate a centre (共修会管理). Deactivate = is_active=false (keep data).
// Access: settings ≥ edit. Audits module='settings' action='centre_updated'.

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

  const { data: centre } = await supabaseAdmin.from('centres').select('id, code, is_active').eq('id', id).maybeSingle();
  if (!centre) return NextResponse.json({ error: '不存在' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (typeof body.name_cn === 'string' && body.name_cn.trim()) update.name_cn = body.name_cn.trim();
  if (typeof body.name_en === 'string' && body.name_en.trim()) update.name_en = body.name_en.trim();
  if (typeof body.state === 'string' && body.state.trim()) update.state = body.state.trim();
  if (typeof body.is_active === 'boolean') update.is_active = body.is_active;
  if (Number.isFinite(Number(body.sort))) update.sort = Math.round(Number(body.sort));
  if (Array.isArray(body.aliases)) update.aliases = (body.aliases as unknown[]).map((a) => String(a).trim()).filter(Boolean);
  // code is immutable (legacy-Excel key) — ignore any attempt to change it.

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true, unchanged: true });

  const { error } = await supabaseAdmin.from('centres').update(update).eq('id', id);
  if (error) {
    console.error('[centres PATCH] failed:', error);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
  await writeAudit({ actorId: me.id, actorEmail: me.email, module: 'settings', action: 'centre_updated', tableName: 'centres', recordId: id, before: { is_active: centre.is_active }, after: update });
  return NextResponse.json({ ok: true });
}
