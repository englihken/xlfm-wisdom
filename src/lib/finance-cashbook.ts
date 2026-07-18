// src/lib/finance-cashbook.ts
// Server-side helpers for 财务 v2 (Phase 1) — the volunteer cash book built on
// migration 039's finance_accounts / finance_categories / finance_transactions.
//   • balance math — opening_balance + Σ(in) − Σ(out) ± transfers, voided EXCLUDED.
//     All sums run in integer CENTS: numeric(12,2) round-trips through JS floats,
//     and 0.1 + 0.2 drift is not acceptable in a ledger a treasurer reconciles.
//   • validation vocabulary shared by the accounts/txns routes, kept in lockstep
//     with the DB CHECKs (finance_accounts_kind_check, finance_transactions_
//     direction_check, fin_txn_category_rule) so a bad payload 400s before it ever
//     reaches Postgres and returns a friendly message instead of a constraint error.
// The centre-scope wall itself stays in finance.ts (financeScope / enforceScope) —
// this module is scope-agnostic and must never be used as a substitute for it.

export const ACCOUNT_KINDS = ['bank', 'cash'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const TXN_DIRECTIONS = ['in', 'out', 'transfer'] as const;
export type TxnDirection = (typeof TXN_DIRECTIONS)[number];

// Category groups in display order, per kind. Mirrors the 25 seeded rows'
// `grp` column; a group appearing in the DB but not here still renders (it falls
// through to the tail), so a future seed cannot silently hide categories.
export const INCOME_GROUPS = ['fees', 'donation', 'event', 'other_income'] as const;
export const EXPENSE_GROUPS = ['premises', 'altar', 'admin', 'activity', 'other_expense'] as const;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_RE = /^\d{4}-\d{2}$/;
// Any id that gets interpolated into a PostgREST .or() filter STRING must be
// shape-checked first: unlike .eq(), the .or() grammar is not value-encoded, so a
// raw query param there could inject extra filters and widen the result set.
export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// Same bucket + prefix as the D4 expenses receipt (finance-receipts / receipts/<hex>.<ext>),
// so v2 reuses /api/dashboard/finance/upload and /media-url unchanged.
export const RECEIPT_PATH_RE = /^receipts\/[A-Za-z0-9._-]+$/;

export function isAccountKind(v: unknown): v is AccountKind {
  return typeof v === 'string' && (ACCOUNT_KINDS as readonly string[]).includes(v);
}
export function isTxnDirection(v: unknown): v is TxnDirection {
  return typeof v === 'string' && (TXN_DIRECTIONS as readonly string[]).includes(v);
}

// '2026-07' → ['2026-07-01', '2026-08-01') — the half-open window the ledger
// filters on. Returns null for a malformed month so the caller can 400.
export function monthWindow(month: unknown): { from: string; to: string } | null {
  if (typeof month !== 'string' || !MONTH_RE.test(month)) return null;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (m < 1 || m > 12) return null;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { from: `${month}-01`, to: `${ny}-${String(nm).padStart(2, '0')}-01` };
}

// Today in Malaysia time as 'YYYY-MM-DD'. The centres are all UTC+8, so a naive
// UTC date would flip a late-evening entry onto the previous day.
export function todayMYT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}
export function thisMonthMYT(): string {
  return todayMYT().slice(0, 7);
}

// ── balance math ───────────────────────────────────────────────────────────────
// Money moves in cents so the running sum is exact; only the final divide by 100
// re-enters float land, where a 2-dp value is representable.
const toCents = (n: unknown): number => Math.round(Number(n ?? 0) * 100);

export type BalanceAccount = { id: string; opening_balance: number | string };
export type BalanceTxn = {
  direction: string;
  amount: number | string;
  account_id: string;
  counterparty_account_id: string | null;
  voided_at: string | null;
};

// Current balance per account id. Callers MUST pass every non-voided transaction
// touching these accounts (as account_id OR counterparty_account_id) — a filtered
// slice silently understates the balance. Voided rows are dropped here too, so
// passing them through is harmless (defensive: the ledger route returns them).
export function computeBalances(accounts: BalanceAccount[], txns: BalanceTxn[]): Map<string, number> {
  const cents = new Map<string, number>();
  for (const a of accounts) cents.set(a.id, toCents(a.opening_balance));

  for (const t of txns) {
    if (t.voided_at) continue; // voided never moves money
    const amt = toCents(t.amount);
    if (t.direction === 'in') {
      if (cents.has(t.account_id)) cents.set(t.account_id, cents.get(t.account_id)! + amt);
    } else if (t.direction === 'out') {
      if (cents.has(t.account_id)) cents.set(t.account_id, cents.get(t.account_id)! - amt);
    } else if (t.direction === 'transfer') {
      // account_id = source (money leaves), counterparty_account_id = destination.
      if (cents.has(t.account_id)) cents.set(t.account_id, cents.get(t.account_id)! - amt);
      const dst = t.counterparty_account_id;
      if (dst && cents.has(dst)) cents.set(dst, cents.get(dst)! + amt);
    }
  }

  const out = new Map<string, number>();
  for (const [id, c] of cents) out.set(id, c / 100);
  return out;
}

// Centre total = Σ account balances. Summed in cents for the same reason; an
// own-centre transfer nets to zero here, which is the point.
export function sumBalances(balances: Iterable<number>): number {
  let c = 0;
  for (const b of balances) c += Math.round(b * 100);
  return c / 100;
}
