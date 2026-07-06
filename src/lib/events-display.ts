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
// Event-status badge palette (mockup): 草稿 grey · 开放报名 filled gold · 已满额 soft red ·
// 已截止 amber · 已结束 soft green.
export const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-[#F1EADA] text-[#8B6F47] border border-[#E4D8BC]',
  open: 'bg-[#D89938] text-white',
  full: 'bg-[#FCEBEA] text-[#B4402E]',
  closed: 'bg-[#F5E1B0] text-[#8A5A1E]',
  completed: 'bg-[#E7F0E0] text-[#3F6B2E]',
};

export const REG_STATUS_LABELS: Record<string, string> = {
  pending: '待审核',
  approved: '已批准',
  rejected: '已拒绝',
  cancelled: '已取消',
};

// Registration-status badge palette (mockup): 待审核 gold-outline · 已批准 green · 已拒绝 red ·
// 已取消 grey.
export const REG_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-white border border-[#E3B85A] text-[#A87929]',
  approved: 'bg-[#E7F0E0] text-[#3F6B2E]',
  rejected: 'bg-[#FCEBEA] text-[#B4402E]',
  cancelled: 'bg-[#F1EADA] text-[#B89968]',
};

// The six FIXED fee rows, each with its canonical billing (mirrors the server
// BILLING_BY_ITEM pairing; 'other' defaults to per_person). meal defaults to per_item
// (每餐) for NEW events — legacy events keep whatever their stored fee row says (per_day).
export const FEE_ROWS: { item: string; label: string; billing: string }[] = [
  { item: 'registration', label: '报名费', billing: 'per_person' },
  { item: 'meal', label: '餐费', billing: 'per_item' },
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

// Meal billing options offered in the form (每餐 = per_item default; 每天 = legacy per_day).
export const MEAL_BILLING_OPTIONS: [string, string][] = [
  ['per_item', '每餐'],
  ['per_day', '每天'],
];

// Item-aware billing label: the meal row reads 每餐/每天, everything else uses BILLING_LABELS.
export function feeBillingLabel(item: string, billing: string): string {
  if (item === 'meal') return billing === 'per_item' ? '每餐' : '每天';
  return BILLING_LABELS[billing] ?? billing;
}

// The three meal columns, in serving order — shared by the grid + the kitchen stats card.
export const MEAL_COLS: { meal: string; label: string }[] = [
  { meal: 'breakfast', label: '早' },
  { meal: 'lunch', label: '午' },
  { meal: 'dinner', label: '晚' },
];

// 'YYYY-MM-DD' → '周一' … (zh-CN short weekday; UTC-anchored so the day never shifts).
export function weekdayCn(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('zh-CN', { weekday: 'short', timeZone: 'UTC' });
}

export const FEE_LABEL: Record<string, string> = Object.fromEntries(FEE_ROWS.map((r) => [r.item, r.label]));

export function moneyRM(n: number): string {
  return `RM ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
}

// Payment tracking (C3) — a GENTLE, non-coercive lifecycle. 已豁免 is guilt-free; 未付款 is
// neutral (never red/overdue). unpaid → neutral grey · proof_submitted → gold-outline ·
// verified → green · waived → soft lavender.
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: '未付款',
  proof_submitted: '已提交凭证',
  verified: '已核实',
  waived: '已豁免',
};
export const PAYMENT_STATUS_STYLES: Record<string, string> = {
  unpaid: 'bg-[#F1EADA] text-[#8B6F47]',
  proof_submitted: 'bg-white border border-[#E3B85A] text-[#A87929]',
  verified: 'bg-[#E7F0E0] text-[#3F6B2E]',
  waived: 'bg-[#EFEAF6] text-[#6B5B8A]',
};
