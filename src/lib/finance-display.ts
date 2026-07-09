// src/lib/finance-display.ts
// Client-safe display constants for the 财务 UI (channel + category + pledge-period labels).
// No server imports — mirrors inventory-display / events-display.

export const CHANNEL_LABELS: Record<string, string> = {
  cash: '现金',
  bank_transfer: '银行转账',
  to_hq: '汇至总会',
};
export const CHANNEL_OPTIONS: [string, string][] = [
  ['cash', '现金（中心）'],
  ['bank_transfer', '银行转账'],
  ['to_hq', '汇至总会'],
];

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  rent: '租金',
  utilities: '水电',
  maintenance: '维护',
  activity: '活动',
  misc: '杂项',
};
export const EXPENSE_CATEGORY_OPTIONS: [string, string][] = [
  ['rent', '租金'],
  ['utilities', '水电'],
  ['maintenance', '维护'],
  ['activity', '活动'],
  ['misc', '杂项'],
];
// 杂项 reads muted; the rest gold (mirrors the mockup's pill treatment).
export function expenseCategoryPill(cat: string): string {
  return cat === 'misc' ? 'pill-muted' : 'pill-gold';
}

// A member's 认捐 pill text: RM50/月 · RM600/年 · 已豁免 · 未认捐.
export function pledgeLabel(p: { fee_pledge_amount: number | null; fee_pledge_period: string | null; fee_waived_from: string | null }): { text: string; tone: 'gold' | 'lav' | 'muted' } {
  if (p.fee_waived_from) return { text: '已豁免', tone: 'lav' };
  if (p.fee_pledge_amount && p.fee_pledge_period) {
    return { text: `RM${Number(p.fee_pledge_amount).toLocaleString()}/${p.fee_pledge_period === 'year' ? '年' : '月'}`, tone: 'gold' };
  }
  return { text: '未认捐', tone: 'muted' };
}

export function moneyRM(n: number): string {
  return `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
