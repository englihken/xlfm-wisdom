// src/lib/finance-display.ts
// Client-safe display constants for the 财务 UI (channel + category + pledge-period labels).
// No server imports — mirrors inventory-display / events-display.
// Locale-aware: pass a translator (client useT / server createT) to localize; omit
// for the zh fallback. zh output stays byte-identical to the previous hard-coded labels.

import type { TFunc } from './i18n';

export const CHANNEL_LABELS: Record<string, string> = {
  cash: '现金',
  bank_transfer: '银行转账',
  to_hq: '汇至总会',
};
const CHANNEL_KEY: Record<string, string> = {
  cash: 'finvocab.channel.cash',
  bank_transfer: 'finvocab.channel.bank_transfer',
  to_hq: 'finvocab.channel.to_hq',
};
export function channelLabel(v: string, t?: TFunc): string {
  const k = CHANNEL_KEY[v];
  return t && k ? t(k) : (CHANNEL_LABELS[v] ?? v);
}

export const CHANNEL_OPTIONS: [string, string][] = [
  ['cash', '现金（中心）'],
  ['bank_transfer', '银行转账'],
  ['to_hq', '汇至总会'],
];
export function channelOptions(t?: TFunc): [string, string][] {
  return [
    ['cash', t ? t('finvocab.channelOpt.cash') : '现金（中心）'],
    ['bank_transfer', t ? t('finvocab.channelOpt.bank_transfer') : '银行转账'],
    ['to_hq', t ? t('finvocab.channelOpt.to_hq') : '汇至总会'],
  ];
}

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  rent: '租金',
  utilities: '水电',
  maintenance: '维护',
  activity: '活动',
  misc: '杂项',
};
const EXPENSE_CATEGORY_KEY: Record<string, string> = {
  rent: 'finvocab.expcat.rent',
  utilities: 'finvocab.expcat.utilities',
  maintenance: 'finvocab.expcat.maintenance',
  activity: 'finvocab.expcat.activity',
  misc: 'finvocab.expcat.misc',
};
export function expenseCategoryLabel(v: string, t?: TFunc): string {
  const k = EXPENSE_CATEGORY_KEY[v];
  return t && k ? t(k) : (EXPENSE_CATEGORY_LABELS[v] ?? v);
}

export const EXPENSE_CATEGORY_OPTIONS: [string, string][] = [
  ['rent', '租金'],
  ['utilities', '水电'],
  ['maintenance', '维护'],
  ['activity', '活动'],
  ['misc', '杂项'],
];
export function expenseCategoryOptions(t?: TFunc): [string, string][] {
  return EXPENSE_CATEGORY_OPTIONS.map(([v]) => [v, expenseCategoryLabel(v, t)]);
}

// 杂项 reads muted; the rest gold (mirrors the mockup's pill treatment).
export function expenseCategoryPill(cat: string): string {
  return cat === 'misc' ? 'pill-muted' : 'pill-gold';
}

// A member's 认捐 pill text: RM50/月 · RM600/年 · 已豁免 · 未认捐. Only the words and
// the /月·/年 period suffix localize; the RM amount stays as data.
export function pledgeLabel(
  p: { fee_pledge_amount: number | null; fee_pledge_period: string | null; fee_waived_from: string | null },
  t?: TFunc
): { text: string; tone: 'gold' | 'lav' | 'muted' } {
  if (p.fee_waived_from) return { text: t ? t('finvocab.pledge.waived') : '已豁免', tone: 'lav' };
  if (p.fee_pledge_amount && p.fee_pledge_period) {
    const period =
      p.fee_pledge_period === 'year'
        ? (t ? t('finvocab.pledge.perYear') : '/年')
        : (t ? t('finvocab.pledge.perMonth') : '/月');
    return { text: `RM${Number(p.fee_pledge_amount).toLocaleString()}${period}`, tone: 'gold' };
  }
  return { text: t ? t('finvocab.pledge.none') : '未认捐', tone: 'muted' };
}

export function moneyRM(n: number): string {
  return `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
