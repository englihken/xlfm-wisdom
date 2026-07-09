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

export type PickItem = { id: string; stock_id: string | null; name_cn: string };

// Clickable-row item picker — replaces a native multi-row <select size=N> whose change
// event some browsers/automation don't fire on a plain click. Search filters the list; a
// row click selects (persisting even if a later search hides it); the 已选 line confirms it.
export function ItemPicker({ items, value, onChange }: { items: PickItem[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => i.name_cn.toLowerCase().includes(s) || (i.stock_id ?? '').toLowerCase().includes(s));
  }, [items, q]);
  const selected = items.find((i) => i.id === value) ?? null;

  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="输入名称 / 编号筛选…"
        className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
      />
      <div role="listbox" className="mt-1.5 max-h-48 overflow-auto border border-border-strong rounded-lg bg-surface divide-y divide-border">
        {filtered.length === 0 ? (
          <p className="px-3 py-3 text-xs text-ink-faint">没有匹配的品项</p>
        ) : (
          filtered.map((i) => {
            const isSel = i.id === value;
            return (
              <button
                key={i.id}
                type="button"
                role="option"
                aria-selected={isSel}
                onClick={() => onChange(i.id)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition ${
                  isSel ? 'bg-accent/10 text-accent-deep font-medium' : 'text-ink hover:bg-accent/5'
                }`}
              >
                <span className={`w-3.5 shrink-0 ${isSel ? 'text-accent-deep' : 'text-transparent'}`}>✓</span>
                <span className="truncate">{itemLabel(i)}</span>
              </button>
            );
          })
        )}
      </div>
      <p className="mt-1 text-[11.5px] min-h-[16px]">
        {selected
          ? <span className="text-accent-deep">已选：{itemLabel(selected)}</span>
          : <span className="text-ink-faint">在上方列表点选一个品项（共 {filtered.length} 项）</span>}
      </p>
    </div>
  );
}

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
