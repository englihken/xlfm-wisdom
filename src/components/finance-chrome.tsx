// src/components/finance-chrome.tsx
// Shared tab row for the 财务 pages: 月费台账 · 支出记录. (总览 D1 and 盈余互助 D6 come in 025B —
// deliberately not present yet.) No server imports; mirrors inventory-chrome's InventoryTabs.

'use client';

import Link from 'next/link';

export type FinanceTabKey = 'overview' | 'ledger' | 'expenses' | 'mutual';

const TABS: { key: FinanceTabKey; label: string; href: string }[] = [
  { key: 'overview', label: '总览', href: '/dashboard/finance' },
  { key: 'ledger', label: '月费台账', href: '/dashboard/finance/ledger' },
  { key: 'expenses', label: '支出记录', href: '/dashboard/finance/expenses' },
  { key: 'mutual', label: '盈余互助', href: '/dashboard/finance/mutual-aid' },
];

export function FinanceTabs({ active }: { active: FinanceTabKey }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`px-3.5 py-2 rounded-lg text-sm border transition ${
            t.key === active ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border-strong hover:border-accent'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
