// src/lib/inventory.ts
// Shared server-side helpers for the 库存 module routes: movement direction rules
// (mirroring migrations/022's CHECK constraint with friendly errors) and a derived
// balance reader used by the negative-stock guard. Kept out of the route files so
// movements POST and requests fulfil share exactly the same rules.

import type { SupabaseClient } from '@supabase/supabase-js';

// Types the UI may create ('opening' is seed-only; the API rejects it).
export const CREATABLE_MOVEMENT_TYPES = [
  'stock_in',
  'transfer',
  'distribution',
  'return',
  'adjust_in',
  'adjust_out',
] as const;
export type CreatableMovementType = (typeof CREATABLE_MOVEMENT_TYPES)[number];

// Which location sides each type requires — MUST mirror the DB direction CHECK
// (migrations/022 inventory_movements_direction_check).
export const DIRECTION_RULES: Record<CreatableMovementType, { from: boolean; to: boolean }> = {
  stock_in: { from: false, to: true },
  transfer: { from: true, to: true },
  distribution: { from: true, to: false },
  return: { from: true, to: true },
  adjust_in: { from: false, to: true },
  adjust_out: { from: true, to: false },
};

// Shared select shape for request rows (list + approve/reject/release + status
// routes). Lives here because route files may only export route handlers. Carries the
// 023 approval-lifecycle columns (qty_approved + reason + approver + reject reason).
export const REQUEST_SELECT =
  'id, qty_requested, qty_approved, qty_fulfilled, status, approve_reason, rejected_reason, ' +
  'approved_at, note, requested_at, created_at, updated_at, ' +
  'centre:centres!centre_id ( id, code, name_cn ), ' +
  'item:inventory_items!item_id ( id, stock_id, name_cn, pack_qty ), ' +
  'event:events!event_id ( id, code, title ), ' +
  'approver:volunteers!approved_by ( display_name, email )';

// Shared select for movement rows (ledger list + item drawer + reverse route),
// carrying the 023 columns: photo_path (存证/到货照片) and reversal_of (更正撤销 link).
export const MOVEMENT_SELECT =
  'id, movement_type, qty, note, moved_at, created_at, photo_path, request_id, reversal_of, ' +
  'item:inventory_items!item_id ( id, stock_id, name_cn ), ' +
  'from_location:inventory_locations!from_location_id ( id, name_cn, kind ), ' +
  'to_location:inventory_locations!to_location_id ( id, name_cn, kind ), ' +
  'event:events!event_id ( id, code, title ), ' +
  'creator:volunteers!created_by ( display_name, email )';

// The exact-opposite movement used by the 更正撤销 (reverse) route. For a movement of
// `type` with sides (from, to), the reversal has the swapped sides — and, because the
// DB direction CHECK ties movement_type to which sides are present, a matching type:
//   inbound (stock_in/adjust_in: →to)   → adjust_out out of that location
//   outbound (distribution/adjust_out: from→) → adjust_in back into that location
//   two-sided (transfer/return)         → same type, sides swapped
// 'opening' is seed-only and never reversed here (correct it via a stock-take instead).
export function reverseMovement(
  type: string,
  fromId: string | null,
  toId: string | null
): { movement_type: CreatableMovementType; from_location_id: string | null; to_location_id: string | null } | null {
  switch (type) {
    case 'stock_in':
    case 'adjust_in':
      return { movement_type: 'adjust_out', from_location_id: toId, to_location_id: null };
    case 'distribution':
    case 'adjust_out':
      return { movement_type: 'adjust_in', from_location_id: null, to_location_id: fromId };
    case 'transfer':
      return { movement_type: 'transfer', from_location_id: toId, to_location_id: fromId };
    case 'return':
      return { movement_type: 'return', from_location_id: toId, to_location_id: fromId };
    default:
      return null; // 'opening' or unknown — not reversible
  }
}

export function isValidDateStr(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

// Derived on-hand qty for one item at one location: sum(in) − sum(out) over the
// ledger. Two indexed queries — cheap at this scale and always consistent with
// what inventory_balances reports.
export async function locationBalance(
  db: SupabaseClient,
  itemId: string,
  locationId: string
): Promise<number | null> {
  const [inRes, outRes] = await Promise.all([
    db.from('inventory_movements').select('qty').eq('item_id', itemId).eq('to_location_id', locationId),
    db.from('inventory_movements').select('qty').eq('item_id', itemId).eq('from_location_id', locationId),
  ]);
  if (inRes.error || outRes.error) {
    console.error('[inventory] balance read failed:', inRes.error ?? outRes.error);
    return null;
  }
  const sum = (rows: { qty: number }[] | null) => (rows ?? []).reduce((a, r) => a + Number(r.qty || 0), 0);
  return sum(inRes.data) - sum(outRes.data);
}
