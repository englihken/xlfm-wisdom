// src/app/api/dashboard/inventory/stocktakes/[id]/confirm/route.ts
// POST — confirm a 盘点 session (inventory:edit), DRAFT only. For every line that was COUNTED
// (counted_qty not null): recompute the item's CURRENT derived balance at the location (read
// once — no N+1), diff = counted − current; if diff ≠ 0 write an adjust_in/adjust_out movement
// (qty=|diff|, stocktake_id link, note '盘点 <id8>'). Uncounted lines are skipped (reported).
// COUNTED VALUE WINS: if current ≠ the line's snapshot system_qty (stock moved mid-count) the
// item is returned in driftWarnings, but the count is still applied. Manual rollback: if any
// step fails partway, this confirm's movements are deleted (by stocktake_id) and the session
// stays draft. Sets status confirmed + confirmed_by/at. Audited.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { STOCKTAKE_SELECT } from '../../route';

export const runtime = 'nodejs';

type Lite = { stock_id: string | null; name_cn: string };
type Line = {
  item_id: string;
  system_qty: number;
  counted_qty: number | null;
  item: Lite | Lite[] | null;
};
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('inventory', 'edit');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;

  const { data: session, error: sErr } = await supabaseAdmin
    .from('inventory_stocktakes')
    .select('id, location_id, status')
    .eq('id', id)
    .maybeSingle();
  if (sErr) {
    console.error('[inventory/stocktakes/confirm] load failed:', sErr);
    return NextResponse.json({ error: 'Failed to load stocktake' }, { status: 500 });
  }
  if (!session) return NextResponse.json({ error: '盘点不存在' }, { status: 404 });
  if (session.status !== 'draft') return NextResponse.json({ error: '仅草稿状态可以确认' }, { status: 400 });

  const [{ data: lines, error: lErr }, { data: bal, error: bErr }] = await Promise.all([
    supabaseAdmin
      .from('inventory_stocktake_lines')
      .select('item_id, system_qty, counted_qty, item:inventory_items!item_id ( stock_id, name_cn )')
      .eq('stocktake_id', id),
    supabaseAdmin.from('inventory_balances').select('item_id, qty').eq('location_id', session.location_id),
  ]);
  if (lErr || bErr || !lines) {
    console.error('[inventory/stocktakes/confirm] lines/balances load failed:', lErr ?? bErr);
    return NextResponse.json({ error: 'Failed to load lines' }, { status: 500 });
  }

  const balMap = new Map<string, number>();
  for (const b of (bal ?? []) as { item_id: string; qty: number }[]) balMap.set(b.item_id, b.qty);

  const me = access.volunteer;
  const note = `盘点 ${id.slice(0, 8)}`;
  const movements: Record<string, unknown>[] = [];
  const driftWarnings: { item_id: string; stock_id: string | null; name_cn: string; system_qty: number; current: number }[] = [];
  let skipped = 0;

  for (const l of lines as Line[]) {
    if (l.counted_qty === null) {
      skipped += 1;
      continue;
    }
    const current = balMap.get(l.item_id) ?? 0;
    if (current !== l.system_qty) {
      const it = one(l.item);
      driftWarnings.push({ item_id: l.item_id, stock_id: it?.stock_id ?? null, name_cn: it?.name_cn ?? '', system_qty: l.system_qty, current });
    }
    const diff = l.counted_qty - current;
    if (diff === 0) continue;
    movements.push({
      item_id: l.item_id,
      movement_type: diff > 0 ? 'adjust_in' : 'adjust_out',
      from_location_id: diff > 0 ? null : session.location_id,
      to_location_id: diff > 0 ? session.location_id : null,
      qty: Math.abs(diff),
      note,
      stocktake_id: id,
      created_by: me.id,
    });
  }

  if (movements.length > 0) {
    const { error: movErr } = await supabaseAdmin.from('inventory_movements').insert(movements);
    if (movErr) {
      console.error('[inventory/stocktakes/confirm] movement insert failed, rolling back:', movErr);
      await supabaseAdmin.from('inventory_movements').delete().eq('stocktake_id', id);
      return NextResponse.json({ error: '确认失败（无法记录盘点调整）' }, { status: 500 });
    }
  }

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('inventory_stocktakes')
    .update({ status: 'confirmed', confirmed_by: me.id, confirmed_at: new Date().toISOString() })
    .eq('id', id)
    .select(STOCKTAKE_SELECT)
    .single();
  if (updErr || !updated) {
    console.error('[inventory/stocktakes/confirm] status update failed, rolling back movements:', updErr);
    await supabaseAdmin.from('inventory_movements').delete().eq('stocktake_id', id);
    return NextResponse.json({ error: '确认失败（状态未更新）' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: 'update',
    tableName: 'inventory_stocktakes',
    recordId: id,
    before: { status: 'draft' },
    after: { status: 'confirmed', adjustments: movements.length, skipped, drift: driftWarnings.length },
  });

  return NextResponse.json({ stocktake: updated, adjustments: movements.length, skipped, driftWarnings });
}
