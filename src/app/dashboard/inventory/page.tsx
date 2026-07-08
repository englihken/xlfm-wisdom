// src/app/dashboard/inventory/page.tsx
// 库存总览 — per-location stock table driven by the inventory_balances view.
// Location selector (总会仓库 first) + category / search filters + 只看有库存 toggle.
// KPI strip: 品项总数 · 有库存品项 · 本仓总件数 · 待处理申请. inventory:view to see;
// inventory:edit reveals 记录变动. Balances are ledger-derived — no editable qty here.

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';

type Location = { id: string; kind: string; centre_id: string | null; name_cn: string };
type BalanceRow = {
  location_id: string;
  item_id: string;
  stock_id: string | null;
  item_name: string;
  category: string | null;
  pack_qty: number | null;
  qty: number;
};

export default function InventoryPage() {
  return (
    <ErpGate active="inventory" module="inventory">
      {(me) => <InventoryOverview me={me} />}
    </ErpGate>
  );
}

function InventoryOverview({ me }: { me: ErpMe }) {
  const canEdit = grantAllows(me.grants, 'inventory', 'edit');

  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [pendingReqs, setPendingReqs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [nonzeroOnly, setNonzeroOnly] = useState(true);

  // Meta once: locations (总会仓库 first) + categories + the pending-requests KPI.
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/dashboard/inventory/meta').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/dashboard/inventory/requests?status=pending&limit=1').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([meta, reqs]) => {
        if (!active) return;
        if (meta) {
          setLocations(meta.locations ?? []);
          setCategories(meta.categories ?? []);
          const hq = (meta.locations ?? []).find((l: Location) => l.kind === 'hq_warehouse');
          setLocation((cur) => cur || hq?.id || meta.locations?.[0]?.id || '');
        }
        if (reqs) setPendingReqs(reqs.total ?? 0);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Balances whenever the location changes (category/search/nonzero filter client-side
  // on the ≤239-row set, so typing stays instant).
  useEffect(() => {
    if (!location) return;
    let active = true;
    setLoading(true);
    fetch(`/api/dashboard/inventory/balances?location_id=${encodeURIComponent(location)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) setRows(j.balances ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [location]);

  const kpis = useMemo(() => {
    let inStock = 0;
    let units = 0;
    for (const r of rows) {
      if (r.qty > 0) inStock++;
      units += r.qty;
    }
    return { total: rows.length, inStock, units };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!nonzeroOnly || r.qty !== 0) &&
        (!category || r.category === category) &&
        (!q || r.item_name.toLowerCase().includes(q) || (r.stock_id ?? '').toLowerCase().includes(q))
    );
  }, [rows, category, search, nonzeroOnly]);

  const locName = locations.find((l) => l.id === location)?.name_cn ?? '';

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold font-serif text-ink">📦 库存总览</h2>
          <span className="text-sm text-ink-faint">Inventory · {locName}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/inventory/requests" className="px-3 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">
            分会申请{pendingReqs ? ` · ${pendingReqs}` : ''}
          </Link>
          <Link href="/dashboard/inventory/movements" className="px-3 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">
            变动记录
          </Link>
          {canEdit && (
            <Link href="/dashboard/inventory/movements/new" className="px-4 py-1.5 text-sm btn-primary">
              ＋记录变动
            </Link>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="品项总数" value={kpis.total} icon="🗂️" />
        <Kpi label="有库存品项" value={kpis.inStock} icon="📦" />
        <Kpi label="本仓总件数" value={kpis.units} icon="🧮" />
        <Kpi label="待处理申请" value={pendingReqs ?? 0} icon="🔔" accent={(pendingReqs ?? 0) > 0} />
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Sel value={location} onChange={setLocation}
          options={locations.map((l) => [l.id, l.kind === 'hq_warehouse' ? `🏛️ ${l.name_cn}` : l.name_cn] as [string, string])} />
        <Sel value={category} onChange={setCategory} options={[['', '全部分类'], ...categories.map((c) => [c, c] as [string, string])]} />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索 名称 / 编号…"
          className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent w-52"
        />
        <label className="flex items-center gap-1.5 text-sm text-ink-muted select-none">
          <input type="checkbox" checked={nonzeroOnly} onChange={(e) => setNonzeroOnly(e.target.checked)} className="accent-[#B8860B]" />
          只看有库存
        </label>
      </div>

      {/* table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">加载中…</p>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-2xl mb-1">🪷</p>
            <p className="text-sm text-ink">{rows.length === 0 ? '此仓还没有库存记录。' : '未找到匹配的品项'}</p>
            {rows.length > 0 && nonzeroOnly && (
              <p className="mt-1 text-xs text-ink-muted">试试取消「只看有库存」查看全部品项。</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <Th>编号 StockID</Th><Th>品项 Item</Th><Th>分类</Th><Th>每包</Th>
                  <th className="px-4 py-2.5 font-normal text-right">库存 Qty</th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.item_id} className="border-b border-border last:border-b-0 hover:bg-accent/5">
                    <td className="px-4 py-2.5">
                      {r.stock_id
                        ? <span className="font-mono text-xs text-ink">{r.stock_id}</span>
                        : <span className="pill-muted inline-block px-2 py-0.5 rounded-full text-[11px]">未编号</span>}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-ink">{r.item_name}</td>
                    <td className="px-4 py-2.5">
                      {r.category && r.category !== 'uncoded'
                        ? <span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[11px]">{r.category}</span>
                        : <span className="text-ink-faint">–</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">{r.pack_qty ?? '–'}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${r.qty > 0 ? 'text-ink' : 'text-ink-faint'}`}>
                      {r.qty.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/dashboard/inventory/movements?item=${r.item_id}`}
                        className="text-xs text-accent-deep hover:underline"
                      >
                        记录
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-ink-faint">
        库存由变动台账推算（期初结存以 2026-03-02 表格为准，未盘点前仅供参考）。数量有出入时请用「盘点调增/调减」修正。
      </p>
    </div>
  );
}

function Kpi({ label, value, icon, accent }: { label: string; value: number; icon: string; accent?: boolean }) {
  return (
    <div className={`bg-surface border rounded-2xl px-4 py-3 ${accent ? 'border-accent' : 'border-border'}`}>
      <p className="text-[11px] text-ink-faint">{icon} {label}</p>
      <p className="mt-0.5 text-xl font-bold text-ink tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

function Sel({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>{label}</option>
      ))}
    </select>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-normal">{children}</th>;
}
