// src/app/dashboard/inventory/movements/page.tsx
// 变动记录 — the ledger list with type / location / event / item filters (server-side) and
// pagination. When a 法会 is selected a 拣货·发放汇总 card appears on top. 023 additions: a 📷
// indicator opens the row's 存证 photo via a signed URL; a 撤销 link writes the 更正撤销 reversal
// (shown per the 24h/creator rule — creator within 24h, or inventory:admin anytime; the API is
// the real gate); reversal rows are labelled 更正撤销 and can't themselves be reversed. Reads
// the ?item= deep link. inventory:edit reveals ＋记录变动 + 撤销.

'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPE_OPTIONS, MOVEMENT_TYPE_STYLES, itemLabel } from '@/lib/inventory-display';
import { InventoryTabs, InventorySearchRow, type SearchItem } from '@/components/inventory-chrome';
import { InventoryItemDrawer } from '@/components/inventory-item-drawer';

type Lite = { id: string; name_cn: string; kind?: string } | null;
type MovementRow = {
  id: string;
  movement_type: string;
  qty: number;
  note: string | null;
  moved_at: string;
  created_at: string;
  photo_path: string | null;
  reversal_of: string | null;
  item: { id: string; stock_id: string | null; name_cn: string } | { id: string; stock_id: string | null; name_cn: string }[] | null;
  from_location: Lite | Lite[];
  to_location: Lite | Lite[];
  event: { id: string; code: string; title: string } | { id: string; code: string; title: string }[] | null;
  creator: { display_name: string | null; email: string } | { display_name: string | null; email: string }[] | null;
};
type SummaryRow = { item_id: string; stock_id: string | null; name_cn: string; qty: number };
type Meta = {
  locations: { id: string; kind: string; name_cn: string }[];
  items: SearchItem[];
  events: { id: string; code: string; title: string }[];
};

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
function within24h(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() <= 24 * 60 * 60 * 1000;
}

export default function MovementsPage() {
  return (
    <ErpGate active="inventory" module="inventory" titleSuffix="变动记录">
      {(me) => (
        <Suspense fallback={<p className="p-6 text-sm text-ink-muted">加载中…</p>}>
          <MovementsList me={me} />
        </Suspense>
      )}
    </ErpGate>
  );
}

