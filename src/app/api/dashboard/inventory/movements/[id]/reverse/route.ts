// src/app/api/dashboard/inventory/movements/[id]/reverse/route.ts
// POST — 更正撤销: reverse a movement (inventory:edit) by writing its EXACT OPPOSITE (sides
// swapped, matching type, same item/qty, reversal_of=[id], note '更正撤销'). The ledger stays
// append-only — nothing is deleted. Who may reverse: the movement's own creator within 24h,
// or an inventory:admin at any time. Refused if the target is itself a reversal, already has a
// reversal (DB also enforces one-reversal-max via a unique partial index), or is a seed
// 'opening' (correct those via a stock-take). The negative-stock guard applies to the opposite
// move. When the reversed movement was a 分会 release (has request_id), the parent request is
// also rewound (qty_fulfilled −= qty, status recomputed) so cards agree with the ledger.
// Audited (the movement, and the request when rewound).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { locationBalance, reverseMovement, MOVEMENT_SELECT } from '@/lib/inventory';

export const runtime = 'nodejs';

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('inventory', 'edit');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const me = access.volunteer;

  const { data: mv, error: mvErr } = await supabaseAdmin
    .from('inventory_movements')
    .select('id, item_id, movement_type, from_location_id, to_location_id, qty, event_id, request_id, reversal_of, created_by, created_at')
    .eq('id', id)
    .maybeSingle();
  if (mvErr) {
    console.error('[inventory/reverse] load failed:', mvErr);
    return NextResponse.json({ error: 'Failed to load movement' }, { status: 500 });
  }
  if (!mv) return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  if (mv.reversal_of) return NextResponse.json({ error: '撤销记录不能再撤销' }, { status: 400 });

  const opposite = reverseMovement(mv.movement_type, mv.from_location_id, mv.to_location_id);
  if (!opposite) return NextResponse.json({ error: '此类型的记录无法撤销（期初结存请用盘点更正）' }, { status: 400 });

  // Already reversed? (DB has a unique partial index as the backstop.)
  const { data: existing } = await supabaseAdmin
    .from('inventory_movements')
    .select('id')
    .eq('reversal_of', mv.id)
    .maybeSingle();
  if (existing) return NextResponse.json({ error: '该记录已撤销过' }, { status: 400 });

  // Permission window: creator within 24h, or an inventory:admin at any time.
  const isAdmin = (await requireModuleAccess('inventory', 'admin')).ok;
  if (!isAdmin) {
    const mine = mv.created_by === me.id;
    const fresh = Date.now() - new Date(mv.created_at).getTime() <= TWENTY_FOUR_HOURS;
    if (!mine || !fresh) {
      return NextResponse.json({ error: '仅记录人可在 24 小时内撤销；超时请由管理员处理' }, { status: 403 });
    }
  }

  // Negative-stock guard for the opposite move's source side.
  if (opposite.from_location_id) {
    const balance = await locationBalance(supabaseAdmin, mv.item_id, opposite.from_location_id);
    if (balance === null) return NextResponse.json({ error: '库存读取失败，请重试' }, { status: 500 });
    if (mv.qty > balance) {
      return NextResponse.json({ error: `无法撤销：相关仓库存不足（现有 ${balance} 件）` }, { status: 400 });
    }
  }

  const { data: reversal, error: insErr } = await supabaseAdmin
    .from('inventory_movements')
    .insert({
      item_id: mv.item_id,
      movement_type: opposite.movement_type,
      from_location_id: opposite.from_location_id,
      to_location_id: opposite.to_location_id,
      qty: mv.qty,
      event_id: mv.event_id,
      note: '更正撤销',
      reversal_of: mv.id,
      created_by: me.id,
    })
    .select(MOVEMENT_SELECT)
    .single();
  if (insErr || !reversal) {
    console.error('[inventory/reverse] insert failed:', insErr);
    return NextResponse.json({ error: '撤销失败，请重试' }, { status: 500 });
  }
  const reversalId = (reversal as unknown as { id: string }).id;

  // If the reversed movement was a 分会 release (has request_id), rewind the parent request so
  // its card numbers agree with the ledger: qty_fulfilled −= original.qty (floor 0), status
  // recomputed (0 → approved, < approved → partial, == approved → fulfilled). A closed request
  // (cancelled/rejected) keeps its status — only the counter moves. Same manual-rollback pattern:
  // on failure, delete the reversal and error out.
  if (mv.request_id) {
    const { data: reqRow, error: reqErr } = await supabaseAdmin
      .from('inventory_requests')
      .select('id, qty_approved, qty_fulfilled, status')
      .eq('id', mv.request_id)
      .maybeSingle();
    if (reqErr || !reqRow) {
      console.error('[inventory/reverse] request rewind load failed, rolling back reversal:', reqErr);
      await supabaseAdmin.from('inventory_movements').delete().eq('id', reversalId);
      return NextResponse.json({ error: '撤销失败（无法回退申请）' }, { status: 500 });
    }
    const newFulfilled = Math.max(0, reqRow.qty_fulfilled - mv.qty);
    const approved = reqRow.qty_approved ?? 0;
    const closed = reqRow.status === 'cancelled' || reqRow.status === 'rejected';
    const newStatus = closed
      ? reqRow.status
      : newFulfilled === 0
        ? 'approved'
        : newFulfilled < approved
          ? 'partial'
          : 'fulfilled';
    const { error: updErr } = await supabaseAdmin
      .from('inventory_requests')
      .update({ qty_fulfilled: newFulfilled, status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', reqRow.id);
    if (updErr) {
      console.error('[inventory/reverse] request rewind failed, rolling back reversal:', updErr);
      await supabaseAdmin.from('inventory_movements').delete().eq('id', reversalId);
      return NextResponse.json({ error: '撤销失败（申请状态未回退）' }, { status: 500 });
    }
    await writeAudit({
      actorId: me.id,
      actorEmail: me.email,
      module: 'inventory',
      action: 'update',
      tableName: 'inventory_requests',
      recordId: reqRow.id,
      before: { qty_fulfilled: reqRow.qty_fulfilled, status: reqRow.status },
      after: { qty_fulfilled: newFulfilled, status: newStatus },
    });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: 'update',
    tableName: 'inventory_movements',
    recordId: mv.id,
    after: { reversed_by_movement: reversalId, movement_type: opposite.movement_type, qty: mv.qty, request_id: mv.request_id },
  });

  return NextResponse.json({ movement: reversal }, { status: 201 });
}
