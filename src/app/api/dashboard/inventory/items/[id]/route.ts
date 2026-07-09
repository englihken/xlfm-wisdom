// src/app/api/dashboard/inventory/items/[id]/route.ts
// GET   — one item's drawer payload (inventory:view): the item, its per-location balances
//         (non-zero, largest first), and its last 10 movements (with photo + reversal linkage).
// PATCH — edit a catalog item (inventory:edit): name_cn, remark, pack_qty, stock_id,
//         category_cn, low_stock_line, photo_path, is_active. Only provided keys change.
//         stock_id stays unique. Audited (deactivate/reactivate flagged distinctly).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { MOVEMENT_SELECT } from '@/lib/inventory';
import { optPosInt } from '../route';

export const runtime = 'nodejs';

const ITEM_SELECT = 'id, stock_id, name_cn, category, category_cn, remark, pack_qty, low_stock_line, photo_path, is_active';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('inventory', 'view');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;

  const [itemRes, balRes, mvRes] = await Promise.all([
    supabaseAdmin.from('inventory_items').select(ITEM_SELECT).eq('id', id).maybeSingle(),
    supabaseAdmin
      .from('inventory_balances')
      .select('location_id, location_kind, location_name, qty')
      .eq('item_id', id)
      .neq('qty', 0),
    supabaseAdmin
      .from('inventory_movements')
      .select(MOVEMENT_SELECT)
      .eq('item_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  if (itemRes.error) {
    console.error('[inventory/items/:id] load failed:', itemRes.error);
    return NextResponse.json({ error: 'Failed to load item' }, { status: 500 });
  }
  if (!itemRes.data) return NextResponse.json({ error: '品项不存在' }, { status: 404 });

  const balances = (balRes.data ?? []).sort((a, b) => {
    if (a.location_kind !== b.location_kind) return a.location_kind === 'hq_warehouse' ? -1 : 1;
    return b.qty - a.qty;
  });

  return NextResponse.json({ item: itemRes.data, balances, movements: mvRes.data ?? [] });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('inventory', 'edit');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { data: before, error: beforeErr } = await supabaseAdmin.from('inventory_items').select(ITEM_SELECT).eq('id', id).maybeSingle();
  if (beforeErr) {
    console.error('[inventory/items/:id] PATCH load failed:', beforeErr);
    return NextResponse.json({ error: 'Failed to load item' }, { status: 500 });
  }
  if (!before) return NextResponse.json({ error: '品项不存在' }, { status: 404 });

  const patch: Record<string, unknown> = {};

  if (typeof body.name_cn === 'string') {
    const v = body.name_cn.trim();
    if (!v) return NextResponse.json({ error: '品项名称不能为空' }, { status: 400 });
    patch.name_cn = v;
  }
  if (typeof body.category_cn === 'string') {
    const v = body.category_cn.trim();
    if (!v) return NextResponse.json({ error: '分类不能为空' }, { status: 400 });
    patch.category_cn = v;
  }
  if ('stock_id' in body) patch.stock_id = typeof body.stock_id === 'string' && body.stock_id.trim() ? body.stock_id.trim() : null;
  if ('remark' in body) patch.remark = typeof body.remark === 'string' && body.remark.trim() ? body.remark.trim() : null;
  if ('pack_qty' in body) {
    const n = optPosInt(body.pack_qty);
    if (n === 'invalid') return NextResponse.json({ error: '每包数量须为大于 0 的整数' }, { status: 400 });
    patch.pack_qty = n;
  }
  if ('low_stock_line' in body) {
    const n = optPosInt(body.low_stock_line);
    if (n === 'invalid') return NextResponse.json({ error: '低库存线须为大于 0 的整数' }, { status: 400 });
    patch.low_stock_line = n;
  }
  if ('photo_path' in body) {
    patch.photo_path = typeof body.photo_path === 'string' && /^photos\/[A-Za-z0-9._-]+$/.test(body.photo_path.trim())
      ? body.photo_path.trim()
      : null;
  }
  if ('is_active' in body) patch.is_active = Boolean(body.is_active);

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
  patch.updated_at = new Date().toISOString();

  const { data: item, error: updErr } = await supabaseAdmin
    .from('inventory_items')
    .update(patch)
    .eq('id', id)
    .select(ITEM_SELECT)
    .single();
  if (updErr || !item) {
    if (updErr?.code === '23505') return NextResponse.json({ error: '编号（StockID）已存在' }, { status: 400 });
    console.error('[inventory/items/:id] update failed:', updErr);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }

  const me = access.volunteer;
  const action = 'is_active' in patch && patch.is_active !== before.is_active ? (patch.is_active ? 'reactivate' : 'deactivate') : 'update';
  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action,
    tableName: 'inventory_items',
    recordId: id,
    before,
    after: item,
  });

  return NextResponse.json({ item });
}
