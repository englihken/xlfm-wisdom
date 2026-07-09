// src/app/dashboard/inventory/requests/page.tsx
// 分会申请 — the 023 approval pipeline in 3 columns: 待审批 → 已批准·备货中 → 已发放.
//   审批 (admin): approve a qty (≤ requested; a reason is required when reduced) or 婉拒 (reason
//     required). Approval moves NO stock.
//   发放 (edit): release ≤ the approved remainder with a REQUIRED 存证 photo → creates the
//     总会→分会 transfer and advances the request. Only 发放 deducts stock.
//   取消 (edit): closes the remainder (released stock untouched). ↩撤销 (edit): reverses a
//     release movement via the 更正撤销 API. Rejected/cancelled cards show their reason.
// Global search + item drawer + tabs shared across all 库存 pages.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { InventoryTabs, GlobalItemSearch, type SearchItem } from '@/components/inventory-chrome';
import { InventoryItemDrawer } from '@/components/inventory-item-drawer';
import { REQUEST_STATUS_LABELS, REQUEST_STATUS_STYLES } from '@/lib/inventory-display';

type Lite<T> = T | T[] | null;
type RequestRow = {
  id: string;
  qty_requested: number;
  qty_approved: number | null;
  qty_fulfilled: number;
  status: string;
  approve_reason: string | null;
  rejected_reason: string | null;
  note: string | null;
  requested_at: string;
  centre: Lite<{ id: string; code: string; name_cn: string }>;
  item: Lite<{ id: string; stock_id: string | null; name_cn: string; pack_qty: number | null }>;
  event: Lite<{ id: string; code: string; title: string }>;
};

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default function RequestsPage() {
  return (
    <ErpGate active="inventory" module="inventory" titleSuffix="分会申请">
      {(me) => <RequestsPipeline me={me} />}
    </ErpGate>
  );
}

type Modal =
  | { kind: 'approve'; req: RequestRow }
  | { kind: 'reject'; req: RequestRow }
  | { kind: 'release'; req: RequestRow }
  | null;

