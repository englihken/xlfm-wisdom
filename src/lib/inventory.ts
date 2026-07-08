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

// Shared select shape for request rows (list + fulfil + status routes). Lives here
// because route files may only export route handlers.
export const REQUEST_SELECT =
  'id, qty_requested, qty_fulfilled, status, note, requested_at, created_at, updated_at, ' +
  'centre:centres!centre_id ( id, code, name_cn ), ' +
  'item:inventory_items!item_id ( id, stock_id, name_cn, pack_qty ), ' +
  'event:events!event_id ( id, code, title )';

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
