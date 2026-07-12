// src/app/dashboard/inventory/stock/page.tsx
// 库存明细 — the per-location stock table driven by inventory_balances, enriched with each
// item's category_cn + low_stock_line (from meta). Location + 分类 + search filters, 只看有库存
// and 低库存 toggles, load-more paging, and a client-side CSV 导出 of the current view. A row
// click opens the shared item drawer. Reads ?cat= (a category_cn or the special 低库存) for
// dashboard drill-downs. inventory:view to see; inventory:edit reveals ＋记录变动 + drawer 编辑.

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { InventoryTabs, InventorySearchRow } from '@/components/inventory-chrome';
import { InventoryItemDrawer } from '@/components/inventory-item-drawer';
import { categoryPillClass } from '@/lib/inventory-display';
import { useT } from '@/lib/i18n-react';

type Location = { id: string; kind: string; centre_id: string | null; name_cn: string };
type MetaItem = { id: string; stock_id: string | null; name_cn: string; category_cn: string | null; low_stock_line: number | null };
type BalanceRow = {
  location_id: string;
  item_id: string;
  stock_id: string | null;
  item_name: string;
  pack_qty: number | null;
  qty: number;
};
type Row = BalanceRow & { category_cn: string | null; low_stock_line: number | null };

const LOW_STOCK = '低库存';
const PAGE = 30;

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function StockPage() {
  const t = useT();
  return (
    <ErpGate active="inventory" module="inventory" titleSuffix={t('inv.suffix.stock')}>
      {(me) => (
        <Suspense fallback={<p className="p-6 text-sm text-ink-muted">{t('inv.loading')}</p>}>
          <StockTable me={me} />
        </Suspense>
      )}
    </ErpGate>
  );
}

