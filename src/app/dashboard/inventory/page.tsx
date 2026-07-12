// src/app/dashboard/inventory/page.tsx
// 仪表板 — the 库存 dashboard: only what needs action (world-class inventory practice — find by
// search, judge health by dashboard). 5 KPIs, a 低库存·采购建议 card with a CSV 采购清单 export,
// 最常发放 bars, 各分类库存 bars (click → 明细 filtered by category), and 库存在哪里 holdings.
// Cards drill down to /stock. All from /api/dashboard/inventory/stats. inventory:view.

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { InventoryTabs, InventorySearchRow, type SearchItem } from '@/components/inventory-chrome';
import { InventoryItemDrawer } from '@/components/inventory-item-drawer';
import { useT } from '@/lib/i18n-react';

type Stats = {
  kpis: { totalUnits: number; itemCount: number; pendingRequests: number; lowStockCount: number; monthOut: number; monthReturns: number };
  lowStock: { item_id: string; stock_id: string | null; name_cn: string; category_cn: string | null; qty: number; low_stock_line: number | null; avgMonthly: number; monthsLeft: number | null }[];
  topMovers30d: { item_id: string; stock_id: string | null; name_cn: string; qty: number }[];
  categoryTotals: { category_cn: string; units: number }[];
  holdings: { location_id: string; name: string; kind: string; units: number }[];
};

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

export default function InventoryDashboardPage() {
  const t = useT();
  return (
    <ErpGate active="inventory" module="inventory">
      {(me) => (
        <Suspense fallback={<p className="p-6 text-sm text-ink-muted">{t('inv.loading')}</p>}>
          <Dashboard me={me} />
        </Suspense>
      )}
    </ErpGate>
  );
}

