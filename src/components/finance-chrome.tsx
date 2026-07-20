// src/components/finance-chrome.tsx
// Shared tab row for the 财务 pages: 总览 · 月费台账 · 支出记录. (The 盈余互助 tab was
// retired — owner decision 2026-07-11: centre finances are separate; HQ supports
// directly.) No server imports; mirrors inventory-chrome's InventoryTabs. Labels via t().

'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n-react';

export type FinanceTabKey = 'dashboard' | 'accounts' | 'cashbook' | 'eventpay' | 'reconcile' | 'overview' | 'ledger' | 'expenses';

export function FinanceTabs({ active }: { active: FinanceTabKey }) {
  const t = useT();
  // Order = the v2 story first: 仪表板 (the landing, Phase 2) · 账户 · 流水 (Phase 1
  // cash book). Then the LEGACY D1/D2/D4 surfaces, which read fee_payments/expenses —
  // untouched by v2 and kept until Ken decides whether to retire them. 旧总览 used to
  // own /dashboard/finance; Phase 2 moved it to /overview so the dashboard could land.
  const TABS: { key: FinanceTabKey; label: string; href: string }[] = [
    { key: 'dashboard', label: t('fdash.tab.dashboard'), href: '/dashboard/finance' },
    { key: 'accounts', label: t('cash.tab.accounts'), href: '/dashboard/finance/accounts' },
    { key: 'cashbook', label: t('cash.tab.cashbook'), href: '/dashboard/finance/cashbook' },
    { key: 'eventpay', label: t('ep.board.title'), href: '/dashboard/finance/event-payments' },
    { key: 'reconcile', label: t('ep.rec.title'), href: '/dashboard/finance/reconcile' },
    { key: 'overview', label: t('fdash.tab.overviewLegacy'), href: '/dashboard/finance/overview' },
    { key: 'ledger', label: t('finance.tab.ledger'), href: '/dashboard/finance/ledger' },
    { key: 'expenses', label: t('finance.tab.expenses'), href: '/dashboard/finance/expenses' },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`px-3.5 py-2 rounded-lg text-sm border transition ${
            tab.key === active ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border-strong hover:border-accent'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