function MovementsList({ me }: { me: ErpMe }) {
  const canEdit = grantAllows(me.grants, 'inventory', 'edit');
  const isAdmin = grantAllows(me.grants, 'inventory', 'admin');
  const sp = useSearchParams();

  const [meta, setMeta] = useState<Meta>({ locations: [], items: [], events: [] });
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [rowErr, setRowErr] = useState<{ id: string; msg: string } | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const [type, setType] = useState('');
  const [location, setLocation] = useState('');
  const [eventId, setEventId] = useState('');
  const [itemId, setItemId] = useState(sp.get('item') ?? '');

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/inventory/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) setMeta({ locations: j.locations ?? [], items: j.items ?? [], events: j.events ?? [] });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ page: String(page), limit: '50' });
    if (type) q.set('type', type);
    if (location) q.set('location_id', location);
    if (eventId) q.set('event_id', eventId);
    if (itemId) q.set('item_id', itemId);
    fetch(`/api/dashboard/inventory/movements?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setRows(j.movements ?? []);
        setTotal(j.total ?? 0);
        setTotalPages(j.totalPages ?? 1);
        setSummary(j.summary ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [type, location, eventId, itemId, page]);

  useEffect(() => {
    load();
  }, [load]);

  const currentItem = useMemo(() => meta.items.find((i) => i.id === itemId), [meta.items, itemId]);
  const currentEvent = useMemo(() => meta.events.find((e) => e.id === eventId), [meta.events, eventId]);
  // Originals that have a reversal on this page → hide their 撤销.
  const reversedIds = useMemo(() => new Set(rows.filter((r) => r.reversal_of).map((r) => r.reversal_of)), [rows]);

  const openPhoto = async (path: string) => {
    const r = await fetch(`/api/dashboard/inventory/media-url?path=${encodeURIComponent(path)}`);
    const j = await r.json().catch(() => ({}));
    if (j?.url) window.open(j.url, '_blank', 'noopener');
  };

  const reverse = async (r: MovementRow) => {
    setRowErr(null);
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/dashboard/inventory/movements/${r.id}/reverse`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setRowErr({ id: r.id, msg: j.error ?? '撤销失败' });
      else load();
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold font-serif text-ink">📦 变动记录</h2>
        <span className="text-sm text-ink-faint">Movements · {total.toLocaleString()}</span>
      </div>

      <InventorySearchRow items={meta.items} onPick={setDrawerId} />
      <InventoryTabs active="ledger" />

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Sel value={type} onChange={(v) => { setPage(1); setType(v); }}
          options={[['', '全部类型'], ...MOVEMENT_TYPE_OPTIONS, ['opening', '期初结存']]} />
        <Sel value={location} onChange={(v) => { setPage(1); setLocation(v); }}
          options={[['', '全部仓/中心'], ...meta.locations.map((l) => [l.id, l.kind === 'hq_warehouse' ? `🏛️ ${l.name_cn}` : l.name_cn] as [string, string])]} />
        <Sel value={eventId} onChange={(v) => { setPage(1); setEventId(v); }}
          options={[['', '全部活动'], ...meta.events.map((e) => [e.id, `${e.code} ${e.title}`] as [string, string])]} />
        {currentItem && (
          <button onClick={() => { setPage(1); setItemId(''); }} className="pill-gold inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px]" title="点击清除品项筛选">
            {itemLabel(currentItem)} ✕
          </button>
        )}
        {canEdit && (
          <>
            <span className="flex-1" />
            <Link href="/dashboard/inventory/movements/new" className="px-4 py-1.5 text-sm btn-primary">＋记录变动</Link>
          </>
        )}
      </div>

      {/* event picking summary */}
      {eventId && summary.length > 0 && (
        <div className="bg-surface border border-accent rounded-2xl p-4">
          <p className="text-sm font-semibold text-ink">🧾 拣货·发放汇总 — {currentEvent ? `${currentEvent.code} ${currentEvent.title}` : ''}</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">该活动名下所有变动的净数量（退回已扣除），供拣货/核对使用。</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {summary.map((s) => (
              <span key={s.item_id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-soft border border-border text-xs text-ink">
                {s.stock_id && <span className="font-mono text-[10px] text-ink-muted">{s.stock_id}</span>}
                {s.name_cn}
                <b className="tabular-nums">× {s.qty.toLocaleString()}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">加载中…</p>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center"><p className="text-2xl mb-1">🪷</p><p className="text-sm text-ink">没有匹配的变动记录。</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <Th>日期</Th><Th>类型</Th><Th>品项 Item</Th>
                  <th className="px-4 py-2.5 font-normal text-right">数量</th>
                  <Th>从 → 到</Th><Th>活动</Th><Th>备注 / 经手</Th>{canEdit && <Th></Th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const item = one(r.item);
                  const fromL = one(r.from_location);
                  const toL = one(r.to_location);
                  const ev = one(r.event);
                  const by = one(r.creator);
                  const isReversal = !!r.reversal_of;
                  const alreadyReversed = reversedIds.has(r.id);
                  const eligible = canEdit && !isReversal && r.movement_type !== 'opening' && !alreadyReversed &&
                    (isAdmin || (by?.email === me.email && within24h(r.created_at)));
                  return (
                    <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-accent/5 align-top">
                      <td className="px-4 py-2.5 text-xs text-ink-muted whitespace-nowrap">{r.moved_at}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap ${isReversal ? 'bg-surface-soft text-ink-faint border border-border' : MOVEMENT_TYPE_STYLES[r.movement_type] ?? ''}`}>
                          {isReversal ? '更正撤销' : MOVEMENT_TYPE_LABELS[r.movement_type] ?? r.movement_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => item && setDrawerId(item.id)} className="text-left font-medium text-ink hover:text-accent-deep">{item?.name_cn ?? '–'}</button>
                        {item?.stock_id && <div className="font-mono text-[10px] text-ink-muted">{item.stock_id}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{r.qty.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-xs text-ink whitespace-nowrap">{fromL?.name_cn ?? '—'} → {toL?.name_cn ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs">{ev ? <span className="font-mono text-ink-muted">{ev.code}</span> : <span className="text-ink-faint">–</span>}</td>
                      <td className="px-4 py-2.5 text-xs text-ink-muted max-w-[220px]">
                        <div className="flex items-center gap-1">
                          {r.photo_path && (
                            <button onClick={() => openPhoto(r.photo_path!)} title="查看存证照片" className="text-accent-deep">📷</button>
                          )}
                          {r.note && <span className="truncate" title={r.note}>{r.note}</span>}
                        </div>
                        <div className="text-ink-faint">{by?.display_name || by?.email || ''}</div>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {eligible ? (
                            <button disabled={busyId === r.id} onClick={() => reverse(r)} className="text-xs text-accent-deep hover:underline">
                              {busyId === r.id ? '…' : '↩ 撤销'}
                            </button>
                          ) : alreadyReversed ? (
                            <span className="text-[11px] text-ink-faint">已撤销</span>
                          ) : null}
                          {rowErr?.id === r.id && <p className="text-[11px] text-[#B4402E] mt-1 max-w-[160px] whitespace-normal">{rowErr.msg}</p>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 border border-border-strong rounded-lg bg-surface text-ink disabled:opacity-40">上一页</button>
          <span className="text-ink-muted">{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 border border-border-strong rounded-lg bg-surface text-ink disabled:opacity-40">下一页</button>
        </div>
      )}

      <InventoryItemDrawer itemId={drawerId} onClose={() => setDrawerId(null)} canEdit={canEdit} />
    </div>
  );
}

function Sel({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent max-w-[260px]">
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-normal">{children}</th>;
}