function RequestsPipeline({ me }: { me: ErpMe }) {
  const canEdit = grantAllows(me.grants, 'inventory', 'edit');
  const canApprove = grantAllows(me.grants, 'inventory', 'admin');

  const [rows, setRows] = useState<RequestRow[]>([]);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Modal>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/dashboard/inventory/requests?limit=200')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) setRows(j.requests ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/inventory/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (active && meta) setItems(meta.items ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const cols = useMemo(() => {
    const pending = rows.filter((r) => r.status === 'pending');
    const prep = rows.filter((r) => r.status === 'approved' || r.status === 'partial');
    const done = rows.filter((r) => r.status === 'fulfilled');
    const closed = rows.filter((r) => r.status === 'rejected' || r.status === 'cancelled');
    return { pending, prep, done, closed };
  }, [rows]);

  const onDone = () => {
    setModal(null);
    load();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold font-serif text-ink">📦 分会申请</h2>
        <span className="text-sm text-ink-faint">Requests · {rows.length}</span>
      </div>

      <GlobalItemSearch items={items} onPick={setDrawerId} />
      <InventoryTabs active="requests" />

      {loading ? (
        <p className="p-6 text-sm text-ink-muted">加载中…</p>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-3.5 items-start">
            <Column title="① 待审批" count={cols.pending.length}>
              {cols.pending.map((r) => (
                <Card key={r.id} r={r} onItem={setDrawerId}>
                  {canApprove ? (
                    <>
                      <button onClick={() => setModal({ kind: 'approve', req: r })} className="px-2.5 py-1 text-xs btn-primary">✓ 审批</button>
                      <button onClick={() => setModal({ kind: 'reject', req: r })} className="px-2.5 py-1 text-xs border border-[#E5C4BF] text-[#B4402E] rounded-lg bg-surface hover:border-[#B4402E] transition">婉拒</button>
                    </>
                  ) : (
                    <span className="text-[11px] text-ink-faint">待管理员审批</span>
                  )}
                </Card>
              ))}
              {cols.pending.length === 0 && <Empty />}
            </Column>

            <Column title="② 已批准 · 备货中" count={cols.prep.length}>
              {cols.prep.map((r) => (
                <Card key={r.id} r={r} onItem={setDrawerId} showApproved>
                  {canEdit && (
                    <>
                      <button onClick={() => setModal({ kind: 'release', req: r })} className="px-2.5 py-1 text-xs btn-primary">📷 发放</button>
                      <CancelBtn req={r} onDone={load} />
                    </>
                  )}
                </Card>
              ))}
              {cols.prep.length === 0 && <Empty />}
            </Column>

            <Column title="③ 已发放" count={cols.done.length}>
              {cols.done.map((r) => (
                <Card key={r.id} r={r} onItem={setDrawerId} showApproved>
                  <Releases req={r} canEdit={canEdit} onReversed={load} />
                </Card>
              ))}
              {cols.done.length === 0 && <Empty />}
            </Column>
          </div>

          {cols.closed.length > 0 && (
            <div className="bg-surface border border-border rounded-2xl p-4">
              <h3 className="text-sm font-semibold text-ink mb-2">已结案（未批准 / 已取消）</h3>
              <div className="space-y-1.5">
                {cols.closed.map((r) => {
                  const centre = one(r.centre);
                  const item = one(r.item);
                  return (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-ink-muted border-b border-dashed border-border pb-1.5 last:border-b-0">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${REQUEST_STATUS_STYLES[r.status] ?? ''}`}>{REQUEST_STATUS_LABELS[r.status]}</span>
                      <span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[11px]">{centre?.name_cn ?? '–'}</span>
                      <span className="text-ink">{item?.name_cn}</span>
                      <span>申请 {r.qty_requested}</span>
                      {r.rejected_reason && <span className="text-[#B4402E]">· 原因：{r.rejected_reason}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {modal?.kind === 'approve' && <ApproveModal req={modal.req} onClose={() => setModal(null)} onDone={onDone} />}
      {modal?.kind === 'reject' && <RejectModal req={modal.req} onClose={() => setModal(null)} onDone={onDone} />}
      {modal?.kind === 'release' && <ReleaseModal req={modal.req} onClose={() => setModal(null)} onDone={onDone} />}

      <InventoryItemDrawer itemId={drawerId} onClose={() => setDrawerId(null)} canEdit={canEdit} />
    </div>
  );
}

function Column({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-surface-soft border border-border rounded-2xl p-3">
      <h4 className="text-[13px] font-semibold text-ink flex justify-between items-center mb-2.5">
        <span>{title}</span>
        <span className="bg-surface border border-border rounded-full px-2 py-0.5 text-[11px] text-ink-muted">{count}</span>
      </h4>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-ink-faint px-1 py-2">暂无</p>;
}

function Card({ r, children, onItem, showApproved }: { r: RequestRow; children?: React.ReactNode; onItem: (id: string) => void; showApproved?: boolean }) {
  const centre = one(r.centre);
  const item = one(r.item);
  const ev = one(r.event);
  const remainder = (r.qty_approved ?? 0) - r.qty_fulfilled;
  return (
    <div className="bg-surface border border-border rounded-xl p-3 mb-2.5">
      <div className="flex justify-between gap-1.5">
        <span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[11px]">{centre?.name_cn ?? '–'}</span>
        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${REQUEST_STATUS_STYLES[r.status] ?? ''}`}>{REQUEST_STATUS_LABELS[r.status]}</span>
      </div>
      <button onClick={() => item && onItem(item.id)} className="block text-left font-semibold text-ink mt-1.5 hover:text-accent-deep">
        {item?.name_cn ?? '–'}
      </button>
      <div className="text-[11.5px] text-ink-muted mt-1 leading-relaxed">
        {showApproved ? (
          <>批准 <b className="text-ink">{(r.qty_approved ?? 0).toLocaleString()}</b> · 已发 {r.qty_fulfilled.toLocaleString()}{remainder > 0 && <> · 还欠 <b className="text-accent-deep">{remainder.toLocaleString()}</b></>}</>
        ) : (
          <>申请 <b className="text-ink">{r.qty_requested.toLocaleString()}</b> 件</>
        )}
        {ev && <div className="font-mono text-[10px] text-ink-faint mt-0.5">{ev.code}</div>}
        {r.approve_reason && <div className="text-[10.5px] text-ink-faint mt-0.5">批注：{r.approve_reason}</div>}
        {r.note && <div className="text-ink-faint mt-0.5">{r.note}</div>}
      </div>
      <div className="flex gap-1.5 mt-2.5 flex-wrap">{children}</div>
    </div>
  );
}

function CancelBtn({ req, onDone }: { req: RequestRow; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    setBusy(true);
    try {
      await fetch(`/api/dashboard/inventory/requests/${req.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button disabled={busy} onClick={cancel} className="px-2 py-1 text-xs border border-border-strong rounded-lg bg-surface text-ink-muted hover:border-accent transition">
      {busy ? '…' : '取消余量'}
    </button>
  );
}

// ---- release movements (photo thumbnail + 撤销) under a 已发放 card ----
type ReleaseMv = { id: string; qty: number; moved_at: string; photo_path: string | null; reversal_of: string | null };

function Releases({ req, canEdit, onReversed }: { req: RequestRow; canEdit: boolean; onReversed: () => void }) {
  const [mvs, setMvs] = useState<ReleaseMv[]>([]);
  const [busyId, setBusyId] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    fetch(`/api/dashboard/inventory/movements?request_id=${req.id}&limit=50`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) setMvs((j.movements ?? []).map((m: ReleaseMv) => ({ id: m.id, qty: m.qty, moved_at: m.moved_at, photo_path: m.photo_path, reversal_of: m.reversal_of })));
      })
      .catch(() => {});
  }, [req.id]);

  useEffect(() => {
    load();
  }, [load]);

  const reverse = async (id: string) => {
    setErr('');
    setBusyId(id);
    try {
      const res = await fetch(`/api/dashboard/inventory/movements/${id}/reverse`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? '撤销失败');
      else {
        load();
        onReversed();
      }
    } finally {
      setBusyId('');
    }
  };

  const reversedIds = new Set(mvs.filter((m) => m.reversal_of).map((m) => m.reversal_of));

  return (
    <div className="w-full">
      {mvs.filter((m) => !m.reversal_of).map((m) => {
        const isReversed = reversedIds.has(m.id);
        return (
          <div key={m.id} className="flex items-center gap-2 text-[11.5px] text-ink-muted py-1">
            {m.photo_path && <MediaThumb path={m.photo_path} />}
            <span className="tabular-nums">发放 {m.qty.toLocaleString()} · {m.moved_at}</span>
            {isReversed ? (
              <span className="text-ink-faint">（已退回）</span>
            ) : (
              canEdit && (
                <button disabled={busyId === m.id} onClick={() => reverse(m.id)} className="ml-auto text-accent-deep hover:underline">
                  {busyId === m.id ? '…' : '↩ 退回/撤销'}
                </button>
              )
            )}
          </div>
        );
      })}
      {err && <p className="text-[11px] text-[#B4402E] mt-1">{err}</p>}
    </div>
  );
}

function MediaThumb({ path }: { path: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    fetch(`/api/dashboard/inventory/media-url?path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j?.url) setUrl(j.url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [path]);
  if (!url) return <span className="w-8 h-8 rounded bg-surface-soft border border-border grid place-items-center text-xs">📷</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="存证" className="w-8 h-8 rounded object-cover border border-border" />;
}

// ---------------- modals ----------------
function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] bg-ink/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-ink mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ErrLine({ msg }: { msg: string }) {
  return msg ? <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2 mb-2">{msg}</p> : null;
}

function ApproveModal({ req, onClose, onDone }: { req: RequestRow; onClose: () => void; onDone: () => void }) {
  const item = one(req.item);
  const [qty, setQty] = useState(String(req.qty_requested));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const reduced = Number(qty) < req.qty_requested;

  const submit = async () => {
    setErr('');
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1) return setErr('批准数量须为大于 0 的整数');
    if (n < req.qty_requested && !reason.trim()) return setErr('批准数量少于申请数量时，请填写原因');
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard/inventory/requests/${req.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty_approved: n, reason: reason.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? '批准失败');
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`审批 · ${item?.name_cn ?? ''}`} onClose={onClose}>
      <ErrLine msg={err} />
      <p className="text-xs text-ink-muted mb-2">申请数量 {req.qty_requested.toLocaleString()}。批准即授权后续发放，但不会移动库存。</p>
      <label className="block text-xs text-ink-muted mb-1">批准数量</label>
      <input type="number" min={1} max={req.qty_requested} value={qty} onChange={(e) => setQty(e.target.value)}
        className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent tabular-nums mb-2" />
      {reduced && (
        <>
          <label className="block text-xs text-ink-muted mb-1">原因（批少必填）</label>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent mb-2" />
        </>
      )}
      <div className="flex gap-2 justify-end mt-2">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? '提交中…' : '确认批准'}</button>
      </div>
    </ModalShell>
  );
}

function RejectModal({ req, onClose, onDone }: { req: RequestRow; onClose: () => void; onDone: () => void }) {
  const item = one(req.item);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr('');
    if (!reason.trim()) return setErr('请填写婉拒原因');
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard/inventory/requests/${req.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? '操作失败');
      else onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell title={`婉拒 · ${item?.name_cn ?? ''}`} onClose={onClose}>
      <ErrLine msg={err} />
      <label className="block text-xs text-ink-muted mb-1">原因（必填，分会可见）</label>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
        className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent mb-2" />
      <div className="flex gap-2 justify-end mt-2">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm border border-[#E5C4BF] text-[#B4402E] rounded-lg bg-surface hover:border-[#B4402E]">{busy ? '提交中…' : '确认婉拒'}</button>
      </div>
    </ModalShell>
  );
}

function ReleaseModal({ req, onClose, onDone }: { req: RequestRow; onClose: () => void; onDone: () => void }) {
  const item = one(req.item);
  const remainder = (req.qty_approved ?? 0) - req.qty_fulfilled;
  const [qty, setQty] = useState(String(remainder));
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1) return setErr('发放数量须为大于 0 的整数');
    if (n > remainder) return setErr(`发放数量超过已批准余量（剩余 ${remainder} 件）`);
    if (!file) return setErr('请拍摄/选择发放存证照片');
    setBusy(true);
    try {
      // 1) upload the photo → path
      const fd = new FormData();
      fd.append('file', file);
      const up = await fetch('/api/dashboard/inventory/upload?kind=photo', { method: 'POST', body: fd });
      const uj = await up.json().catch(() => ({}));
      if (!up.ok || !uj.path) {
        setErr(uj.error ?? '照片上传失败');
        setBusy(false);
        return;
      }
      // 2) release
      const res = await fetch(`/api/dashboard/inventory/requests/${req.id}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty: n, photo_path: uj.path }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? '发放失败');
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`发放 · ${item?.name_cn ?? ''}`} onClose={onClose}>
      <ErrLine msg={err} />
      <p className="text-xs text-ink-muted mb-2">已批准余量 {remainder.toLocaleString()} 件。发放会从总会仓库调拨到分会，并扣减库存。</p>
      <label className="block text-xs text-ink-muted mb-1">发放数量</label>
      <input type="number" min={1} max={remainder} value={qty} onChange={(e) => setQty(e.target.value)}
        className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent tabular-nums mb-2" />
      <label className="block text-xs text-ink-muted mb-1">存证照片（必传）</label>
      <input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="w-full text-xs text-ink-muted mb-2 file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border-strong file:bg-surface file:text-ink" />
      <div className="flex gap-2 justify-end mt-2">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? '发放中…' : '确认发放'}</button>
      </div>
    </ModalShell>
  );
}
