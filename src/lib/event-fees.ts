// src/lib/event-fees.ts
// The fee engine — PURE, no IO. Given an event's enabled fee items and a
// registration's selections, compute the total + a breakdown snapshot. Money is
// computed in integer cents to avoid float drift, then returned as RM (2dp).
//
// Qty rules (per the six-item vocabulary):
//   registration  → 1 always (when the item is enabled on the event)
//   meal          → selections.meal_days ?? 0
//   accommodation → selections.nights ?? 0
//   transfer      → selections.transfer ? 1 : 0
//   uniform       → selections.uniform?.qty ?? 0
//   other         → selections.other_qty ?? 0
// Zero-qty items are omitted from the breakdown.

export type FeeItemKind = 'registration' | 'meal' | 'accommodation' | 'transfer' | 'uniform' | 'other';

export type FeeItem = {
  item: FeeItemKind;
  label_cn: string | null;
  amount: number;
  billing: 'per_person' | 'per_day' | 'per_night' | 'per_item';
};

export type Selections = {
  meal_days?: number;
  nights?: number;
  transfer?: boolean;
  uniform?: { size?: string; qty: number };
  other_qty?: number;
};

export type BreakdownLine = {
  item: string;
  label: string;
  amount: number;
  qty: number;
  subtotal: number;
};

// Default Chinese labels when a fee row has no label_cn override.
const DEFAULT_LABEL: Record<FeeItemKind, string> = {
  registration: '报名费',
  meal: '餐费',
  accommodation: '住宿',
  transfer: '交通',
  uniform: '制服',
  other: '其他',
};

function qtyFor(item: FeeItemKind, sel: Selections): number {
  switch (item) {
    case 'registration':
      return 1;
    case 'meal':
      return sel.meal_days ?? 0;
    case 'accommodation':
      return sel.nights ?? 0;
    case 'transfer':
      return sel.transfer ? 1 : 0;
    case 'uniform':
      return sel.uniform?.qty ?? 0;
    case 'other':
      return sel.other_qty ?? 0;
  }
}

export function computeFees(
  fees: FeeItem[],
  sel: Selections
): { total: number; breakdown: BreakdownLine[] } {
  let totalCents = 0;
  const breakdown: BreakdownLine[] = [];

  for (const fee of fees) {
    const qty = Math.max(0, Math.trunc(qtyFor(fee.item, sel)));
    if (qty <= 0) continue; // omit zero-qty items

    const amountCents = Math.round(fee.amount * 100);
    const subtotalCents = amountCents * qty;
    totalCents += subtotalCents;

    breakdown.push({
      item: fee.item,
      label: fee.label_cn || DEFAULT_LABEL[fee.item],
      amount: amountCents / 100,
      qty,
      subtotal: subtotalCents / 100,
    });
  }

  return { total: totalCents / 100, breakdown };
}
