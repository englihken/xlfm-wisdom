// src/app/api/dashboard/inventory/stocktakes/route.ts
// GET  — 盘点 session list (inventory:view): each session with its location + line/counted
//        counts (two queries, counts folded in memory — no per-session N+1).
// POST — start a session (inventory:edit): { location_id, category_cn? }. Creates the session
//        and one line per matching ACTIVE item, snapshotting system_qty = the item's current
//        derived balance at that location (read once from inventory_balances — no N+1). Returns
//        the session with its lines.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const STOCKTAKE_SELECT =
  'id, location_id, category_cn, status, note, created_at, confirmed_at, ' +
  'location:inventory_locations!location_id ( id, name_cn, kind )';
export const LINE_SELECT =
  'id, item_id, system_qty, counted_qty, ' +
  'item:inventory_items!item_id ( id, stock_id, name_cn, category_cn )';

function gate401or403(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

export async function GET() {
  const access = await requireModuleAccess('inventory', 'view');
  if (!access.ok) return gate401or403(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { data: sessions, error } = await supabaseAdmin
    .from('inventory_stocktakes')
    .select(STOCKTAKE_SELECT)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('[inventory/stocktakes] list failed:', error);
    return NextResponse.json({ error: 'Failed to load stocktakes' }, { status: 500 });
  }

  const ids = (sessions ?? []).map((s) => (s as unknown as { id: string }).id);
  const counts = new Map<string, { total: number; counted: number }>();
  if (ids.length) {
    const { data: lines } = await supabaseAdmin
      .from('inventory_stocktake_lines')
      .select('stocktake_id, counted_qty')
      .in('stocktake_id', ids);
    for (const l of (lines ?? []) as { stocktake_id: string; counted_qty: number | null }[]) {
      const c = counts.get(l.stocktake_id) ?? { total: 0, counted: 0 };
      c.total += 1;
      if (l.counted_qty !== null) c.counted += 1;
      counts.set(l.stocktake_id, c);
    }
  }

  const withCounts = ((sessions ?? []) as unknown as Record<string, unknown>[]).map((s) => {
    const id = (s as { id: string }).id;
    return { ...s, lineCount: counts.get(id)?.total ?? 0, countedCount: counts.get(id)?.counted ?? 0 };
  });

  return NextResponse.json({ stocktakes: withCounts });
}

export async function POST(req: Request) {
  const access = await requireModuleAccess('inventory', 'edit');
  if (!access.ok) return gate401or403(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const locationId = typeof body?.location_id === 'string' ? body.location_id : '';
  if (!locationId) return NextResponse.json({ error: '请选择盘点地点' }, { status: 400 });
  const categoryCn = typeof body?.category_cn === 'string' && body.category_cn.trim() ? body.category_cn.trim() : null;

  const { data: loc } = await supabaseAdmin.from('inventory_locations').select('id').eq('id', locationId).maybeSingle();
  if (!loc) return NextResponse.json({ error: '盘点地点无效' }, { status: 400 });

  // Active items in scope + this location's current balances (both read once).
  let itemQ = supabaseAdmin.from('inventory_items').select('id').eq('is_active', true);
  if (categoryCn) itemQ = itemQ.eq('category_cn', categoryCn);
  const [{ data: items, error: itemErr }, { data: bal, error: balErr }] = await Promise.all([
    itemQ,
    supabaseAdmin.from('inventory_balances').select('item_id, qty').eq('location_id', locationId),
  ]);
  if (itemErr || balErr) {
    console.error('[inventory/stocktakes] scope load failed:', itemErr ?? balErr);
    return NextResponse.json({ error: 'Failed to prepare session' }, { status: 500 });
  }
  if (!items || items.length === 0) return NextResponse.json({ error: '该范围没有可盘点的品项' }, { status: 400 });
  const balMap = new Map<string, number>();
  for (const b of (bal ?? []) as { item_id: string; qty: number }[]) balMap.set(b.item_id, b.qty);

  const me = access.volunteer;
  const { data: session, error: insErr } = await supabaseAdmin
    .from('inventory_stocktakes')
    .insert({ location_id: locationId, category_cn: categoryCn, created_by: me.id })
    .select(STOCKTAKE_SELECT)
    .single();
  if (insErr || !session) {
    console.error('[inventory/stocktakes] create failed:', insErr);
    return NextResponse.json({ error: '创建盘点失败' }, { status: 500 });
  }
  const sessionId = (session as unknown as { id: string }).id;

  const lineRows = items.map((i) => ({ stocktake_id: sessionId, item_id: i.id, system_qty: balMap.get(i.id) ?? 0 }));
  const { error: lineErr } = await supabaseAdmin.from('inventory_stocktake_lines').insert(lineRows);
  if (lineErr) {
    console.error('[inventory/stocktakes] line insert failed, rolling back session:', lineErr);
    await supabaseAdmin.from('inventory_stocktakes').delete().eq('id', sessionId);
    return NextResponse.json({ error: '创建盘点明细失败' }, { status: 500 });
  }

  const { data: lines } = await supabaseAdmin
    .from('inventory_stocktake_lines')
    .select(LINE_SELECT)
    .eq('stocktake_id', sessionId)
    .order('item_id', { ascending: true });

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: 'create',
    tableName: 'inventory_stocktakes',
    recordId: sessionId,
    after: { location_id: locationId, category_cn: categoryCn, lines: lineRows.length },
  });

  return NextResponse.json({ stocktake: session, lines: lines ?? [] }, { status: 201 });
}
