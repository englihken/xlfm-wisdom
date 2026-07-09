// src/app/api/public/inventory/[token]/route.ts
// PUBLIC ANONYMOUS ROUTE — no login; gate is an active share token. Returns ONLY the 总会仓库
// (HQ) live stock as a read-only catalog: name_cn, stock_id, category_cn, qty (non-zero, catalog
// order). NO prices, NO per-location breakdown, NO edits. An unknown/revoked token is 404 (same
// as not-found). Service-role read (bypasses RLS) behind the token check. Mirrors public/events.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sameOrigin, rateLimit, clientIp } from '@/lib/public-event';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!rateLimit(`pub:inv:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { token } = await params;
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: link } = await supabaseAdmin
    .from('inventory_share_links')
    .select('label, is_active')
    .eq('token', token)
    .maybeSingle();
  if (!link || !link.is_active) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: hq } = await supabaseAdmin.from('inventory_locations').select('id').eq('kind', 'hq_warehouse').maybeSingle();
  if (!hq) return NextResponse.json({ label: link.label, items: [] });

  // HQ non-zero balances + category_cn (from items, since the balances view carries only the
  // StockID-prefix category).
  const [{ data: bal }, { data: items }] = await Promise.all([
    supabaseAdmin.from('inventory_balances').select('item_id, item_name, stock_id, qty').eq('location_id', hq.id).neq('qty', 0),
    supabaseAdmin.from('inventory_items').select('id, category_cn').eq('is_active', true),
  ]);
  const catMap = new Map<string, string | null>();
  for (const i of (items ?? []) as { id: string; category_cn: string | null }[]) catMap.set(i.id, i.category_cn);

  const rows = ((bal ?? []) as { item_id: string; item_name: string; stock_id: string | null; qty: number }[])
    .map((b) => ({ name_cn: b.item_name, stock_id: b.stock_id, category_cn: catMap.get(b.item_id) ?? null, qty: b.qty }))
    .sort(
      (a, b) =>
        (a.category_cn ?? '￿').localeCompare(b.category_cn ?? '￿', 'zh') ||
        (a.stock_id ?? '￿').localeCompare(b.stock_id ?? '￿') ||
        a.name_cn.localeCompare(b.name_cn, 'zh')
    );

  return NextResponse.json({ label: link.label, items: rows });
}
