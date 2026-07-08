// src/lib/inventory-display.ts
// Client-safe display constants for the 库存 module UI (movement-type labels + badge
// styles, request-status labels). No server imports — mirrors events-display.ts.

// Ledger movement types (mirrors the CHECK constraint in migrations/022). 'opening'
// exists only as seeded history — the UI never creates one, but must label it.
export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  opening: '期初结存',
  stock_in: '入库',
  transfer: '调拨',
  distribution: '结缘发放',
  return: '退回',
  adjust_in: '盘点调增',
  adjust_out: '盘点调减',
};

// Creatable types, in form display order ('opening' deliberately excluded).
export const MOVEMENT_TYPE_OPTIONS: [string, string][] = [
  ['stock_in', '入库（到货）'],
  ['transfer', '调拨（仓 → 仓）'],
  ['distribution', '结缘发放（出库）'],
  ['return', '退回（仓 → 仓）'],
  ['adjust_in', '盘点调增'],
  ['adjust_out', '盘点调减'],
];

// Movement badge palette, reusing the house semantic tones: inflow green · transfer
// gold-outline · outflow amber · return lavender · adjustments soft · opening muted.
export const MOVEMENT_TYPE_STYLES: Record<string, string> = {
  opening: 'bg-surface-soft text-ink-faint border border-border',
  stock_in: 'bg-[#E7F0E0] text-[#3F6B2E]',
  transfer: 'bg-white border border-gold-border text-accent-deep',
  distribution: 'bg-[#F5E1B0] text-[#8A5A1E]',
  return: 'bg-[#EFEAF6] text-[#6B5B8A]',
  adjust_in: 'bg-[#E7F0E0] text-[#3F6B2E]',
  adjust_out: 'bg-[#FCEBEA] text-[#B4402E]',
};

// Which sides a movement needs — drives the form's conditional 从仓/到仓 fields and
// mirrors the DB direction CHECK exactly.
export const MOVEMENT_DIRECTION: Record<string, { from: boolean; to: boolean }> = {
  opening: { from: false, to: true },
  stock_in: { from: false, to: true },
  transfer: { from: true, to: true },
  distribution: { from: true, to: false },
  return: { from: true, to: true },
  adjust_in: { from: false, to: true },
  adjust_out: { from: true, to: false },
};

// 分会 request lifecycle: 待处理 gold-outline · 部分拨付 amber · 已拨付 green ·
// 已取消 muted (same neutral treatment as elsewhere — never accusatory red).
export const REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  partial: '部分拨付',
  fulfilled: '已拨付',
  cancelled: '已取消',
};
export const REQUEST_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-white border border-gold-border text-accent-deep',
  partial: 'bg-[#F5E1B0] text-[#8A5A1E]',
  fulfilled: 'bg-[#E7F0E0] text-[#3F6B2E]',
  cancelled: 'bg-surface-soft text-ink-faint border border-border',
};

// Item label helper: "S001B0101 一命二运三风水" / "（未编号）念佛机".
export function itemLabel(i: { stock_id: string | null; name_cn: string }): string {
  return i.stock_id ? `${i.stock_id} ${i.name_cn}` : `（未编号）${i.name_cn}`;
}
