// src/app/api/dashboard/inventory/requests/[id]/release/route.ts
// POST — 发放 (release) approved stock to a 分会 (inventory:edit): body { qty, photo_path }
// BOTH required. Only an 'approved'/'partial' request can be released, and qty may not exceed
// the approved-but-unreleased remainder (qty_approved − qty_fulfilled). RELEASE is the ONLY
// step that moves stock: it creates the 总会仓库 → centre-store TRANSFER (carrying the
// 存证 photo + request_id), then advances the request (qty_fulfilled += qty; status →
// partial/fulfilled). Guards: HQ must hold enough stock (negative-stock guard) and the centre
// must have a store location. On a failed request-update the movement is rolled back (house
// manual-compensation pattern). Audited.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { locationBalance, REQUEST_SELECT } from '@/lib/inventory';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('inventory', 'edit');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const qty = Number(body?.qty);
  if (!Number.isInteger(qty) || qty <= 0) {
    return NextResponse.json({ error: '发放数量须为大于 0 的整数' }, { status: 400 });
  }
  const photoPath = typeof body?.photo_path === 'string' ? body.photo_path.trim() : '';
  if (!photoPath || !/^photos\/[A-Za-z0-9._-]+$/.test(photoPath)) {
    return NextResponse.json({ error: '请先上传发放存证照片' }, { status: 400 });
  }

  const { data: request, error: reqErr } = await supabaseAdmin
    .from('inventory_requests')
    .select('id, centre_id, item_id, qty_approved, qty_fulfilled, status, event_id')
    .eq('id', id)
    .maybeSingle();
  if (reqErr) {
    console.error('[inventory/release] request load failed:', reqErr);
    return NextResponse.json({ error: 'Failed to load request' }, { status: 500 });
  }
  if (!request) return NextResponse.json({ error: '申请不存在' }, { status: 404 });
  if (request.status !== 'approved' && request.status !== 'partial') {
    return NextResponse.json({ error: '仅已批准的申请可以发放' }, { status: 400 });
  }

  const remaining = (request.qty_approved ?? 0) - request.qty_fulfilled;
  if (qty > remaining) {
    return NextResponse.json({ error: `发放数量超过已批准余量（剩余 ${remaining} 件）` }, { status: 400 });
  }

  // Resolve the two ends of the transfer: 总会仓库 → the centre's store.
  const [{ data: hq }, { data: centreLoc }] = await Promise.all([
    supabaseAdmin.from('inventory_locations').select('id').eq('kind', 'hq_warehouse').maybeSingle(),
    supabaseAdmin.from('inventory_locations').select('id').eq('centre_id', request.centre_id).maybeSingle(),
  ]);
  if (!hq) return NextResponse.json({ error: '总会仓库未设置' }, { status: 500 });
  if (!centreLoc) {
    return NextResponse.json({ error: '该中心尚未设置库存仓，请先在库存地点中添加' }, { status: 400 });
  }

  const balance = await locationBalance(supabaseAdmin, request.item_id, hq.id);
  if (balance === null) return NextResponse.json({ error: '库存读取失败，请重试' }, { status: 500 });
  if (qty > balance) {
    return NextResponse.json({ error: `总会仓库库存不足（现有 ${balance} 件）` }, { status: 400 });
  }

  const me = access.volunteer;

  // 1) The transfer movement (with 存证 photo + request link).
  const { data: movement, error: movErr } = await supabaseAdmin
    .from('inventory_movements')
    .insert({
      item_id: request.item_id,
      movement_type: 'transfer',
      from_location_id: hq.id,
      to_location_id: centreLoc.id,
      qty,
      event_id: request.event_id,
      note: `分会申请发放（申请 ${request.id.slice(0, 8)}）`,
      photo_path: photoPath,
      request_id: request.id,
      created_by: me.id,
    })
    .select('id')
    .single();
  if (movErr || !movement) {
    console.error('[inventory/release] transfer insert failed:', movErr);
    return NextResponse.json({ error: '发放失败（无法记录调拨）' }, { status: 500 });
  }

  // 2) Advance the request. On failure, roll the movement back.
  const newFulfilled = request.qty_fulfilled + qty;
  const newStatus = newFulfilled >= (request.qty_approved ?? 0) ? 'fulfilled' : 'partial';
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('inventory_requests')
    .update({ qty_fulfilled: newFulfilled, status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', request.id)
    .select(REQUEST_SELECT)
    .single();
  if (updErr || !updated) {
    console.error('[inventory/release] request update failed, rolling back movement:', updErr);
    await supabaseAdmin.from('inventory_movements').delete().eq('id', movement.id);
    return NextResponse.json({ error: '发放失败（申请状态未更新）' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: 'update',
    tableName: 'inventory_requests',
    recordId: request.id,
    before: { qty_fulfilled: request.qty_fulfilled, status: request.status },
    after: { qty_fulfilled: newFulfilled, status: newStatus, movement_id: movement.id, qty },
  });

  return NextResponse.json({ request: updated });
}
