// src/lib/cashbook-display.ts
// Client-safe display helpers for the 财务 v2 cash book. No server imports —
// mirrors finance-display / inventory-display.
// Category names are DATA, not dictionary keys: finance_categories carries
// name_cn/name_en/name_id, so the label is picked by locale off the row (falling
// back to name_cn, which is NOT NULL). Everything else — group headers, direction
// words, account kinds — is chrome and goes through t().

import type { TFunc, Locale } from './i18n';
import { INCOME_GROUPS, EXPENSE_GROUPS } from './finance-cashbook';

export type CategoryRow = {
  id: string;
  kind: string;
  grp: string;
  name_cn: string;
  name_en: string | null;
  name_id: string | null;
};

// The locale's name for a category row. name_en/name_id are nullable in the
// schema, so an un-translated category degrades to 中文 rather than blank.
export function categoryName(c: CategoryRow, locale: Locale): string {
  if (locale === 'en') return c.name_en || c.name_cn;
  if (locale === 'id') return c.name_id || c.name_cn;
  return c.name_cn;
}

// Friendly <optgroup> header for a category group.
export function groupLabel(grp: string, t: TFunc): string {
  return t(`cash.grp.${grp}`);
}

// Categories for one direction, bucketed into display-ordered groups. Any group
// the DB grows that isn't in the canonical order list is appended (never dropped),
// so a new seed row still reaches the dropdown.
export function groupedCategories(
  cats: CategoryRow[],
  kind: 'income' | 'expense'
): { grp: string; items: CategoryRow[] }[] {
  const mine = cats.filter((c) => c.kind === kind);
  const order = kind === 'income' ? (INCOME_GROUPS as readonly string[]) : (EXPENSE_GROUPS as readonly string[]);
  const seen = [...new Set(mine.map((c) => c.grp))];
  const ordered = [...order.filter((g) => seen.includes(g)), ...seen.filter((g) => !order.includes(g))];
  return ordered.map((grp) => ({ grp, items: mine.filter((c) => c.grp === grp) }));
}

// 收入 is the income direction; a 支出 form must only offer expense categories.
export function kindForDirection(direction: string): 'income' | 'expense' {
  return direction === 'in' ? 'income' : 'expense';
}

export function accountKindLabel(kind: string, t: TFunc): string {
  return kind === 'bank' ? t('cash.kind.bank') : t('cash.kind.cash');
}

export function directionLabel(direction: string, t: TFunc): string {
  if (direction === 'in') return t('cash.dir.in');
  if (direction === 'out') return t('cash.dir.out');
  return t('cash.dir.transfer');
}

// Signed money for the ledger's amount column: in green +, out red −, transfer
// neutral (it never changes the centre total, only which wallet holds it).
export function amountTone(direction: string): string {
  if (direction === 'in') return 'text-[#3F6B2E]';
  if (direction === 'out') return 'text-[#B4402E]';
  return 'text-ink-muted';
}
export function amountSign(direction: string): string {
  if (direction === 'in') return '+';
  if (direction === 'out') return '−';
  return '';
}

// A balance can legitimately go negative (a cash float spent ahead of a
// reimbursement); show it red rather than hiding the sign.
export function balanceTone(n: number): string {
  return n < 0 ? 'text-[#B4402E]' : 'text-ink';
}
