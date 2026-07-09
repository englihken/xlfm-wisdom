// src/app/api/dashboard/inventory/requests/[id]/approve/route.ts
// POST — approve a 分会 request (inventory:admin): body { qty_approved, reason? }. Only a
// 'pending' request can be approved. qty_approved must be ≥ 1; approving LESS than requested
// requires a reason (transparency — the 分会 sees why). Approval does NOT move stock — it
// only authorises later 发放 (release). Sets approved_by/approved_at + status='approved'.
// Audited.

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
  const qtyApproved = Number(body?.qty_approved);
  if (!Number.isInteger(qtyApproved) || qtyApproved < 1) {
    return NextResponse.json({ error: '批准数量须为大于 0 的整数' }, { status: 400 });
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

  const { data: request, error: reqErr } = await supabaseAdmin
    .from('inventory_requests')
    .select('id, status, qty_requested')
    .eq('id', id)
    .maybeSingle();
  if (reqErr) {
    console.error('[inventory/approve] load failed:', reqErr);
    return NextResponse.json({ error: 'Failed to load request' }, { status: 500 });
  }
  if (!request) return NextResponse.json({ error: '申请不存在' }, { status: 404 });
  if (request.status !== 'pending') {
    return NextResponse.json({ error: '仅待审批的申请可以批准' }, { status: 400 });
  }
  if (qtyApproved > request.qty_requested) {
    return NextResponse.json({ error: `批准数量不能超过申请数量（${request.qty_requested}）` }, { status: 400 });
  }
  if (qtyApproved < request.qty_requested && !reason) {
    return NextResponse.json({ error: '批准数量少于申请数量时，请填写原因' }, { status: 400 });
  }

  const me = access.volunteer;
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('inventory_requests')
    .update({
      status: 'approved',
      qty_approved: qtyApproved,
      approve_reason: reason || null,
      approved_by: me.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', request.id)
    .select(REQUEST_SELECT)
    .single();
  if (updErr || !updated) {
    console.error('[inventory/approve] update failed:', updErr);
    return NextResponse.json({ error: '批准失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: 'update',
    tableName: 'inventory_requests',
    recordId: request.id,
    before: { status: request.status },
    after: { status: 'approved', qty_approved: qtyApproved, approve_reason: reason || null },
  });

  return NextResponse.json({ request: updated });
}
