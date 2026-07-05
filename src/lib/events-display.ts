// src/lib/events-display.ts
// Client-safe display constants for the 活动 module UI (labels, badge styles, the
// six fixed fee rows with their canonical billing). No server imports.

export const EVENT_TYPE_LABELS: Record<string, string> = {
  fahui: '法会',
  gongxiu: '共修',
  foxueban: '佛学班',
  fangsheng: '放生',
  xingquban: '兴趣班',
  other: '其他',
};
export const EVENT_TYPE_OPTIONS: [string, string][] = [
  ['fahui', '法会'],
  ['gongxiu', '共修'],
  ['foxueban', '佛学班'],
  ['fangsheng', '放生'],
  ['xingquban', '兴趣班'],
  ['other', '其他'],
];

export const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  open: '开放报名',
  full: '已满额',
  closed: '已截止',
  completed: '已结束',
};
export const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-white border border-[#EFE3BF] text-[#8B6F47]',
  open: 'bg-[#FAEFD0] text-[#A87929]',
  full: 'bg-[#FEF2F2] text-red-700',
  closed: 'bg-[#F5E1B0] text-[#8A5A1E]',
  completed: 'bg-[#E7F0E0] text-[#3F6B2E]',
};

export const REG_STATUS_LABELS: Record<string, string> = {
  pending: '待审核',
  approved: '已批准',
  rejected: '已拒绝',
  cancelled: '已取消',
};

// The six FIXED fee rows, each with its canonical billing (mirrors the server
// BILLING_BY_ITEM pairing; 'other' defaults to per_person).
export const FEE_ROWS: { item: string; label: string; billing: string }[] = [
  { item: 'registration', label: '报名费', billing: 'per_person' },
  { item: 'meal', label: '餐费', billing: 'per_day' },
  { item: 'accommodation', label: '住宿', billing: 'per_night' },
  { item: 'transfer', label: '机场接送', billing: 'per_person' },
  { item: 'uniform', label: '制服', billing: 'per_item' },
  { item: 'other', label: '结缘品·其他', billing: 'per_person' },
];

export const BILLING_LABELS: Record<string, string> = {
  per_person: '每人一次',
  per_day: '每人每天',
  per_night: '每人每晚',
  per_item: '每件',
};

export const FEE_LABEL: Record<string, string> = Object.fromEntries(FEE_ROWS.map((r) => [r.item, r.label]));

export function moneyRM(n: number): string {
  return `RM ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
}
