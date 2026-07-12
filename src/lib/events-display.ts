// src/lib/events-display.ts
// Client-safe display constants for the 活动 module UI (labels, badge styles, the
// six fixed fee rows with their canonical billing). No server imports.
// Locale-aware: pass a translator (client useT / server createT) to localize; omit
// for the zh fallback. zh output stays byte-identical to the previous hard-coded
// labels. Styles / amounts / dates carry no locale and are untouched.

import type { TFunc } from './i18n';

export const EVENT_TYPE_LABELS: Record<string, string> = {
  fahui: '法会',
  gongxiu: '共修',
  foxueban: '佛学班',
  fangsheng: '放生',
  xingquban: '兴趣班',
  other: '其他',
};
const EVENT_TYPE_KEY: Record<string, string> = {
  fahui: 'evtvocab.type.fahui',
  gongxiu: 'evtvocab.type.gongxiu',
  foxueban: 'evtvocab.type.foxueban',
  fangsheng: 'evtvocab.type.fangsheng',
  xingquban: 'evtvocab.type.xingquban',
  other: 'evtvocab.type.other',
};
export function eventTypeLabel(v: string, t?: TFunc): string {
  const k = EVENT_TYPE_KEY[v];
  return t && k ? t(k) : (EVENT_TYPE_LABELS[v] ?? v);
}

export const EVENT_TYPE_OPTIONS: [string, string][] = [
  ['fahui', '法会'],
  ['gongxiu', '共修'],
  ['foxueban', '佛学班'],
  ['fangsheng', '放生'],
  ['xingquban', '兴趣班'],
  ['other', '其他'],
];
export function eventTypeOptions(t?: TFunc): [string, string][] {
  return EVENT_TYPE_OPTIONS.map(([v]) => [v, eventTypeLabel(v, t)]);
}

export const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  open: '开放报名',
  full: '已满额',
  closed: '已截止',
  completed: '已结束',
};
const STATUS_KEY: Record<string, string> = {
  draft: 'evtvocab.status.draft',
  open: 'evtvocab.status.open',
  full: 'evtvocab.status.full',
  closed: 'evtvocab.status.closed',
  completed: 'evtvocab.status.completed',
};
export function eventStatusLabel(v: string, t?: TFunc): string {
  const k = STATUS_KEY[v];
  return t && k ? t(k) : (STATUS_LABELS[v] ?? v);
}
// Event-status badge palette: 草稿 muted · 开放报名 filled gold (accent) · 已满额 soft red ·
// 已截止 amber · 已结束 soft green. (The soft red / amber / green stay as-is — semantic.)
export const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-surface-soft text-ink-faint border border-border',
  open: 'bg-accent text-white',
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
const REG_STATUS_KEY: Record<string, string> = {
  pending: 'evtvocab.reg.pending',
  approved: 'evtvocab.reg.approved',
  rejected: 'evtvocab.reg.rejected',
  cancelled: 'evtvocab.reg.cancelled',
};
export function regStatusLabel(v: string, t?: TFunc): string {
  const k = REG_STATUS_KEY[v];
  return t && k ? t(k) : (REG_STATUS_LABELS[v] ?? v);
}

// Registration-status badge palette: 待审核 gold-outline · 已批准 green · 已拒绝 red ·
// 已取消 muted. (Green / red stay as-is — semantic.)
export const REG_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-white border border-gold-border text-accent-deep',
  approved: 'bg-[#E7F0E0] text-[#3F6B2E]',
  rejected: 'bg-[#FCEBEA] text-[#B4402E]',
  cancelled: 'bg-surface-soft text-ink-faint border border-border',
};

// The six FIXED fee rows, each with its canonical billing (mirrors the server
// BILLING_BY_ITEM pairing; 'other' defaults to per_person). meal defaults to per_item
// (每餐) for NEW events — legacy events keep whatever their stored fee row says (per_day).
// `label` is the zh fallback (used when no translator is supplied); feeLabel() routes
// through i18n (evtvocab.fee.*) when a t() is passed.
export const FEE_ROWS: { item: string; label: string; billing: string }[] = [
  { item: 'registration', label: '报名费', billing: 'per_person' },
  { item: 'meal', label: '餐费', billing: 'per_item' },
  { item: 'accommodation', label: '住宿', billing: 'per_night' },
  { item: 'transfer', label: '机场接送', billing: 'per_person' },
  { item: 'uniform', label: '制服', billing: 'per_item' },
  { item: 'other', label: '结缘品·其他', billing: 'per_person' },
];
const FEE_KEY: Record<string, string> = {
  registration: 'evtvocab.fee.registration',
  meal: 'evtvocab.fee.meal',
  accommodation: 'evtvocab.fee.accommodation',
  transfer: 'evtvocab.fee.transfer',
  uniform: 'evtvocab.fee.uniform',
  other: 'evtvocab.fee.other',
};

