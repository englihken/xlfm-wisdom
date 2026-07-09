// src/app/api/dashboard/inventory/stocktakes/[id]/route.ts
// GET — one 盘点 session with its lines (inventory:view): session (+ location) and every line
// joined to the item (name / stock_id / category_cn), in catalog order. When the session is
// confirmed, the adjustment movements it produced are returned too (linked via stocktake_id).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { STOCKTAKE_SELECT, LINE_SELECT } from '../route';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('inventory', 'view');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;

  const [{ data: session, error: sErr }, { data: lines, error: lErr }] = await Promise.all([
    supabaseAdmin.from('inventory_stocktakes').select(STOCKTAKE_SELECT).eq('id', id).maybeSingle(),
    supabaseAdmin
      .from('inventory_stocktake_lines')
      .select(LINE_SELECT)
      .eq('stocktake_id', id),
  ]);
  if (sErr || lErr) {
    console.error('[inventory/stocktakes/:id] load failed:', sErr ?? lErr);
    return NextResponse.json({ error: 'Failed to load stocktake' }, { status: 500 });
  }
  if (!session) return NextResponse.json({ error: '盘点不存在' }, { status: 404 });

  // Catalog order: stock_id then name (join arrives unordered).
  type Lite = { stock_id: string | null; name_cn: string };
  type LineRow = { item: Lite | Lite[] | null };
  const ordered = ((lines ?? []) as unknown as LineRow[]).slice().sort((a, b) => {
    const ai = Array.isArray(a.item) ? a.item[0] : a.item;
    const bi = Array.isArray(b.item) ? b.item[0] : b.item;
    return (ai?.stock_id ?? '￿').localeCompare(bi?.stock_id ?? '￿') || (ai?.name_cn ?? '').localeCompare(bi?.name_cn ?? '', 'zh');
  });

  let adjustments: unknown[] | undefined;
  if ((session as unknown as { status: string }).status === 'confirmed') {
    const { data: movs } = await supabaseAdmin
      .from('inventory_movements')
      .select('id, movement_type, qty, moved_at, item:inventory_items!item_id ( stock_id, name_cn )')
      .eq('stocktake_id', id)
      .order('created_at', { ascending: true });
    adjustments = movs ?? [];
  }

  return NextResponse.json({ stocktake: session, lines: ordered, ...(adjustments ? { adjustments } : {}) });
}
