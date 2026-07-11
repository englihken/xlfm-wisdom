// src/components/finance-chrome.tsx
// Shared tab row for the 财务 pages: 总览 · 月费台账 · 支出记录. (The 盈余互助 tab was
// retired — owner decision 2026-07-11: centre finances are separate; HQ supports
// directly.) No server imports; mirrors inventory-chrome's InventoryTabs. Labels via t().

'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n-react';

export type FinanceTabKey = 'overview' | 'ledger' | 'expenses';

export function FinanceTabs({ active }: { active: FinanceTabKey }) {
  const t = useT();
  const TABS: { key: FinanceTabKey; label: string; href: string }[] = [
    { key: 'overview', label: t('finance.tab.overview'), href: '/dashboard/finance' },
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
