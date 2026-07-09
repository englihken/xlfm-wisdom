// src/app/api/dashboard/inventory/items/route.ts
// GET  — catalog list for 品项管理 (inventory:view): ?category_cn= &search= &include_inactive=1.
//        Returns items in catalog order (category, stock_id); 停用 items included only when
//        include_inactive=1 (so the page can 启用 them).
// POST — create a catalog item (inventory:edit): name_cn + category_cn REQUIRED; stock_id,
//        remark, pack_qty, low_stock_line, photo_path all optional. New items start active.
//        stock_id must be unique (friendly error on clash). Audited. Item balances accrue only
//        via movements — creating an item does not seed any stock.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const ITEM_SELECT = 'id, stock_id, name_cn, category, category_cn, remark, pack_qty, low_stock_line, photo_path, is_active';

// Shared with PATCH: a positive integer, or null when blank/omitted.
export function optPosInt(v: unknown): number | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return 'invalid';
  return n;
}

export async function GET(req: Request) {
  const access = await requireModuleAccess('inventory', 'view');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  let q = supabaseAdmin.from('inventory_items').select(ITEM_SELECT);
  if (sp.get('include_inactive') !== '1') q = q.eq('is_active', true);
  const categoryCn = sp.get('category_cn');
  if (categoryCn) q = q.eq('category_cn', categoryCn);
  const search = (sp.get('search') ?? '').trim();
  if (search) {
    const safe = search.replace(/[,.()%*"\\]/g, ' ').trim();
    if (safe) q = q.or(`name_cn.ilike.%${safe}%,stock_id.ilike.%${safe}%`);
  }
  q = q.order('category_cn', { ascending: true }).order('stock_id', { ascending: true }).limit(1000);

  const { data, error } = await q;
  if (error) {
    console.error('[inventory/items] list failed:', error);
    return NextResponse.json({ error: 'Failed to load items' }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: Request) {
  const access = await requireModuleAccess('inventory', 'edit');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const nameCn = typeof body.name_cn === 'string' ? body.name_cn.trim() : '';
  if (!nameCn) return NextResponse.json({ error: '请填写品项名称' }, { status: 400 });
  const categoryCn = typeof body.category_cn === 'string' ? body.category_cn.trim() : '';
  if (!categoryCn) return NextResponse.json({ error: '请选择分类' }, { status: 400 });

  const packQty = optPosInt(body.pack_qty);
  if (packQty === 'invalid') return NextResponse.json({ error: '每包数量须为大于 0 的整数' }, { status: 400 });
  const lowLine = optPosInt(body.low_stock_line);
  if (lowLine === 'invalid') return NextResponse.json({ error: '低库存线须为大于 0 的整数' }, { status: 400 });

  const stockId = typeof body.stock_id === 'string' ? body.stock_id.trim() || null : null;
  const remark = typeof body.remark === 'string' ? body.remark.trim() || null : null;
  const photoPath = typeof body.photo_path === 'string' && /^photos\/[A-Za-z0-9._-]+$/.test(body.photo_path.trim())
    ? body.photo_path.trim()
    : null;

  const me = access.volunteer;
  const { data: item, error: insErr } = await supabaseAdmin
    .from('inventory_items')
    .insert({
      name_cn: nameCn,
      category_cn: categoryCn,
      stock_id: stockId,
      remark,
      pack_qty: packQty,
      low_stock_line: lowLine,
      photo_path: photoPath,
    })
    .select('id, stock_id, name_cn, category_cn, remark, pack_qty, low_stock_line, photo_path, is_active')
    .single();
  if (insErr || !item) {
    if (insErr?.code === '23505') return NextResponse.json({ error: '编号（StockID）已存在' }, { status: 400 });
    console.error('[inventory/items] create failed:', insErr);
    return NextResponse.json({ error: '创建品项失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: 'create',
    tableName: 'inventory_items',
    recordId: (item as unknown as { id: string }).id,
    after: { name_cn: nameCn, category_cn: categoryCn, stock_id: stockId },
  });

  return NextResponse.json({ item }, { status: 201 });
}
