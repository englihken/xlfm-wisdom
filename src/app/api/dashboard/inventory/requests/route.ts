// src/app/api/dashboard/inventory/requests/route.ts
// GET  — paginated 分会 request list (inventory:view): ?status= &centre_id= &page= &limit=.
//        Each row carries its centre, item, and optional event. Backorder = the
//        difference qty_requested − qty_fulfilled, derived client-side.
// POST — create a request (inventory:edit): the sheet's 分会要求/预订 row. Audited.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { REQUEST_SELECT } from '@/lib/inventory';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const STATUSES = ['pending', 'partial', 'fulfilled', 'cancelled'] as const;

function gate401or403(status: 401 | 403) {
  return NextResponse.json(
    { error: status === 401 ? 'Unauthorized' : 'Forbidden' },
    { status }
  );
}

export async function GET(req: Request) {
  const access = await requireModuleAccess('inventory', 'view');
  if (!access.ok) return gate401or403(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(sp.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const from = (page - 1) * limit;

  let q = supabaseAdmin.from('inventory_requests').select(REQUEST_SELECT, { count: 'exact' });

  const status = sp.get('status');
  if (status && (STATUSES as readonly string[]).includes(status)) q = q.eq('status', status);
  const centreId = sp.get('centre_id');
  if (centreId) q = q.eq('centre_id', centreId);

  q = q.order('created_at', { ascending: false }).range(from, from + limit - 1);

  const { data, count, error } = await q;
  if (error) {
    console.error('[inventory/requests] list query failed:', error);
    return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });
  }

  return NextResponse.json({
    requests: data ?? [],
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)),
  });
}

export async function POST(req: Request) {
  const access = await requireModuleAccess('inventory', 'edit');
  if (!access.ok) return gate401or403(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const centreId = typeof body.centre_id === 'string' ? body.centre_id : '';
  if (!centreId) return NextResponse.json({ error: '请选择分会/中心' }, { status: 400 });
  const { data: centre } = await supabaseAdmin.from('centres').select('id').eq('id', centreId).maybeSingle();
  if (!centre) return NextResponse.json({ error: '中心无效' }, { status: 400 });

  const itemId = typeof body.item_id === 'string' ? body.item_id : '';
  if (!itemId) return NextResponse.json({ error: '请选择品项' }, { status: 400 });
  const { data: item } = await supabaseAdmin
    .from('inventory_items')
    .select('id, stock_id, name_cn')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return NextResponse.json({ error: '品项无效' }, { status: 400 });

  const qty = Number(body.qty_requested);
  if (!Number.isInteger(qty) || qty <= 0) {
    return NextResponse.json({ error: '申请数量须为大于 0 的整数' }, { status: 400 });
  }

  let eventId: string | null = null;
  if (typeof body.event_id === 'string' && body.event_id) {
    const { data: ev } = await supabaseAdmin.from('events').select('id').eq('id', body.event_id).maybeSingle();
    if (!ev) return NextResponse.json({ error: '关联活动无效' }, { status: 400 });
    eventId = body.event_id;
  }

  const me = access.volunteer;
  const { data: request, error: insErr } = await supabaseAdmin
    .from('inventory_requests')
    .insert({
      centre_id: centreId,
      item_id: itemId,
      qty_requested: qty,
      event_id: eventId,
      note: typeof body.note === 'string' ? body.note.trim() || null : null,
      created_by: me.id,
    })
    .select(REQUEST_SELECT)
    .single();
  if (insErr || !request) {
    console.error('[inventory/requests] create failed:', insErr);
    return NextResponse.json({ error: '创建申请失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: 'create',
    tableName: 'inventory_requests',
    recordId: (request as unknown as { id: string }).id,
    after: { centre_id: centreId, item: item.stock_id ?? item.name_cn, qty_requested: qty, event_id: eventId },
  });

  return NextResponse.json({ request }, { status: 201 });
}
