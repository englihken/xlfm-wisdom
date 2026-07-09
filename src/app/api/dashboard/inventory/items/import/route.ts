// src/app/api/dashboard/inventory/items/import/route.ts
// POST — bulk-create catalog items from a parsed CSV (inventory:edit). Body { rows: [...] }.
// The SERVER re-validates every row (same rules as items POST — name_cn + category_cn required,
// pack_qty/low_stock_line positive ints, stock_id unique) and inserts the valid ones one by one
// so a bad row (e.g. a duplicate StockID) fails ALONE and is reported per-row. Returns a result
// per row; writes ONE 'import' audit entry with the ok/failed/total counts.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { optPosInt } from '../route';

export const runtime = 'nodejs';

const MAX_ROWS = 500;

export async function POST(req: Request) {
  const access = await requireModuleAccess('inventory', 'edit');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { rows?: unknown } | null;
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  if (rows.length === 0) return NextResponse.json({ error: 'CSV 没有数据行' }, { status: 400 });
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: `一次最多导入 ${MAX_ROWS} 行` }, { status: 400 });

  const results: { row: number; ok: boolean; name_cn: string; error?: string }[] = [];
  let okCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = (rows[i] ?? {}) as Record<string, unknown>;
    const nameCn = typeof r.name_cn === 'string' ? r.name_cn.trim() : '';
    const categoryCn = typeof r.category_cn === 'string' ? r.category_cn.trim() : '';
    if (!nameCn) {
      results.push({ row: i + 1, ok: false, name_cn: nameCn, error: '缺少品项名称' });
      continue;
    }
    if (!categoryCn) {
      results.push({ row: i + 1, ok: false, name_cn: nameCn, error: '缺少分类' });
      continue;
    }
    const packQty = optPosInt(r.pack_qty);
    if (packQty === 'invalid') {
      results.push({ row: i + 1, ok: false, name_cn: nameCn, error: '每包数量无效' });
      continue;
    }
    const lowLine = optPosInt(r.low_stock_line);
    if (lowLine === 'invalid') {
      results.push({ row: i + 1, ok: false, name_cn: nameCn, error: '低库存线无效' });
      continue;
    }
    const stockId = typeof r.stock_id === 'string' && r.stock_id.trim() ? r.stock_id.trim() : null;
    const remark = typeof r.remark === 'string' && r.remark.trim() ? r.remark.trim() : null;

    const { error } = await supabaseAdmin
      .from('inventory_items')
      .insert({ name_cn: nameCn, category_cn: categoryCn, stock_id: stockId, remark, pack_qty: packQty, low_stock_line: lowLine });
    if (error) {
      results.push({ row: i + 1, ok: false, name_cn: nameCn, error: error.code === '23505' ? '编号（StockID）已存在' : '写入失败' });
      continue;
    }
    okCount += 1;
    results.push({ row: i + 1, ok: true, name_cn: nameCn });
  }

  const me = access.volunteer;
  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: 'import',
    tableName: 'inventory_items',
    recordId: 'bulk',
    after: { total: rows.length, ok: okCount, failed: rows.length - okCount },
  });

  return NextResponse.json({ results, ok: okCount, failed: rows.length - okCount, total: rows.length });
}
