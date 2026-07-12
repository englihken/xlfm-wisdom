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

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { InventoryTabs, InventorySearchRow, ItemPicker, type SearchItem } from '@/components/inventory-chrome';
import { InventoryItemDrawer } from '@/components/inventory-item-drawer';
import { REQUEST_STATUS_STYLES } from '@/lib/inventory-display';
import { useT } from '@/lib/i18n-react';

type Lite<T> = T | T[] | null;
type Centre = { id: string; code: string; name_cn: string };
type EventLite = { id: string; code: string; title: string };
type MetaItem = { id: string; stock_id: string | null; name_cn: string };
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
  const t = useT();
  return (
    <ErpGate active="inventory" module="inventory" titleSuffix={t('inv.suffix.requests')}>
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
  const t = useT();
  const canEdit = grantAllows(me.grants, 'inventory', 'edit');
  const canApprove = grantAllows(me.grants, 'inventory', 'admin');

  const [rows, setRows] = useState<RequestRow[]>([]);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [events, setEvents] = useState<EventLite[]>([]);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Modal>(null);
  const [showCreate, setShowCreate] = useState(false);
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
    // Inventory meta (items, events) + centres (the request is per-centre). erp/meta needs
    // members:view — inventory-only accounts fall back to deriving centres from the inventory
    // locations (kind='centre'), exactly like the v1 create form did.
    Promise.all([
      fetch('/api/dashboard/inventory/meta').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/dashboard/erp/meta').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([inv, erp]) => {
      if (!active) return;
      if (inv) {
        setItems(inv.items ?? []);
        setEvents(inv.events ?? []);
      }
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
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold font-serif text-ink">{t('inv.req.title')}</h2>
          <span className="text-sm text-ink-faint">Requests · {rows.length}</span>
        </div>
        {canEdit && (
          <button onClick={() => setShowCreate(true)} className="px-4 py-1.5 text-sm btn-primary">{t('inv.req.createBtn')}</button>
        )}
      </div>

      <InventorySearchRow items={items} onPick={setDrawerId} />
      <InventoryTabs active="requests" />

      {loading ? (
        <p className="p-6 text-sm text-ink-muted">{t('inv.loading')}</p>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-3.5 items-start">
            <Column title={t('inv.req.col1')} count={cols.pending.length}>
              {cols.pending.map((r) => (
                <Card key={r.id} r={r} onItem={setDrawerId}>
                  {canApprove ? (
                    <>
                      <button onClick={() => setModal({ kind: 'approve', req: r })} className="px-2.5 py-1 text-xs btn-primary">{t('inv.req.approveBtn')}</button>
                      <button onClick={() => setModal({ kind: 'reject', req: r })} className="px-2.5 py-1 text-xs border border-[#E5C4BF] text-[#B4402E] rounded-lg bg-surface hover:border-[#B4402E] transition">{t('inv.req.rejectBtn')}</button>
                    </>
                  ) : (
                    <span className="text-[11px] text-ink-faint">{t('inv.req.waitAdmin')}</span>
                  )}
                </Card>
              ))}
              {cols.pending.length === 0 && <Empty />}
            </Column>

            <Column title={t('inv.req.col2')} count={cols.prep.length}>
              {cols.prep.map((r) => (
                <Card key={r.id} r={r} onItem={setDrawerId} showApproved>
                  {canEdit && (
                    <>
                      <button onClick={() => setModal({ kind: 'release', req: r })} className="px-2.5 py-1 text-xs btn-primary">{t('inv.req.releaseBtn')}</button>
                      <CancelBtn req={r} onDone={load} />
                    </>
                  )}
                </Card>
              ))}
              {cols.prep.length === 0 && <Empty />}
            </Column>

            <Column title={t('inv.req.col3')} count={cols.done.length}>
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
              <h3 className="text-sm font-semibold text-ink mb-2">{t('inv.req.closedTitle')}</h3>
              <div className="space-y-1.5">
                {cols.closed.map((r) => {
                  const centre = one(r.centre);
                  const item = one(r.item);
                  return (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-ink-muted border-b border-dashed border-border pb-1.5 last:border-b-0">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${REQUEST_STATUS_STYLES[r.status] ?? ''}`}>{t(`inv.reqStatus.${r.status}`)}</span>
                      <span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[11px]">{centre?.name_cn ?? '–'}</span>
                      <span className="text-ink">{item?.name_cn}</span>
                      <span>{t('inv.req.requested', { n: r.qty_requested })}</span>
                      {r.rejected_reason && <span className="text-[#B4402E]">{t('inv.req.reasonInline', { reason: r.rejected_reason })}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateRequestModal
          centres={centres}
          items={items}
          events={events}
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            load();
          }}
        />
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
  const t = useT();
  return <p className="text-xs text-ink-faint px-1 py-2">{t('inv.req.empty')}</p>;
}

function Card({ r, children, onItem, showApproved }: { r: RequestRow; children?: React.ReactNode; onItem: (id: string) => void; showApproved?: boolean }) {
  const t = useT();
  const centre = one(r.centre);
  const item = one(r.item);
  const ev = one(r.event);
  const remainder = (r.qty_approved ?? 0) - r.qty_fulfilled;
  return (
    <div className="bg-surface border border-border rounded-xl p-3 mb-2.5">
      <div className="flex justify-between gap-1.5">
        <span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[11px]">{centre?.name_cn ?? '–'}</span>
        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${REQUEST_STATUS_STYLES[r.status] ?? ''}`}>{t(`inv.reqStatus.${r.status}`)}</span>
      </div>
      <button onClick={() => item && onItem(item.id)} className="block text-left font-semibold text-ink mt-1.5 hover:text-accent-deep">
        {item?.name_cn ?? '–'}
      </button>
      <div className="text-[11.5px] text-ink-muted mt-1 leading-relaxed">
        {showApproved ? (
          remainder > 0
            ? t('inv.req.approvedFulfilledOwing', { approved: (r.qty_approved ?? 0).toLocaleString(), fulfilled: r.qty_fulfilled.toLocaleString(), owing: remainder.toLocaleString() })
            : t('inv.req.approvedFulfilled', { approved: (r.qty_approved ?? 0).toLocaleString(), fulfilled: r.qty_fulfilled.toLocaleString() })
        ) : (
          t('inv.req.requestedPieces', { n: r.qty_requested.toLocaleString() })
        )}
        {ev && <div className="font-mono text-[10px] text-ink-faint mt-0.5">{ev.code}</div>}
        {r.approve_reason && <div className="text-[10.5px] text-ink-faint mt-0.5">{t('inv.req.annotation', { reason: r.approve_reason })}</div>}
        {r.note && <div className="text-ink-faint mt-0.5">{r.note}</div>}
      </div>
      <div className="flex gap-1.5 mt-2.5 flex-wrap">{children}</div>
    </div>
  );
}

function CancelBtn({ req, onDone }: { req: RequestRow; onDone: () => void }) {
  const t = useT();
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
      {busy ? '…' : t('inv.req.cancelRemainder')}
    </button>
  );
}

// ---- release movements (photo thumbnail + 撤销) under a 已发放 card ----
type ReleaseMv = { id: string; qty: number; moved_at: string; photo_path: string | null; reversal_of: string | null };

function Releases({ req, canEdit, onReversed }: { req: RequestRow; canEdit: boolean; onReversed: () => void }) {
  const t = useT();
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
      if (!res.ok) setErr(j.error ?? t('inv.reverseFailed'));
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
            <span className="tabular-nums">{t('inv.req.releasedLine', { qty: m.qty.toLocaleString(), date: m.moved_at })}</span>
            {isReversed ? (
              <span className="text-ink-faint">{t('inv.req.returnedTag')}</span>
            ) : (
              canEdit && (
                <button disabled={busyId === m.id} onClick={() => reverse(m.id)} className="ml-auto text-accent-deep hover:underline">
                  {busyId === m.id ? '…' : t('inv.req.reverseRelease')}
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
  const t = useT();
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
  return <img src={url} alt={t('inv.req.evidenceAlt')} className="w-8 h-8 rounded object-cover border border-border" />;
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
  const t = useT();
  const item = one(req.item);
  const [qty, setQty] = useState(String(req.qty_requested));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const reduced = Number(qty) < req.qty_requested;

  const submit = async () => {
    setErr('');
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1) return setErr(t('inv.req.errApproveQty'));
    if (n < req.qty_requested && !reason.trim()) return setErr(t('inv.req.errReasonRequired'));
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard/inventory/requests/${req.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty_approved: n, reason: reason.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? t('inv.req.approveFailed'));
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={t('inv.req.approveModalTitle', { name: item?.name_cn ?? '' })} onClose={onClose}>
      <ErrLine msg={err} />
      <p className="text-xs text-ink-muted mb-2">{t('inv.req.approveHint', { n: req.qty_requested.toLocaleString() })}</p>
      <label className="block text-xs text-ink-muted mb-1">{t('inv.req.approveQtyLabel')}</label>
      <input type="number" min={1} max={req.qty_requested} value={qty} onChange={(e) => setQty(e.target.value)}
        className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent tabular-nums mb-2" />
      {reduced && (
        <>
          <label className="block text-xs text-ink-muted mb-1">{t('inv.req.reasonReducedLabel')}</label>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent mb-2" />
        </>
      )}
      <div className="flex gap-2 justify-end mt-2">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('inv.cancel')}</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? t('inv.submitting') : t('inv.req.confirmApprove')}</button>
      </div>
    </ModalShell>
  );
}

function RejectModal({ req, onClose, onDone }: { req: RequestRow; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const item = one(req.item);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr('');
    if (!reason.trim()) return setErr(t('inv.req.errRejectReason'));
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard/inventory/requests/${req.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? t('inv.opFailed'));
      else onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell title={t('inv.req.rejectModalTitle', { name: item?.name_cn ?? '' })} onClose={onClose}>
      <ErrLine msg={err} />
      <label className="block text-xs text-ink-muted mb-1">{t('inv.req.rejectReasonLabel')}</label>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
        className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent mb-2" />
      <div className="flex gap-2 justify-end mt-2">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('inv.cancel')}</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm border border-[#E5C4BF] text-[#B4402E] rounded-lg bg-surface hover:border-[#B4402E]">{busy ? t('inv.submitting') : t('inv.req.confirmReject')}</button>
      </div>
    </ModalShell>
  );
}

function ReleaseModal({ req, onClose, onDone }: { req: RequestRow; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const item = one(req.item);
  const remainder = (req.qty_approved ?? 0) - req.qty_fulfilled;
  const [qty, setQty] = useState(String(remainder));
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1) return setErr(t('inv.req.errReleaseQty'));
    if (n > remainder) return setErr(t('inv.req.errReleaseExceed', { n: remainder }));
    if (!file) return setErr(t('inv.req.errPhotoRequired'));
    setBusy(true);
    try {
      // 1) upload the photo → path
      const fd = new FormData();
      fd.append('file', file);
      const up = await fetch('/api/dashboard/inventory/upload?kind=photo', { method: 'POST', body: fd });
      const uj = await up.json().catch(() => ({}));
      if (!up.ok || !uj.path) {
        setErr(uj.error ?? t('inv.photoUploadFailed'));
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
      if (!res.ok) setErr(j.error ?? t('inv.req.releaseFailed'));
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={t('inv.req.releaseModalTitle', { name: item?.name_cn ?? '' })} onClose={onClose}>
      <ErrLine msg={err} />
      <p className="text-xs text-ink-muted mb-2">{t('inv.req.releaseHint', { n: remainder.toLocaleString() })}</p>
      <label className="block text-xs text-ink-muted mb-1">{t('inv.req.releaseQtyLabel')}</label>
      <input type="number" min={1} max={remainder} value={qty} onChange={(e) => setQty(e.target.value)}
        className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent tabular-nums mb-2" />
      <label className="block text-xs text-ink-muted mb-1">{t('inv.req.evidenceLabel')}</label>
      <input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="w-full text-xs text-ink-muted mb-2 file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border-strong file:bg-surface file:text-ink" />
      <div className="flex gap-2 justify-end mt-2">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('inv.cancel')}</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? t('inv.req.releasing') : t('inv.req.confirmRelease')}</button>
      </div>
    </ModalShell>
  );
}

function CreateRequestModal({
  centres,
  items,
  events,
  onClose,
  onDone,
}: {
  centres: Centre[];
  items: MetaItem[];
  events: EventLite[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [centre, setCentre] = useState('');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('');
  const [eventId, setEventId] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    if (!centre) return setErr(t('inv.req.errCentre'));
    if (!itemId) return setErr(t('inv.errPickItem'));
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) return setErr(t('inv.req.errRequestQty'));
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/inventory/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centre_id: centre, item_id: itemId, qty_requested: n, event_id: eventId || null, note }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? t('inv.req.createFailed'));
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={t('inv.req.createTitle')} onClose={onClose}>
      <ErrLine msg={err} />
      <label className="block text-xs text-ink-muted mb-1">{t('inv.req.centreLabel')}</label>
      <select value={centre} onChange={(e) => setCentre(e.target.value)}
        className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent mb-2">
        <option value="">{t('inv.selectPlaceholder')}</option>
        {centres.map((c) => <option key={c.id} value={c.id}>{c.name_cn}</option>)}
      </select>

      <label className="block text-xs text-ink-muted mb-1">{t('inv.field.item')}</label>
      <div className="mb-2">
        <ItemPicker items={items} value={itemId} onChange={setItemId} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-ink-muted mb-1">{t('inv.req.requestQtyLabel')}</label>
          <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)}
            className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent tabular-nums" />
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">{t('inv.field.eventOptional')}</label>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}
            className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent">
            <option value="">{t('inv.none')}</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.code} {e.title}</option>)}
          </select>
        </div>
      </div>

      <label className="block text-xs text-ink-muted mb-1 mt-2">{t('inv.field.remarkOptional')}</label>
      <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
        className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent mb-2" />

      <div className="flex gap-2 justify-end mt-2">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('inv.cancel')}</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? t('inv.submitting') : t('inv.req.submitRequest')}</button>
      </div>
    </ModalShell>
  );
}
