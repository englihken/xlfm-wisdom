// src/app/api/dashboard/inventory/stocktakes/[id]/lines/route.ts
// PATCH — save counted quantities (inventory:edit), DRAFT sessions only. Body:
//   { counts: { <item_id>: number | null, … } }  (a positive int or null to clear a count).
// Merges the given counts onto the session's existing lines and writes them back in ONE upsert
// (keyed by line id) — no per-line round-trips. Existing counts for items not in the payload are
// preserved. This is the 存草稿 save; confirming is a separate step.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('inventory', 'edit');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { counts?: Record<string, unknown> } | null;
  const counts = body?.counts;
  if (!counts || typeof counts !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { data: session } = await supabaseAdmin.from('inventory_stocktakes').select('id, status').eq('id', id).maybeSingle();
  if (!session) return NextResponse.json({ error: '盘点不存在' }, { status: 404 });
  if (session.status !== 'draft') return NextResponse.json({ error: '仅草稿状态可以修改' }, { status: 400 });

  // Validate provided counts.
  const clean = new Map<string, number | null>();
  for (const [itemId, raw] of Object.entries(counts)) {
    if (raw === null || raw === '') {
      clean.set(itemId, null);
      continue;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return NextResponse.json({ error: '实点数须为 0 或正整数' }, { status: 400 });
    clean.set(itemId, n);
  }

  const { data: lines, error: linesErr } = await supabaseAdmin
    .from('inventory_stocktake_lines')
    .select('id, stocktake_id, item_id, system_qty, counted_qty')
    .eq('stocktake_id', id);
  if (linesErr || !lines) {
    console.error('[inventory/stocktakes/lines] load failed:', linesErr);
    return NextResponse.json({ error: 'Failed to load lines' }, { status: 500 });
  }

  const upsertRows = lines.map((l) => ({
    id: l.id,
    stocktake_id: l.stocktake_id,
    item_id: l.item_id,
    system_qty: l.system_qty,
    counted_qty: clean.has(l.item_id) ? clean.get(l.item_id)! : l.counted_qty,
  }));

  const { error: upErr } = await supabaseAdmin.from('inventory_stocktake_lines').upsert(upsertRows, { onConflict: 'id' });
  if (upErr) {
    console.error('[inventory/stocktakes/lines] upsert failed:', upErr);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }

  const counted = upsertRows.filter((r) => r.counted_qty !== null).length;
  return NextResponse.json({ ok: true, total: upsertRows.length, counted });
}
