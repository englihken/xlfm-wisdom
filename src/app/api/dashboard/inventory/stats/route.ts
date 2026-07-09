// src/app/api/dashboard/inventory/stats/route.ts
// GET — dashboard (仪表板) aggregates (inventory:view). Computed from a SMALL, bounded set of
// reads (no per-item N+1): the active catalog, all NON-ZERO balances, the pending-request
// count, and the last 90 days of movements — then folded in memory. Returns:
//   kpis        — totalUnits, itemCount, pendingRequests, lowStockCount, monthOut, monthReturns
//   lowStock[]  — active items at/under their low_stock_line (HQ), with 90d avg monthly outflow
//                 and monthsLeft = HQ qty ÷ avg, worst (soonest to run out) first
//   topMovers30d[] — top 8 items by 30-day outbound qty from 总会仓库
//   categoryTotals[] — total units per category_cn across every location
//   holdings[]  — total units per location (non-zero), 总会仓库-first-then-largest
// Outbound = stock leaving 总会仓库 (distribution / transfer / adjust_out). 本月 = calendar month.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const OUTBOUND_TYPES = new Set(['distribution', 'transfer', 'adjust_out']);

type ItemMeta = { name_cn: string; stock_id: string | null; category_cn: string | null; low_stock_line: number | null };
type MovementLite = {
  item_id: string;
  movement_type: string;
  from_location_id: string | null;
  to_location_id: string | null;
  qty: number;
  moved_at: string;
};
type BalanceLite = {
  location_id: string;
  location_kind: string;
  location_name: string;
  item_id: string;
  qty: number;
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function firstOfMonth(): string {
  return new Date().toISOString().slice(0, 8) + '01';
}

export async function GET() {
  const access = await requireModuleAccess('inventory', 'view');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const since90 = isoDaysAgo(90);

  const [itemsRes, hqRes, balRes, pendRes, mvRes] = await Promise.all([
    supabaseAdmin.from('inventory_items').select('id, stock_id, name_cn, category_cn, low_stock_line').eq('is_active', true),
    supabaseAdmin.from('inventory_locations').select('id').eq('kind', 'hq_warehouse').maybeSingle(),
    supabaseAdmin
      .from('inventory_balances')
      .select('location_id, location_kind, location_name, item_id, qty')
      .neq('qty', 0)
      .limit(20000),
    supabaseAdmin.from('inventory_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin
      .from('inventory_movements')
      .select('item_id, movement_type, from_location_id, to_location_id, qty, moved_at')
      .gte('moved_at', since90)
      .limit(10000),
  ]);

  if (itemsRes.error || balRes.error || mvRes.error) {
    console.error('[inventory/stats] load failed:', itemsRes.error ?? balRes.error ?? mvRes.error);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }

  const hqId = hqRes.data?.id ?? null;
  const items = new Map<string, ItemMeta>();
  for (const i of itemsRes.data ?? []) {
    items.set(i.id, { name_cn: i.name_cn, stock_id: i.stock_id, category_cn: i.category_cn, low_stock_line: i.low_stock_line });
  }
  const balances = (balRes.data ?? []) as BalanceLite[];
  const movements = (mvRes.data ?? []) as MovementLite[];

  // Holdings per location + total units + category totals + HQ qty per item.
  const holdingsMap = new Map<string, { location_id: string; name: string; kind: string; units: number }>();
  const categoryMap = new Map<string, number>();
  const hqQty = new Map<string, number>();
  let totalUnits = 0;
  for (const b of balances) {
    totalUnits += b.qty;
    const h = holdingsMap.get(b.location_id) ?? { location_id: b.location_id, name: b.location_name, kind: b.location_kind, units: 0 };
    h.units += b.qty;
    holdingsMap.set(b.location_id, h);
    if (hqId && b.location_id === hqId) hqQty.set(b.item_id, b.qty);
    const cat = items.get(b.item_id)?.category_cn ?? '未分类';
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + b.qty);
  }

  const holdings = Array.from(holdingsMap.values()).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'hq_warehouse' ? -1 : 1;
    return b.units - a.units;
  });
  const categoryTotals = Array.from(categoryMap.entries())
    .map(([category_cn, units]) => ({ category_cn, units }))
    .sort((a, b) => b.units - a.units);

  // Movement folds: 90d HQ outflow per item, 30d outbound per item, 本月 out / returns.
  const since30 = isoDaysAgo(30);
  const monthStart = firstOfMonth();
  const outflow90 = new Map<string, number>();
  const outbound30 = new Map<string, number>();
  let monthOut = 0;
  let monthReturns = 0;
  for (const m of movements) {
    const fromHq = hqId != null && m.from_location_id === hqId;
    const outbound = OUTBOUND_TYPES.has(m.movement_type);
    if (fromHq && outbound) {
      outflow90.set(m.item_id, (outflow90.get(m.item_id) ?? 0) + m.qty);
      if (m.moved_at >= since30) outbound30.set(m.item_id, (outbound30.get(m.item_id) ?? 0) + m.qty);
      if (m.moved_at >= monthStart && (m.movement_type === 'distribution' || m.movement_type === 'transfer')) monthOut += m.qty;
    }
    if (m.movement_type === 'return' && hqId != null && m.to_location_id === hqId && m.moved_at >= monthStart) {
      monthReturns += m.qty;
    }
  }

  // Low stock (HQ) — active items with a low_stock_line, at/under it. worst (least monthsLeft) first.
  const lowStock = Array.from(items.entries())
    .filter(([, meta]) => meta.low_stock_line != null)
    .map(([id, meta]) => {
      const qty = hqQty.get(id) ?? 0;
      const avgMonthly = (outflow90.get(id) ?? 0) / 3;
      const monthsLeft = avgMonthly > 0 ? qty / avgMonthly : null;
      return { item_id: id, stock_id: meta.stock_id, name_cn: meta.name_cn, category_cn: meta.category_cn, qty, low_stock_line: meta.low_stock_line, avgMonthly: Math.round(avgMonthly), monthsLeft };
    })
    .filter((r) => r.qty <= (r.low_stock_line as number))
    .sort((a, b) => {
      const am = a.monthsLeft ?? Infinity;
      const bm = b.monthsLeft ?? Infinity;
      return am - bm;
    });

  const topMovers30d = Array.from(outbound30.entries())
    .map(([id, qty]) => ({ item_id: id, stock_id: items.get(id)?.stock_id ?? null, name_cn: items.get(id)?.name_cn ?? '', qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 8);

  return NextResponse.json({
    kpis: {
      totalUnits,
      itemCount: items.size,
      pendingRequests: pendRes.count ?? 0,
      lowStockCount: lowStock.length,
      monthOut,
      monthReturns,
    },
    lowStock,
    topMovers30d,
    categoryTotals,
    holdings,
  });
}
