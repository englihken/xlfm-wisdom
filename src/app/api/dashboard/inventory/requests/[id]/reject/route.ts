// src/app/api/dashboard/inventory/requests/[id]/reject/route.ts
// POST — decline a 分会 request (inventory:admin): body { reason } REQUIRED. Only a 'pending'
// request can be declined. Records status='rejected' + rejected_reason (the 分会 sees why —
// a plain HQ decision, never accusatory). Moves no stock. Audited.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { REQUEST_SELECT } from '@/lib/inventory';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('inventory', 'admin');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: '请填写婉拒原因' }, { status: 400 });

  const { data: request, error: reqErr } = await supabaseAdmin
    .from('inventory_requests')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (reqErr) {
    console.error('[inventory/reject] load failed:', reqErr);
    return NextResponse.json({ error: 'Failed to load request' }, { status: 500 });
  }
  if (!request) return NextResponse.json({ error: '申请不存在' }, { status: 404 });
  if (request.status !== 'pending') {
    return NextResponse.json({ error: '仅待审批的申请可以婉拒' }, { status: 400 });
  }

  const me = access.volunteer;
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('inventory_requests')
    .update({ status: 'rejected', rejected_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', request.id)
    .select(REQUEST_SELECT)
    .single();
  if (updErr || !updated) {
    console.error('[inventory/reject] update failed:', updErr);
    return NextResponse.json({ error: '操作失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: 'update',
    tableName: 'inventory_requests',
    recordId: request.id,
    before: { status: request.status },
    after: { status: 'rejected', rejected_reason: reason },
  });

  return NextResponse.json({ request: updated });
}
