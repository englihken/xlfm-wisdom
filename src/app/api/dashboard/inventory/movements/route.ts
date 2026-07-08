// src/app/api/dashboard/inventory/movements/route.ts
// GET  — paginated ledger list (inventory:view) with filters: ?item_id= &location_id=
//        (matches either side) &event_id= &type= &page= &limit=. When event_id is
//        given the response also carries a per-item `summary` (the 拣货/发放 totals
//        for that 法会), aggregated over ALL matching rows, not just the page.
// POST — record a movement (inventory:edit). Validates the direction rules exactly as
//        the DB CHECK does (friendly errors), verifies item/location/event existence,
//        and blocks outbound moves that would drive a location's derived balance
//        negative (库存不足). Audits the create. 'opening' is seed-only — rejected.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import {
  CREATABLE_MOVEMENT_TYPES,
  DIRECTION_RULES,
  isValidDateStr,
  locationBalance,
  type CreatableMovementType,
} from '@/lib/inventory';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const MOVEMENT_SELECT =
  'id, movement_type, qty, note, moved_at, created_at, ' +
  'item:inventory_items!item_id ( id, stock_id, name_cn ), ' +
  'from_location:inventory_locations!from_location_id ( id, name_cn, kind ), ' +
  'to_location:inventory_locations!to_location_id ( id, name_cn, kind ), ' +
  'event:events!event_id ( id, code, title ), ' +
  'creator:volunteers!created_by ( display_name, email )';

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

  let q = supabaseAdmin.from('inventory_movements').select(MOVEMENT_SELECT, { count: 'exact' });

  const itemId = sp.get('item_id');
  const locationId = sp.get('location_id');
  const eventId = sp.get('event_id');
  const type = sp.get('type');
  if (itemId) q = q.eq('item_id', itemId);
  if (locationId) q = q.or(`from_location_id.eq.${locationId},to_location_id.eq.${locationId}`);
  if (eventId) q = q.eq('event_id', eventId);
  if (type) q = q.eq('movement_type', type);

  q = q.order('created_at', { ascending: false }).range(from, from + limit - 1);

  const { data, count, error } = await q;
  if (error) {
    console.error('[inventory/movements] list query failed:', error);
    return NextResponse.json({ error: 'Failed to load movements' }, { status: 500 });
  }

  // Event picking summary: per-item totals across ALL rows of this event (cap 1000).
  let summary: { item_id: string; stock_id: string | null; name_cn: string; qty: number }[] | undefined;
  if (eventId) {
    const { data: evRows, error: evErr } = await supabaseAdmin
      .from('inventory_movements')
      .select('item_id, qty, movement_type, item:inventory_items!item_id ( stock_id, name_cn )')
      .eq('event_id', eventId)
      .limit(1000);
    if (evErr) {
      console.error('[inventory/movements] event summary failed (non-fatal):', evErr);
    } else {
      const byItem = new Map<string, { item_id: string; stock_id: string | null; name_cn: string; qty: number }>();
      for (const r of (evRows ?? []) as unknown as {
        item_id: string;
        qty: number;
        movement_type: string;
        item: { stock_id: string | null; name_cn: string } | { stock_id: string | null; name_cn: string }[] | null;
      }[]) {
        const item = Array.isArray(r.item) ? r.item[0] : r.item;
        const cur = byItem.get(r.item_id) ?? {
          item_id: r.item_id,
          stock_id: item?.stock_id ?? null,
          name_cn: item?.name_cn ?? '',
          qty: 0,
        };
        // Outbound counts positive toward the event; a return subtracts.
        cur.qty += r.movement_type === 'return' ? -Number(r.qty || 0) : Number(r.qty || 0);
        byItem.set(r.item_id, cur);
      }
      summary = Array.from(byItem.values()).sort((a, b) => (a.stock_id ?? '').localeCompare(b.stock_id ?? ''));
    }
  }

  return NextResponse.json({
    movements: data ?? [],
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)),
    ...(summary ? { summary } : {}),
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

  const movementType = typeof body.movement_type === 'string' ? body.movement_type : '';
  if (!(CREATABLE_MOVEMENT_TYPES as readonly string[]).includes(movementType)) {
    return NextResponse.json({ error: '变动类型无效' }, { status: 400 });
  }
  const type = movementType as CreatableMovementType;
  const rule = DIRECTION_RULES[type];

  const itemId = typeof body.item_id === 'string' ? body.item_id : '';
  if (!itemId) return NextResponse.json({ error: '请选择品项' }, { status: 400 });

  const qty = Number(body.qty);
  if (!Number.isInteger(qty) || qty <= 0) {
    return NextResponse.json({ error: '数量须为大于 0 的整数' }, { status: 400 });
  }

  const fromId = typeof body.from_location_id === 'string' && body.from_location_id ? body.from_location_id : null;
  const toId = typeof body.to_location_id === 'string' && body.to_location_id ? body.to_location_id : null;
  if (rule.from && !fromId) return NextResponse.json({ error: '此类型需要选择「从仓」' }, { status: 400 });
  if (!rule.from && fromId) return NextResponse.json({ error: '此类型不应有「从仓」' }, { status: 400 });
  if (rule.to && !toId) return NextResponse.json({ error: '此类型需要选择「到仓」' }, { status: 400 });
  if (!rule.to && toId) return NextResponse.json({ error: '此类型不应有「到仓」' }, { status: 400 });
  if (fromId && toId && fromId === toId) {
    return NextResponse.json({ error: '「从仓」与「到仓」不能相同' }, { status: 400 });
  }

  // Existence checks (item, locations, optional event).
  const { data: item } = await supabaseAdmin
    .from('inventory_items')
    .select('id, stock_id, name_cn')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return NextResponse.json({ error: '品项无效' }, { status: 400 });

  for (const [locId, label] of [
    [fromId, '从仓'],
    [toId, '到仓'],
  ] as const) {
    if (!locId) continue;
    const { data: loc } = await supabaseAdmin
      .from('inventory_locations')
      .select('id')
      .eq('id', locId)
      .maybeSingle();
    if (!loc) return NextResponse.json({ error: `「${label}」无效` }, { status: 400 });
  }

  let eventId: string | null = null;
  if (typeof body.event_id === 'string' && body.event_id) {
    const { data: ev } = await supabaseAdmin.from('events').select('id').eq('id', body.event_id).maybeSingle();
    if (!ev) return NextResponse.json({ error: '关联活动无效' }, { status: 400 });
    eventId = body.event_id;
  }

  let movedAt: string | undefined;
  if (body.moved_at !== undefined && body.moved_at !== null && body.moved_at !== '') {
    if (!isValidDateStr(body.moved_at)) return NextResponse.json({ error: '日期无效' }, { status: 400 });
    movedAt = body.moved_at;
  }

  // Negative-stock guard: an outbound move may not exceed the source's derived balance.
  if (fromId) {
    const balance = await locationBalance(supabaseAdmin, itemId, fromId);
    if (balance === null) return NextResponse.json({ error: '库存读取失败，请重试' }, { status: 500 });
    if (qty > balance) {
      return NextResponse.json({ error: `库存不足（该仓现有 ${balance} 件）` }, { status: 400 });
    }
  }

  const me = access.volunteer;
  const { data: movement, error: insErr } = await supabaseAdmin
    .from('inventory_movements')
    .insert({
      item_id: itemId,
      movement_type: type,
      from_location_id: fromId,
      to_location_id: toId,
      qty,
      event_id: eventId,
      note: typeof body.note === 'string' ? body.note.trim() || null : null,
      ...(movedAt ? { moved_at: movedAt } : {}),
      created_by: me.id,
    })
    .select(MOVEMENT_SELECT)
    .single();
  if (insErr || !movement) {
    console.error('[inventory/movements] create failed:', insErr);
    return NextResponse.json({ error: '记录变动失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: 'create',
    tableName: 'inventory_movements',
    recordId: (movement as unknown as { id: string }).id,
    after: { item: item.stock_id ?? item.name_cn, movement_type: type, qty, from_location_id: fromId, to_location_id: toId, event_id: eventId },
  });

  return NextResponse.json({ movement }, { status: 201 });
}
