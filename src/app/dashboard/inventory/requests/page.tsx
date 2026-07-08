// src/app/dashboard/inventory/requests/page.tsx
// 分会申请 — the sheet's 分会要求/预订 flow, with backorders built in: 申请 vs 已拨
// per row, remainder = 总会还欠分会. inventory:view sees the queue; inventory:edit gets
// ＋新申请 (inline collapsible form), per-row 拨付 (inline qty, defaults to remainder;
// creates the HQ→centre transfer via the fulfil API) and 取消 (closes the remainder).

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { REQUEST_STATUS_LABELS, REQUEST_STATUS_STYLES, itemLabel } from '@/lib/inventory-display';

type Lite<T> = T | T[] | null;
type RequestRow = {
  id: string;
  qty_requested: number;
  qty_fulfilled: number;
  status: string;
  note: string | null;
  requested_at: string;
  centre: Lite<{ id: string; code: string; name_cn: string }>;
  item: Lite<{ id: string; stock_id: string | null; name_cn: string; pack_qty: number | null }>;
  event: Lite<{ id: string; code: string; title: string }>;
};
type Meta = {
  items: { id: string; stock_id: string | null; name_cn: string }[];
  events: { id: string; code: string; title: string }[];
};
type Centre = { id: string; code: string; name_cn: string };

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default function RequestsPage() {
  return (
    <ErpGate active="inventory" module="inventory" titleSuffix="分会申请">
      {(me) => <RequestsQueue me={me} />}
    </ErpGate>
  );
}

