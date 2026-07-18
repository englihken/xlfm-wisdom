// src/app/api/dashboard/finance/dashboard/route.ts
// GET ?month=&centre_id= (finance:view, SCOPE-FORCED) — everything the 财务 仪表板
// renders, in ONE round trip:
//   • kpis     — income / expense / net for the month + current total balance
//   • trend    — last 6 months of income vs expense
//   • expenseByGroup — the month's 支出 split across the 5 expense groups
//   • accounts — per-wallet balances (centre view)
//   • perCentre— income/expense/net/balance per centre (HQ consolidated view)
// Reads finance_transactions ONLY. fee_payments is deliberately NOT unioned: the
// 月费 income category already captures fee income in the cash book, so a union
// would double-count it.
// Scope: financeScope/enforceScope, same wall as the rest of 财务. An all_centers
// caller with no centre_id gets the consolidated org view; passing centre_id drills
// into one. An own_center 财政 is forced to theirs and perCentre comes back null.
// opening_as_of: every figure here — balances AND month/trend totals — counts a
// transaction only when it is on/after its account's opening_as_of (txnCounts).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { financeScope, enforceScope } from '@/lib/finance';
import { computeBalances, sumBalances, txnCounts, monthWindow, thisMonthMYT, MONTH_RE } from '@/lib/finance-cashbook';
import { EXPENSE_GROUPS } from '@/lib/finance-cashbook';

export const runtime = 'nodejs';

const TREND_MONTHS = 6;

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