function Dashboard({ me }: { me: ErpMe }) {
  const t = useT();
  const canEdit = grantAllows(me.grants, 'inventory', 'edit');
  const canAdmin = grantAllows(me.grants, 'inventory', 'admin');
  const router = useRouter();
  const sp = useSearchParams();
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerId, setDrawerId] = useState<string | null>(sp.get('item'));
  const [showShare, setShowShare] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/dashboard/inventory/stats').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/dashboard/inventory/meta').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([s, meta]) => {
        if (!active) return;
        if (s) setStats(s);
        if (meta) setItems(meta.items ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const goStock = (cat?: string) =>
    router.push(`/dashboard/inventory/stock${cat ? `?cat=${encodeURIComponent(cat)}` : ''}`);

  const topMax = useMemo(() => Math.max(1, ...(stats?.topMovers30d ?? []).map((m) => m.qty)), [stats]);
  const catMax = useMemo(() => Math.max(1, ...(stats?.categoryTotals ?? []).map((c) => c.units)), [stats]);

  const exportPurchase = () => {
    if (!stats) return;
    downloadCsv(
      t('inv.csv.purchaseFile'),
      [t('inv.csv.h.code'), t('inv.csv.h.item'), t('inv.csv.h.category'), t('inv.csv.h.onHandHq'), t('inv.csv.h.lowLine'), t('inv.csv.h.avgMonthly90'), t('inv.csv.h.monthsLeft')],
      stats.lowStock.map((r) => [
        r.stock_id ?? '', r.name_cn, r.category_cn ?? '', r.qty, r.low_stock_line ?? '',
        r.avgMonthly, r.monthsLeft == null ? '' : r.monthsLeft.toFixed(1),
      ])
    );
  };

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold font-serif text-ink">{t('inv.dash.title')}</h2>
          <span className="text-sm text-ink-faint">Inventory</span>
        </div>
        {canAdmin && (
          <button onClick={() => setShowShare(true)} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">
            {t('inv.dash.shareBtn')}
          </button>
        )}
      </div>

      <InventorySearchRow items={items} onPick={setDrawerId} />
      <InventoryTabs active="dash" />

      {loading ? (
        <p className="p-6 text-sm text-ink-muted">{t('inv.loading')}</p>
      ) : !stats ? (
        <p className="p-6 text-sm text-ink-muted">{t('inv.dash.statsFail')}</p>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi label={t('inv.dash.kpiTotalUnits')} value={stats.kpis.totalUnits} sub={t('inv.dash.viewDetail')} onClick={() => goStock()} />
            <Kpi label={t('inv.dash.kpiItems')} value={stats.kpis.itemCount} sub={t('inv.dash.catCount', { n: stats.categoryTotals.length })} onClick={() => goStock()} />
            <Kpi label={t('inv.dash.kpiPending')} value={stats.kpis.pendingRequests} sub={t('inv.dash.goHandle')} hot={stats.kpis.pendingRequests > 0} onClick={() => router.push('/dashboard/inventory/requests')} />
            <Kpi label={t('inv.dash.kpiLowStock')} value={stats.kpis.lowStockCount} sub={t('inv.dash.viewAll')} alert={stats.kpis.lowStockCount > 0} onClick={() => goStock('低库存')} />
            <Kpi label={t('inv.dash.kpiMonthOut')} value={stats.kpis.monthOut} sub={t('inv.dash.returnsSub', { n: stats.kpis.monthReturns.toLocaleString() })} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* low stock + purchasing */}
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex justify-between items-baseline gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-ink">{t('inv.dash.lowStockTitle')}</h3>
                <button onClick={exportPurchase} className="text-xs text-accent-deep hover:underline">{t('inv.dash.exportPurchase')}</button>
              </div>
              {stats.lowStock.length === 0 ? (
                <p className="p-6 text-sm text-ink-muted">{t('inv.dash.noLowStock')}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                      <th className="px-4 py-2 font-normal">{t('inv.dash.thItem')}</th>
                      <th className="px-4 py-2 font-normal text-right">{t('inv.dash.thOnHand')}</th>
                      <th className="px-4 py-2 font-normal text-right">{t('inv.dash.thMonthsLeft')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.lowStock.slice(0, 8).map((r) => (
                      <tr key={r.item_id} onClick={() => setDrawerId(r.item_id)} className="border-b border-border last:border-b-0 hover:bg-accent/5 cursor-pointer">
                        <td className="px-4 py-2">
                          <span className="font-medium text-ink">{r.name_cn}</span>
                          {r.stock_id && <span className="ml-1.5 font-mono text-[10px] text-ink-muted">{r.stock_id}</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-[#B4402E] font-semibold">{r.qty.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{r.monthsLeft == null ? '—' : t('inv.dash.months', { n: r.monthsLeft.toFixed(1) })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="px-4 py-2.5 border-t border-border text-[11px] text-ink-faint">{t('inv.dash.monthsLeftNote')}</p>
            </div>

            {/* category totals */}
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex justify-between items-baseline gap-2">
                <h3 className="text-sm font-semibold text-ink">{t('inv.dash.catStockTitle')}</h3>
                <span className="text-xs text-ink-faint">{t('inv.dash.clickCatHint')}</span>
              </div>
              <div className="p-4 space-y-2">
                {stats.categoryTotals.length === 0 ? (
                  <p className="text-sm text-ink-muted">{t('inv.dash.noData')}</p>
                ) : (
                  stats.categoryTotals.map((c) => (
                    <button key={c.category_cn} onClick={() => goStock(c.category_cn)} className="w-full flex items-center gap-2.5 text-left">
                      <span className="w-28 shrink-0 text-xs text-ink-muted truncate">{c.category_cn}</span>
                      <span className="flex-1 h-3 bg-surface-soft rounded-full overflow-hidden">
                        <span className="block h-full rounded-full bg-accent/85" style={{ width: `${Math.max(2, (c.units / catMax) * 100)}%` }} />
                      </span>
                      <span className="w-20 text-right text-xs font-semibold tabular-nums text-ink">{c.units.toLocaleString()}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* top movers */}
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-ink">{t('inv.dash.topMoversTitle')}</h3>
              </div>
              <div className="p-4 space-y-2">
                {stats.topMovers30d.length === 0 ? (
                  <p className="text-sm text-ink-muted">{t('inv.dash.noMovers')}</p>
                ) : (
                  stats.topMovers30d.map((m) => (
                    <button key={m.item_id} onClick={() => setDrawerId(m.item_id)} className="w-full flex items-center gap-2.5 text-left">
                      <span className="w-28 shrink-0 text-xs text-ink-muted truncate">{m.name_cn}</span>
                      <span className="flex-1 h-3 bg-surface-soft rounded-full overflow-hidden">
                        <span className="block h-full rounded-full bg-accent/85" style={{ width: `${Math.max(2, (m.qty / topMax) * 100)}%` }} />
                      </span>
                      <span className="w-20 text-right text-xs font-semibold tabular-nums text-ink">{m.qty.toLocaleString()}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* holdings */}
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-ink">{t('inv.dash.holdingsTitle')}</h3>
              </div>
              <div className="p-4">
                {stats.holdings.length === 0 ? (
                  <p className="text-sm text-ink-muted">{t('inv.dash.noHoldings')}</p>
                ) : (
                  stats.holdings.slice(0, 10).map((h) => (
                    <div key={h.location_id} className="flex justify-between text-[13px] py-1.5 border-b border-dashed border-border last:border-b-0">
                      <span className="text-ink">{h.kind === 'hq_warehouse' ? `🏛️ ${h.name}` : h.name}</span>
                      <b className="tabular-nums text-ink">{h.units.toLocaleString()}</b>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <p className="text-xs text-ink-faint">
            {t('inv.dash.footer')}
          </p>
        </>
      )}

      {showShare && <ShareModal onClose={() => setShowShare(false)} />}

      <InventoryItemDrawer itemId={drawerId} onClose={() => setDrawerId(null)} canEdit={canEdit} />
    </div>
  );
}

type ShareLink = { id: string; token: string; label: string | null; is_active: boolean; created_at: string };

function ShareModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const load = () => {
    setLoading(true);
    fetch('/api/dashboard/inventory/share-links')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) setLinks(j.links ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setBusy(true);
    try {
      await fetch('/api/dashboard/inventory/share-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || undefined }),
      });
      setLabel('');
      load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string, active: boolean) => {
    await fetch(`/api/dashboard/inventory/share-links/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !active }),
    });
    load();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-ink/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-ink mb-1">{t('inv.share.title')}</h3>
        <p className="text-xs text-ink-muted mb-3">{t('inv.share.intro')}</p>

        <div className="flex gap-2 mb-3">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('inv.share.labelPlaceholder')}
            className="flex-1 text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent" />
          <button disabled={busy} onClick={create} className="px-4 py-2 text-sm btn-primary whitespace-nowrap">{t('inv.share.newLink')}</button>
        </div>

        {loading ? (
          <p className="text-sm text-ink-muted">{t('inv.loading')}</p>
        ) : links.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('inv.share.noLinks')}</p>
        ) : (
          <div className="space-y-2">
            {links.map((l) => {
              const url = `${origin}/s/${l.token}`;
              return (
                <div key={l.id} className="border border-border rounded-lg p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-ink truncate">{l.label || t('inv.share.noLabel')}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${l.is_active ? 'bg-[#E7F0E0] text-[#3F6B2E]' : 'pill-muted'}`}>{l.is_active ? t('inv.share.active') : t('inv.share.inactive')}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <input readOnly value={url} className="flex-1 text-[11px] font-mono px-2 py-1 border border-border rounded bg-surface-soft text-ink-muted" />
                    <button onClick={() => navigator.clipboard?.writeText(url)} className="text-xs text-accent-deep hover:underline whitespace-nowrap">{t('inv.share.copy')}</button>
                    <button onClick={() => revoke(l.id, l.is_active)} className="text-xs text-ink-muted hover:text-[#B4402E] whitespace-nowrap">{l.is_active ? t('inv.share.disable') : t('inv.share.enable')}</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end mt-3">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('inv.close')}</button>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, hot, alert, onClick }: { label: string; value: number; sub?: string; hot?: boolean; alert?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`text-left bg-surface border rounded-2xl px-4 py-3 transition ${
        alert ? 'border-[#E5C4BF]' : hot ? 'border-accent' : 'border-border'
      } ${onClick ? 'hover:border-gold-border cursor-pointer' : 'cursor-default'}`}
    >
      <p className="text-[11px] text-ink-faint">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${alert ? 'text-[#B4402E]' : 'text-ink'}`}>{value.toLocaleString()}</p>
      {sub && <p className="text-[10.5px] text-accent-deep mt-0.5">{sub}</p>}
    </button>
  );
}
