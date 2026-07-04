// src/app/api/dashboard/members/[id]/status/route.ts
// POST { status: 'active' | 'inactive' } — deactivate-not-delete (and reactivate).
// members:edit. There is deliberately NO delete route: membership history must
// survive. Audits 'deactivate' / 'reactivate'.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireModuleAccess('members', 'edit');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as { status?: unknown } | null;
  const status = body?.status;
  if (status !== 'active' && status !== 'inactive') {
    return NextResponse.json({ error: '状态无效（active/inactive）' }, { status: 400 });
  }

  const { data: before, error: beforeErr } = await supabaseAdmin
    .from('members')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (beforeErr) {
    console.error('[members] status pre-fetch failed:', beforeErr);
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const me = access.volunteer;
  const { data: after, error } = await supabaseAdmin
    .from('members')
    .update({ status, updated_at: new Date().toISOString(), updated_by: me.id })
    .eq('id', id)
    .select('id, status')
    .single();
  if (error) {
    console.error('[members] status update failed:', error);
    return NextResponse.json({ error: '操作失败，请重试' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'members',
    action: status === 'inactive' ? 'deactivate' : 'reactivate',
    tableName: 'members',
    recordId: id,
    before: { status: before.status },
    after: { status: after.status },
  });

  return NextResponse.json({ member: after });
}