function monthAdd(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

type AcctRow = {
  id: string; centre_id: string; kind: string; name: string;
  opening_balance: number | string; opening_as_of: string | null; is_active: boolean; sort: number;
};
type TxnRow = {
  centre_id: string; txn_date: string; direction: string; amount: number | string;
  account_id: string; counterparty_account_id: string | null; voided_at: string | null;
  category: { grp: string } | { grp: string }[] | null;
};

const grpOf = (c: TxnRow['category']): string | null => {
  const one = Array.isArray(c) ? (c[0] ?? null) : c;
  return one?.grp ?? null;
};

export async function GET(req: Request) {
  const access = await requireModuleAccess('finance', 'view');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const scope = financeScope(access.volunteer);
  const enforced = enforceScope(scope, sp.get('centre_id'));
  if (!enforced.ok) return NextResponse.json({ error: enforced.error }, { status: 400 });
  const centreId = enforced.centreId; // null = consolidated (unlocked callers only)

  const monthParam = sp.get('month');
  if (monthParam && !MONTH_RE.test(monthParam)) return NextResponse.json({ error: '月份无效' }, { status: 400 });
  const month = monthParam ?? thisMonthMYT();
  const win = monthWindow(month);
  if (!win) return NextResponse.json({ error: '月份无效' }, { status: 400 });
  const trendMonths = Array.from({ length: TREND_MONTHS }, (_, i) => monthAdd(month, i - (TREND_MONTHS - 1)));
  const trendStart = `${trendMonths[0]}-01`;

  // The centres this caller may see. A locked caller gets exactly one.
  let centreQ = supabaseAdmin.from('centres').select('id, code, name_cn').eq('is_active', true);
  if (scope.locked) {
    if (!scope.centreId) return NextResponse.json({ error: '账号未绑定中心，无法访问财务数据' }, { status: 400 });
    centreQ = centreQ.eq('id', scope.centreId);
  }

  // Accounts + transactions, both narrowed to the effective centre when one is set.
  let acctQ = supabaseAdmin
    .from('finance_accounts')
    .select('id, centre_id, kind, name, opening_balance, opening_as_of, is_active, sort');
  if (centreId) acctQ = acctQ.eq('centre_id', centreId);
  else if (scope.locked) acctQ = acctQ.eq('centre_id', scope.centreId!);

  // Balances are CUMULATIVE, so this cannot be a month slice — it reads the full
  // non-voided history for the in-scope centres. Fine at current volume; if the
  // ledger grows large this is the query to replace with a SQL aggregate.
  let txnQ = supabaseAdmin
    .from('finance_transactions')
    .select('centre_id, txn_date, direction, amount, account_id, counterparty_account_id, voided_at, category:finance_categories!category_id ( grp )')
    .is('voided_at', null);
  if (centreId) txnQ = txnQ.eq('centre_id', centreId);
  else if (scope.locked) txnQ = txnQ.eq('centre_id', scope.centreId!);

  const [{ data: centres, error: cErr }, { data: accountsRaw, error: aErr }, { data: txnsRaw, error: tErr }] =
    await Promise.all([centreQ.order('name_cn', { ascending: true }), acctQ.order('sort', { ascending: true }), txnQ]);

  if (cErr || aErr || tErr) {
    console.error('[finance/dashboard] load failed:', cErr ?? aErr ?? tErr);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }

  const accounts = (accountsRaw ?? []) as AcctRow[];
  const txns = (txnsRaw ?? []) as unknown as TxnRow[];
  const acctById = new Map(accounts.map((a) => [a.id, a]));

  // Balances: all-time, opening_as_of honoured inside computeBalances.
  const balances = computeBalances(accounts, txns);

  // ── month + trend aggregation. Same cutoff as the balance math (txnCounts), so
  // a row can never appear in a total while being invisible to the balance.
  const cents = (v: number | string) => Math.round(Number(v) * 100);
  const monthByCentre = new Map<string, { inC: number; outC: number }>();
  const trendIn = new Map<string, number>();
  const trendOut = new Map<string, number>();
  const groupCents = new Map<string, number>();

  for (const t of txns) {
    if (t.direction === 'transfer') continue; // moves money, is not income or expense
    if (!txnCounts(acctById.get(t.account_id), t.txn_date)) continue;
    const ym = t.txn_date.slice(0, 7);
    const c = cents(t.amount);

    if (t.txn_date >= trendStart && t.txn_date < win.to) {
      const m = t.direction === 'in' ? trendIn : trendOut;
      m.set(ym, (m.get(ym) ?? 0) + c);
    }
    if (t.txn_date >= win.from && t.txn_date < win.to) {
      const row = monthByCentre.get(t.centre_id) ?? { inC: 0, outC: 0 };
      if (t.direction === 'in') row.inC += c;
      else row.outC += c;
      monthByCentre.set(t.centre_id, row);
    }
    if (t.direction === 'out' && t.txn_date >= win.from && t.txn_date < win.to) {
      const g = grpOf(t.category);
      if (g) groupCents.set(g, (groupCents.get(g) ?? 0) + c);
    }
  }

  const monthIn = [...monthByCentre.values()].reduce((s, r) => s + r.inC, 0) / 100;
  const monthOut = [...monthByCentre.values()].reduce((s, r) => s + r.outC, 0) / 100;
  const totalBalance = sumBalances(accounts.filter((a) => a.is_active).map((a) => balances.get(a.id) ?? 0));

  // Expense groups in canonical order; a group with no spend still reports 0 so
  // the legend stays stable month to month instead of reshuffling.
  const expenseByGroup = (EXPENSE_GROUPS as readonly string[]).map((grp) => ({
    grp,
    value: (groupCents.get(grp) ?? 0) / 100,
  }));

  // Per-centre compare table — consolidated view only (null when drilled in or locked).
  const perCentre =
    centreId || scope.locked
      ? null
      : (centres ?? []).map((c) => {
          const m = monthByCentre.get(c.id) ?? { inC: 0, outC: 0 };
          const bal = sumBalances(
            accounts.filter((a) => a.centre_id === c.id && a.is_active).map((a) => balances.get(a.id) ?? 0)
          );
          return {
            id: c.id,
            name: c.name_cn,
            income: m.inC / 100,
            expense: m.outC / 100,
            net: (m.inC - m.outC) / 100,
            balance: bal,
          };
        });

  return NextResponse.json({
    month,
    scope,
    centreId,
    centres: centres ?? [],
    kpis: { income: monthIn, expense: monthOut, net: Math.round((monthIn - monthOut) * 100) / 100, balance: totalBalance },
    trend: {
      months: trendMonths,
      income: trendMonths.map((m) => (trendIn.get(m) ?? 0) / 100),
      expense: trendMonths.map((m) => (trendOut.get(m) ?? 0) / 100),
    },
    expenseByGroup,
    accounts: accounts.map((a) => ({
      id: a.id,
      centre_id: a.centre_id,
      kind: a.kind,
      name: a.name,
      is_active: a.is_active,
      balance: balances.get(a.id) ?? Number(a.opening_balance),
    })),
    perCentre,
  });
}
