// src/app/api/dashboard/inventory/balances/route.ts
// GET — derived stock levels from the inventory_balances view (inventory:view),
// for ONE location at a time: ?location_id=… [&category=…] [&search=…] [&nonzero=1].
// The view is item × location (239 × 37), so per-location reads stay small; rows
// come back in catalog order (category, then stock_id).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(req: Request) {
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

  const sp = new URL(req.url).searchParams;
  const locationId = (sp.get('location_id') ?? '').trim();
  if (!locationId) {
    return NextResponse.json({ error: '请选择仓库/中心' }, { status: 400 });
  }

  let q = supabaseAdmin
    .from('inventory_balances')
    .select('location_id, location_kind, location_name, item_id, stock_id, item_name, category, pack_qty, qty')
    .eq('location_id', locationId);

  const category = sp.get('category');
  if (category) q = q.eq('category', category);
  if (sp.get('nonzero') === '1') q = q.neq('qty', 0);
  const search = (sp.get('search') ?? '').trim();
  if (search) {
    const safe = search.replace(/[,.()%*"\\]/g, ' ').trim();
    if (safe) q = q.or(`item_name.ilike.%${safe}%,stock_id.ilike.%${safe}%`);
  }

  q = q.order('category', { ascending: true }).order('stock_id', { ascending: true }).limit(500);

  const { data, error } = await q;
  if (error) {
    console.error('[inventory/balances] query failed:', error);
    return NextResponse.json({ error: 'Failed to load balances' }, { status: 500 });
  }

  return NextResponse.json({ balances: data ?? [] });
}