function RequestsQueue({ me }: { me: ErpMe }) {
  const canEdit = grantAllows(me.grants, 'inventory', 'edit');

  const [rows, setRows] = useState<RequestRow[]>([]);
  const [meta, setMeta] = useState<Meta>({ items: [], events: [] });
  const [centres, setCentres] = useState<Centre[]>([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);

  // new-request form
  const [showForm, setShowForm] = useState(false);
  const [fCentre, setFCentre] = useState('');
  const [fItemSearch, setFItemSearch] = useState('');
  const [fItem, setFItem] = useState('');
  const [fQty, setFQty] = useState('');
  const [fEvent, setFEvent] = useState('');
  const [fNote, setFNote] = useState('');
  const [fError, setFError] = useState('');
  const [fSaving, setFSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ limit: '100' });
    if (status) q.set('status', status);
    fetch(`/api/dashboard/inventory/requests?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) setRows(j.requests ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    // Inventory meta (items, events) + centres (the request is per-centre, not per-store).
    Promise.all([
      fetch('/api/dashboard/inventory/meta').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/dashboard/erp/meta').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([inv, erp]) => {
      if (!active) return;
      if (inv) setMeta({ items: inv.items ?? [], events: inv.events ?? [] });
      // erp/meta needs members:view — inventory-only accounts fall back to deriving
      // centres from the inventory locations list (same ids, centre kind only).
      if (erp?.centres?.length) {
        setCentres(erp.centres);
      } else if (inv) {
        const derived = (inv.locations ?? [])
          .filter((l: { kind: string; centre_id: string | null }) => l.kind === 'centre' && l.centre_id)
          .map((l: { centre_id: string; name_cn: string }) => ({ id: l.centre_id, code: '', name_cn: l.name_cn }));
        setCentres(derived);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const filteredItems = useMemo(() => {
    const q = fItemSearch.trim().toLowerCase();
    if (!q) return meta.items;
    return meta.items.filter(
      (i) => i.name_cn.toLowerCase().includes(q) || (i.stock_id ?? '').toLowerCase().includes(q)
    );
  }, [meta.items, fItemSearch]);

  useEffect(() => {
    if (fItem && !filteredItems.some((i) => i.id === fItem)) setFItem('');
  }, [filteredItems, fItem]);

  const createRequest = async () => {
    setFError('');
    if (!fCentre) return setFError('请选择分会/中心');
    if (!fItem) return setFError('请选择品项');
    const n = Number(fQty);
    if (!Number.isInteger(n) || n <= 0) return setFError('申请数量须为大于 0 的整数');
    setFSaving(true);
    try {
      const res = await fetch('/api/dashboard/inventory/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centre_id: fCentre, item_id: fItem, qty_requested: n, event_id: fEvent || null, note: fNote }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFError(j.error ?? '创建失败，请重试');
        setFSaving(false);
        return;
      }
      setFQty(''); setFNote(''); setFSaving(false); setShowForm(false);
      load();
    } catch {
      setFError('网络异常，请重试');
      setFSaving(false);
    }
  };

  const fulfil = async (r: RequestRow, qty: number) => {
    setRowError(null);
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/dashboard/inventory/requests/${r.id}/fulfil`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowError({ id: r.id, msg: j.error ?? '拨付失败' });
      } else {
        load();
      }
    } catch {
      setRowError({ id: r.id, msg: '网络异常，请重试' });
    } finally {
      setBusyId('');
    }
  };

  const cancel = async (r: RequestRow) => {
    setRowError(null);
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/dashboard/inventory/requests/${r.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowError({ id: r.id, msg: j.error ?? '取消失败' });
      } else {
        load();
      }
    } catch {
      setRowError({ id: r.id, msg: '网络异常，请重试' });
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold font-serif text-ink">📦 分会申请</h2>
          <span className="text-sm text-ink-faint">Requests · {rows.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/inventory" className="px-3 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">
            ← 库存总览
          </Link>
          {canEdit && (
            <button onClick={() => setShowForm((s) => !s)} className="px-4 py-1.5 text-sm btn-primary">
              {showForm ? '收起' : '＋新申请'}
            </button>
          )}
        </div>
      </div>

      {/* inline create form */}
      {canEdit && showForm && (
        <div className="bg-surface border border-accent rounded-2xl p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-muted mb-1.5">分会/中心</label>
              <Sel value={fCentre} onChange={setFCentre}
                options={[['', '请选择…'], ...centres.map((c) => [c.id, c.name_cn] as [string, string])]} full />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1.5">关联活动（可选）</label>
              <Sel value={fEvent} onChange={setFEvent}
                options={[['', '（无）'], ...meta.events.map((e) => [e.id, `${e.code} ${e.title}`] as [string, string])]} full />
            </div>
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1.5">品项</label>
            <input
              type="search"
              value={fItemSearch}
              onChange={(e) => setFItemSearch(e.target.value)}
              placeholder="输入名称 / 编号筛选…"
              className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
            />
            <select
              value={fItem}
              onChange={(e) => setFItem(e.target.value)}
              size={Math.min(6, Math.max(3, filteredItems.length))}
              className="mt-1.5 w-full text-sm px-2 py-1.5 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent"
            >
              {filteredItems.map((i) => (
                <option key={i.id} value={i.id}>{itemLabel(i)}</option>
              ))}
            </select>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-muted mb-1.5">申请数量</label>
              <input
                type="number" min={1} step={1} value={fQty} onChange={(e) => setFQty(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1.5">备注（可选）</label>
              <input
                type="text" value={fNote} onChange={(e) => setFNote(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          {fError && (
            <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2">{fError}</p>
          )}
          <button onClick={createRequest} disabled={fSaving} className="px-5 py-2 text-sm btn-primary">
            {fSaving ? '提交中…' : '提交申请'}
          </button>
        </div>
      )}

      {/* status filter */}
      <div className="flex flex-wrap items-center gap-2">
        {[['pending', '待处理'], ['partial', '部分拨付'], ['fulfilled', '已拨付'], ['cancelled', '已取消'], ['', '全部']].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setStatus(v)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${
              status === v ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border-strong hover:border-accent'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">加载中…</p>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-2xl mb-1">🪷</p>
            <p className="text-sm text-ink">没有{REQUEST_STATUS_LABELS[status] ?? ''}的申请。</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <Th>分会 Centre</Th><Th>品项 Item</Th>
                  <th className="px-4 py-2.5 font-normal text-right">申请 / 已拨</th>
                  <Th>还欠</Th><Th>状态</Th><Th>活动</Th><Th>备注</Th>
                  {canEdit && <Th>操作</Th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RequestTr
                    key={r.id}
                    r={r}
                    canEdit={canEdit}
                    busy={busyId === r.id}
                    error={rowError?.id === r.id ? rowError.msg : ''}
                    onFulfil={fulfil}
                    onCancel={cancel}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function RequestTr({
  r,
  canEdit,
  busy,
  error,
  onFulfil,
  onCancel,
}: {
  r: RequestRow;
  canEdit: boolean;
  busy: boolean;
  error: string;
  onFulfil: (r: RequestRow, qty: number) => void;
  onCancel: (r: RequestRow) => void;
}) {
  const centre = one(r.centre);
  const item = one(r.item);
  const ev = one(r.event);
  const remaining = r.qty_requested - r.qty_fulfilled;
  const open = r.status === 'pending' || r.status === 'partial';
  const [qty, setQty] = useState(String(remaining));

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-accent/5 align-top">
      <td className="px-4 py-2.5">
        <span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[11px]">{centre?.name_cn ?? '–'}</span>
      </td>
      <td className="px-4 py-2.5">
        <span className="font-medium text-ink">{item?.name_cn ?? '–'}</span>
        {item?.stock_id && <div className="font-mono text-[10px] text-ink-muted">{item.stock_id}</div>}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-ink">
        {r.qty_requested.toLocaleString()} / {r.qty_fulfilled.toLocaleString()}
      </td>
      <td className="px-4 py-2.5 tabular-nums">
        {open && remaining > 0
          ? <span className="font-semibold text-accent-deep">{remaining.toLocaleString()}</span>
          : <span className="text-ink-faint">–</span>}
      </td>
      <td className="px-4 py-2.5">
        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap ${REQUEST_STATUS_STYLES[r.status] ?? ''}`}>
          {REQUEST_STATUS_LABELS[r.status] ?? r.status}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs">
        {ev ? <span className="font-mono text-ink-muted">{ev.code}</span> : <span className="text-ink-faint">–</span>}
      </td>
      <td className="px-4 py-2.5 text-xs text-ink-muted max-w-[180px]">
        <div className="truncate" title={r.note ?? ''}>{r.note ?? ''}</div>
        <div className="text-ink-faint">{r.requested_at}</div>
      </td>
      {canEdit && (
        <td className="px-4 py-2.5">
          {open ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={remaining}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-20 text-sm px-2 py-1 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent tabular-nums"
              />
              <button
                disabled={busy}
                onClick={() => onFulfil(r, Number(qty))}
                className="px-2.5 py-1 text-xs btn-primary"
              >
                {busy ? '…' : '拨付'}
              </button>
              <button
                disabled={busy}
                onClick={() => onCancel(r)}
                className="px-2 py-1 text-xs border border-border-strong rounded-lg bg-surface text-ink-muted hover:border-accent transition"
              >
                取消
              </button>
            </div>
          ) : (
            <span className="text-ink-faint text-xs">—</span>
          )}
          {error && <p className="mt-1 text-[11px] text-[#B4402E] max-w-[200px]">{error}</p>}
        </td>
      )}
    </tr>
  );
}

function Sel({ value, onChange, options, full }: { value: string; onChange: (v: string) => void; options: [string, string][]; full?: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent ${full ? 'w-full' : ''}`}
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
