// src/app/dashboard/finance/reconcile/page.tsx
// 总会对账 — HQ ticks verified transfers against the bank statement. Batch select,
// one 对账 action, optionally posting the batch total to an HQ account in the same
// step. Cash never appears here: banking the 日结 IS its reconciliation.
//
// HQ-only. The page probes the endpoint rather than guessing from the role, so
// the server stays the single source of truth on who may reconcile.

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { FinanceTabs } from '@/components/finance-chrome';
import { moneyRM } from '@/lib/finance-display';
import { sumCents, fromCents } from '@/lib/event-payments';
import { useT } from '@/lib/i18n-react';

type Row = {
  id: string; reg_no: string; name: string; centre_name: string | null;
  fee_total: number; paid_amount: number; payment_note: string | null; verified_at: string | null;
};
type Pack = { rows: Row[]; total: number; hqAccounts: { id: string; name: string; kind: string }[] };
type EventLite = { id: string; code: string; title: string };

const inputCls = 'rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-accent';

export default function ReconcilePage() {
  const t = useT();
  return (
    <ErpGate active="finance" module="finance" titleSuffix={t('ep.rec.title')}>
      {(me) => <Reconcile me={me} />}
    </ErpGate>
  );
}

function Reconcile({ me }: { me: ErpMe }) {
  const t = useT();
  const canEdit = grantAllows(me.grants, 'finance', 'edit');
  const [events, setEvents] = useState<EventLite[]>([]);
  const [eventId, setEventId] = useState('');
  const [pack, setPack] = useState<Pack | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [post, setPost] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');

  useEffect(() => {
    fetch('/api/dashboard/events?limit=50')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const list = (j?.events ?? []) as EventLite[];
        setEvents(list);
        setEventId((c) => c || list[0]?.id || '');
      })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!eventId) return;
    setLoading(true);
    fetch(`/api/dashboard/finance/reconcile?event_id=${encodeURIComponent(eventId)}`)
      .then(async (r) => {
        if (r.status === 403) { setDenied(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((j: Pack | null) => {
        if (!j) return;
        setDenied(false);
        setPack(j);
        setPicked(new Set());
        setAccountId((c) => c || j.hqAccounts[0]?.id || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  // Memoized so the identity is stable — a fresh `?? []` each render would make
  // the selected-total memo below recompute on every keystroke elsewhere.
  const rows = useMemo(() => pack?.rows ?? [], [pack]);
  const selectedTotal = useMemo(
    () => fromCents(sumCents(rows.filter((r) => picked.has(r.id)).map((r) => r.paid_amount))),
    [rows, picked]
  );
  const allPicked = rows.length > 0 && picked.size === rows.length;

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const submit = async () => {
    setErr(''); setFlash('');
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/finance/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registration_ids: [...picked],
          account_id: post && accountId ? accountId : undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? t('ep.err.failed')); return; }
      const parts = [t('ep.rec.done', { n: j.reconciled ?? 0 })];
      if (j.rejected) parts.push(t('ep.rec.rejected', { n: j.rejected }));
      if (j.warning) parts.push(t('ep.rec.warnNoPost'));
      setFlash(parts.join(' · '));
      load();
    } finally { setBusy(false); }
  };

  if (denied) {
    return (
      <div className={`${PAGE_WIDE} space-y-4`}>
        <h2 className="text-xl font-bold font-serif text-ink">{t('ep.rec.title')}</h2>
        <FinanceTabs active="reconcile" />
        <p className="text-sm text-ink-muted bg-surface border border-border rounded-2xl p-6">{t('ep.rec.hqOnly')}</p>
      </div>
    );
  }

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-xl font-bold font-serif text-ink">{t('ep.rec.title')}</h2>
        <span className="text-sm text-ink-faint">{t('ep.rec.subtitle')}</span>
      </div>
      <FinanceTabs active="reconcile" />

      <div className="flex flex-wrap items-center gap-2">
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={inputCls}>
          {events.length === 0 && <option value="">{t('ep.board.pickEvent')}</option>}
          {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        <span className="flex-1" />
        {pack && <span className="text-sm text-ink-muted">{t('ep.total')} <b className="text-ink tabular-nums">{moneyRM(pack.total)}</b></span>}
      </div>

      {flash && <p className="text-sm text-[#3F6B2E] bg-[#E7F0E0] border border-[#3F6B2E]/20 rounded-xl px-3 py-2.5">{flash}</p>}
      {err && <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-xl px-3 py-2.5">{err}</p>}

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">{t('ep.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-sm text-ink-muted text-center">{t('ep.rec.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <th className="px-4 py-2.5 font-normal w-10">
                    <input type="checkbox" checked={allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)))}
                      aria-label={t('ep.rec.selectAll')} />
                  </th>
                  <th className="px-4 py-2.5 font-normal">{t('ep.board.col.name')}</th>
                  <th className="px-4 py-2.5 font-normal">{t('ep.board.col.centre')}</th>
                  <th className="px-4 py-2.5 font-normal text-right">{t('ep.board.col.paid')}</th>
                  <th className="px-4 py-2.5 font-normal">{t('ep.board.verifyNote')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`border-b border-border last:border-b-0 ${picked.has(r.id) ? 'bg-accent/5' : ''}`}>
                    <td className="px-4 py-2.5">
                      <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={r.reg_no} />
                    </td>
                    <td className="px-4 py-2.5 text-ink">
                      {r.name}
                      <p className="text-[11px] text-ink-faint font-mono">{r.reg_no}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">{r.centre_name ?? t('ep.board.hqBucket')}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">{moneyRM(r.paid_amount)}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-faint">{r.payment_note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canEdit && rows.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
          <p className="text-sm text-ink">{t('ep.rec.selected', { n: picked.size, amount: moneyRM(selectedTotal) })}</p>
          {pack!.hqAccounts.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={post} onChange={(e) => setPost(e.target.checked)} />
              {t('ep.rec.postToo')}
            </label>
          )}
          {post && (
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`${inputCls} w-full`}>
              {pack!.hqAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <button onClick={submit} disabled={busy || picked.size === 0} className="w-full btn-primary py-2.5 rounded-xl disabled:opacity-50">
            {busy ? t('ep.saving') : t('ep.rec.submit')}
          </button>
        </div>
      )}

      <p className="text-xs text-ink-faint">{t('ep.rec.footer')}</p>
    </div>
  );
}