function StockTable({ me }: { me: ErpMe }) {
  const t = useT();
  const canEdit = grantAllows(me.grants, 'inventory', 'edit');
  const sp = useSearchParams();

  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<MetaItem[]>([]);
  const [categoriesCn, setCategoriesCn] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [category, setCategory] = useState(sp.get('cat') ?? '');
  const [search, setSearch] = useState('');
  const [nonzeroOnly, setNonzeroOnly] = useState(true);
  const [visible, setVisible] = useState(PAGE);
  const [drawerId, setDrawerId] = useState<string | null>(sp.get('item'));

  // Reset the load-more window when the filter signature changes — done during render
  // (store-previous-value pattern) rather than in an effect, so it doesn't double-render.
  const filterSig = `${location}|${category}|${search}|${nonzeroOnly}`;
  const [prevSig, setPrevSig] = useState(filterSig);
  if (filterSig !== prevSig) {
    setPrevSig(filterSig);
    setVisible(PAGE);
  }

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/inventory/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (!active || !meta) return;
        setLocations(meta.locations ?? []);
        setItems(meta.items ?? []);
        setCategoriesCn(meta.categoriesCn ?? []);
        const hq = (meta.locations ?? []).find((l: Location) => l.kind === 'hq_warehouse');
        setLocation((cur) => cur || hq?.id || meta.locations?.[0]?.id || '');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!location) return;
    let active = true;
    setLoading(true);
    fetch(`/api/dashboard/inventory/balances?location_id=${encodeURIComponent(location)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) setBalances(j.balances ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [location]);

  // Enrich balance rows with category_cn + low_stock_line from the meta item list.
  const rows: Row[] = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i]));
    return balances.map((b) => ({
      ...b,
      category_cn: map.get(b.item_id)?.category_cn ?? null,
      low_stock_line: map.get(b.item_id)?.low_stock_line ?? null,
    }));
  }, [balances, items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (category === LOW_STOCK) {
        if (r.low_stock_line == null || r.qty > r.low_stock_line) return false;
      } else if (category && r.category_cn !== category) {
        return false;
      }
      if (nonzeroOnly && r.qty === 0) return false;
      if (q && !r.item_name.toLowerCase().includes(q) && !(r.stock_id ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, category, search, nonzeroOnly]);

  const locName = locations.find((l) => l.id === location)?.name_cn ?? '';

  const exportCsv = () => {
    downloadCsv(
      t('inv.csv.stockFile', { loc: locName || t('inv.csv.warehouse') }),
      [t('inv.csv.h.code'), t('inv.csv.h.item'), t('inv.csv.h.category'), t('inv.csv.h.packQty'), t('inv.csv.h.qty'), t('inv.csv.h.lowLine')],
      filtered.map((r) => [r.stock_id ?? '', r.item_name, r.category_cn ?? '', r.pack_qty ?? '', r.qty, r.low_stock_line ?? ''])
    );
  };

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold font-serif text-ink">{t('inv.stock.title')}</h2>
        <span className="text-sm text-ink-faint">Inventory · {locName}</span>
      </div>

      <InventorySearchRow items={items} onPick={setDrawerId} />
      <InventoryTabs active="stock" />

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Sel value={location} onChange={setLocation}
          options={locations.map((l) => [l.id, l.kind === 'hq_warehouse' ? `🏛️ ${l.name_cn}` : l.name_cn] as [string, string])} />
        <Sel value={category} onChange={setCategory}
          options={[['', t('inv.stock.allCategories')], [LOW_STOCK, t('inv.stock.lowStockOpt')], ...categoriesCn.map((c) => [c, c] as [string, string])]} />
        <input
          type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t('inv.stock.filterInResults')}
          className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent w-44"
        />
        <label className="flex items-center gap-1.5 text-sm text-ink-muted select-none">
          <input type="checkbox" checked={nonzeroOnly} onChange={(e) => setNonzeroOnly(e.target.checked)} className="accent-[#B8860B]" />
          {t('inv.stock.nonzeroOnly')}
        </label>
        <span className="flex-1" />
        <button onClick={exportCsv} className="px-3 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">
          {t('inv.stock.exportCsv')}
        </button>
      </div>

      {/* table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex justify-between items-baseline gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-ink">{category === LOW_STOCK ? t('inv.stock.lowStockItems') : category || t('inv.stock.allItems')}</h3>
          <span className="text-xs text-ink-faint">{t('inv.stock.showing', { shown: Math.min(visible, filtered.length), total: filtered.length })}</span>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">{t('inv.loading')}</p>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-2xl mb-1">🪷</p>
            <p className="text-sm text-ink">{balances.length === 0 ? t('inv.stock.noBalances') : t('inv.stock.noMatch')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <Th>{t('inv.stock.thStockId')}</Th><Th>{t('inv.stock.thItem')}</Th><Th>{t('inv.th.category')}</Th>
                  <th className="px-4 py-2.5 font-normal text-right">{t('inv.stock.thQty')}</th>
                  <th className="px-4 py-2.5 font-normal text-right">{t('inv.th.lowLine')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, visible).map((r) => {
                  const low = r.low_stock_line != null && r.qty <= r.low_stock_line;
                  return (
                    <tr key={r.item_id} onClick={() => setDrawerId(r.item_id)} className="border-b border-border last:border-b-0 hover:bg-accent/5 cursor-pointer">
                      <td className="px-4 py-2.5">
                        {r.stock_id
                          ? <span className="font-mono text-xs text-ink">{r.stock_id}</span>
                          : <span className="pill-muted inline-block px-2 py-0.5 rounded-full text-[11px]">{t('inv.unnumbered')}</span>}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-ink">{r.item_name}</td>
                      <td className="px-4 py-2.5">
                        {r.category_cn
                          ? <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${categoryPillClass(r.category_cn)}`}>{r.category_cn}</span>
                          : <span className="text-ink-faint">–</span>}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${low ? 'text-[#B4402E]' : r.qty > 0 ? 'text-ink' : 'text-ink-faint'}`}>
                        {r.qty.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-faint">{r.low_stock_line ?? '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible < filtered.length && (
              <div className="px-4 py-3 border-t border-border text-center">
                <button onClick={() => setVisible((v) => v + PAGE)} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">
                  {t('inv.stock.loadMore', { n: filtered.length - visible })}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {canEdit && (
        <div>
          <Link href="/dashboard/inventory/movements/new" className="px-4 py-1.5 text-sm btn-primary inline-block">{t('inv.recordMovement')}</Link>
        </div>
      )}

      <InventoryItemDrawer itemId={drawerId} onClose={() => setDrawerId(null)} canEdit={canEdit} />
    </div>
  );
}

function Sel({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent max-w-[220px]">
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-normal">{children}</th>;
}