export const BILLING_LABELS: Record<string, string> = {
  per_person: '每人一次',
  per_day: '每人每天',
  per_night: '每人每晚',
  per_item: '每件',
};
const BILLING_KEY: Record<string, string> = {
  per_person: 'evtvocab.billing.per_person',
  per_day: 'evtvocab.billing.per_day',
  per_night: 'evtvocab.billing.per_night',
  per_item: 'evtvocab.billing.per_item',
};
export function billingLabel(v: string, t?: TFunc): string {
  const k = BILLING_KEY[v];
  return t && k ? t(k) : (BILLING_LABELS[v] ?? v);
}

// Meal billing options offered in the form (每餐 = per_item default; 每天 = legacy per_day).
export const MEAL_BILLING_OPTIONS: [string, string][] = [
  ['per_item', '每餐'],
  ['per_day', '每天'],
];
export function mealBillingOptions(t?: TFunc): [string, string][] {
  return [
    ['per_item', t ? t('evtvocab.mealBilling.per_item') : '每餐'],
    ['per_day', t ? t('evtvocab.mealBilling.per_day') : '每天'],
  ];
}

// Item-aware billing label: the meal row reads 每餐/每天, everything else uses BILLING_LABELS.
export function feeBillingLabel(item: string, billing: string, t?: TFunc): string {
  if (item === 'meal') {
    return billing === 'per_item'
      ? (t ? t('evtvocab.mealBilling.per_item') : '每餐')
      : (t ? t('evtvocab.mealBilling.per_day') : '每天');
  }
  return billingLabel(billing, t);
}

// The three meal columns, in serving order — shared by the grid + the kitchen stats card.
// `label` is the zh fallback; mealColLabel() routes through i18n (evtvocab.meal.*) with a t().
export const MEAL_COLS: { meal: string; label: string }[] = [
  { meal: 'breakfast', label: '早' },
  { meal: 'lunch', label: '午' },
  { meal: 'dinner', label: '晚' },
];
const MEAL_COL_KEY: Record<string, string> = {
  breakfast: 'evtvocab.meal.breakfast',
  lunch: 'evtvocab.meal.lunch',
  dinner: 'evtvocab.meal.dinner',
};
export function mealColLabel(meal: string, t?: TFunc): string {
  const k = MEAL_COL_KEY[meal];
  const fallback = MEAL_COLS.find((c) => c.meal === meal)?.label ?? meal;
  return t && k ? t(k) : fallback;
}

// 'YYYY-MM-DD' → '周一' … (zh-CN short weekday; UTC-anchored so the day never shifts).
export function weekdayCn(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('zh-CN', { weekday: 'short', timeZone: 'UTC' });
}

export const FEE_LABEL: Record<string, string> = Object.fromEntries(FEE_ROWS.map((r) => [r.item, r.label]));
export function feeLabel(item: string, t?: TFunc): string {
  const k = FEE_KEY[item];
  return t && k ? t(k) : (FEE_LABEL[item] ?? item);
}

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
const PAYMENT_STATUS_KEY: Record<string, string> = {
  unpaid: 'evtvocab.pay.unpaid',
  proof_submitted: 'evtvocab.pay.proof_submitted',
  verified: 'evtvocab.pay.verified',
  waived: 'evtvocab.pay.waived',
};
export function paymentStatusLabel(v: string, t?: TFunc): string {
  const k = PAYMENT_STATUS_KEY[v];
  return t && k ? t(k) : (PAYMENT_STATUS_LABELS[v] ?? v);
}
export const PAYMENT_STATUS_STYLES: Record<string, string> = {
  unpaid: 'bg-surface-soft text-ink-faint',
  proof_submitted: 'bg-white border border-gold-border text-accent-deep',
  verified: 'bg-[#E7F0E0] text-[#3F6B2E]',
  waived: 'bg-[#EFEAF6] text-[#6B5B8A]',
};
