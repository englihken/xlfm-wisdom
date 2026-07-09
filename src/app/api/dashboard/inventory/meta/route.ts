// src/app/api/dashboard/inventory/meta/route.ts
// GET — reference data for 库存 dropdowns (inventory:view): active locations (总会仓库
// first, then centres by name), the active item catalog, and recent events for the
// 关联法会 pickers. Served under the INVENTORY grant on purpose — an inventory-only
// account must not need events:view just to tag a movement with a 法会.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const access = await requireModuleAccess('inventory', 'view');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  const [locRes, itemRes, evRes] = await Promise.all([
    supabaseAdmin
      .from('inventory_locations')
      .select('id, kind, centre_id, name_cn')
      .eq('is_active', true),
    supabaseAdmin
      .from('inventory_items')
      .select('id, stock_id, name_cn, category, category_cn, pack_qty, low_stock_line, photo_path')
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('stock_id', { ascending: true }),
    supabaseAdmin
      .from('events')
      .select('id, code, title, status, starts_on')
      .order('starts_on', { ascending: false })
      .limit(20),
  ]);

  if (locRes.error || itemRes.error || evRes.error) {
    console.error('[inventory/meta] load failed:', locRes.error ?? itemRes.error ?? evRes.error);
    return NextResponse.json({ error: 'Failed to load reference data' }, { status: 500 });
  }

  // 总会仓库 first, then centre stores by name.
  const locations = (locRes.data ?? []).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'hq_warehouse' ? -1 : 1;
    return (a.name_cn ?? '').localeCompare(b.name_cn ?? '', 'zh');
  });

  const items = itemRes.data ?? [];
  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort();
  // 023 display categories (category_cn) — the 8 buckets the UI groups + filters by.
  const categoriesCn = Array.from(new Set(items.map((i) => i.category_cn).filter(Boolean))).sort((a, b) =>
    (a as string).localeCompare(b as string, 'zh')
  );

  return NextResponse.json({ locations, items, categories, categoriesCn, events: evRes.data ?? [] });
}
