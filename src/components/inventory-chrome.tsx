// src/components/inventory-chrome.tsx
// Shared chrome for every 库存 page: the tab row (仪表板 · 库存明细 · 分会申请 · 变动记录 ·
// 品项管理) and the global item search box (client-side over the meta item list — the front
// door to 245+ items; a hit opens the shared item drawer via onPick). No server imports.

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { itemLabel } from '@/lib/inventory-display';

export type InvTabKey = 'dash' | 'stock' | 'requests' | 'ledger' | 'catalog';

const TABS: { key: InvTabKey; label: string; href: string }[] = [
  { key: 'dash', label: '📊 仪表板', href: '/dashboard/inventory' },
  { key: 'stock', label: '库存明细', href: '/dashboard/inventory/stock' },
  { key: 'requests', label: '分会申请', href: '/dashboard/inventory/requests' },
  { key: 'ledger', label: '变动记录', href: '/dashboard/inventory/movements' },
  { key: 'catalog', label: '品项管理', href: '/dashboard/inventory/catalog' },
];

export function InventoryTabs({ active }: { active: InvTabKey }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`px-3.5 py-2 rounded-lg text-sm border transition ${
            t.key === active
              ? 'bg-accent text-white border-accent'
              : 'bg-surface text-ink border-border-strong hover:border-accent'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export type SearchItem = { id: string; stock_id: string | null; name_cn: string; category_cn?: string | null };

export function GlobalItemSearch({ items, onPick }: { items: SearchItem[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return items
      .filter(
        (i) =>
          i.name_cn.toLowerCase().includes(s) ||
          (i.stock_id ?? '').toLowerCase().includes(s) ||
          (i.category_cn ?? '').includes(s)
      )
      .slice(0, 8);
  }, [items, q]);

  return (
    <div className="relative flex-1 min-w-[240px]">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint text-sm">🔍</span>
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={`搜索任何品项 — 名称 / 编号 / 分类…（${items.length} 项）`}
        className="w-full text-sm pl-9 pr-3 py-2.5 border-[1.5px] border-border-strong rounded-xl bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
      />
      {open && q.trim() && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-30 bg-surface border border-border-strong rounded-xl shadow-lg max-h-72 overflow-auto">
          {hits.length === 0 ? (
            <div className="px-4 py-3 text-sm text-ink-faint">没找到 — 试试别的关键字，或到「品项管理」＋新品项</div>
          ) : (
            hits.map((i) => (
              <button
                key={i.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(i.id);
                  setQ('');
                  setOpen(false);
                }}
                className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-2 border-b border-border last:border-b-0 hover:bg-accent/5"
              >
                <span className="text-sm text-ink truncate">{itemLabel(i)}</span>
                {i.category_cn && <span className="text-[11px] text-ink-faint whitespace-nowrap">{i.category_cn}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
