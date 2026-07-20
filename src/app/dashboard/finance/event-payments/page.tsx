// src/app/dashboard/finance/event-payments/page.tsx
// 分会对人 — the branch payment board. A 分会财政 sees only their own centre's
// registrations (server-scoped, not UI-hidden); HQ sees everything with a centre
// filter. Four tabs: 未付 (the chase list) · 已上传证明 (verify here) · 已核实 ·
// 现金已收. Verifying opens the proof, then records the amount actually received.

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { FinanceTabs } from '@/components/finance-chrome';
import { moneyRM } from '@/lib/finance-display';
import { useT } from '@/lib/i18n-react';
import type { TFunc } from '@/lib/i18n';

type Row = {
  id: string; reg_no: string; name: string; phone: string | null;
  centre_id: string | null; centre_name: string | null;
  fee_total: number; paid_amount: number | null; payment_status: string;
  payment_method: string | null; has_proof: boolean; payment_note: string | null;
  verified_at: string | null; reconciled_at: string | null;
};
type Pack = {
  scope: { locked: boolean; centreId: string | null; hq: boolean };
  tabs: { unpaid: Row[]; proof: Row[]; verified: Row[]; cash: Row[] };
  totals: {
    unpaidCount: number; unpaidDue: number; proofCount: number;
    verifiedCount: number; verifiedPaid: number; cashCount: number; cashPaid: number;
  };
};
type EventLite = { id: string; code: string; title: string };
type TabKey = 'unpaid' | 'proof' | 'verified' | 'cash';

const inputCls = 'w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-accent';

async function openProof(regId: string) {
  const r = await fetch(`/api/dashboard/registrations/${regId}/proof-url`);
  const j = await r.json().catch(() => ({}));
  if (j?.url) window.open(j.url, '_blank', 'noopener');
}

export default function EventPaymentsPage() {
  const t = useT();
  return (
    <ErpGate active="finance" module="finance" titleSuffix={t('ep.board.title')}>
      {(me) => <Board me={me} />}
    </ErpGate>
  );
}

function Board({ me }: { me: ErpMe }) {
  const t = useT();
  const canEdit = grantAllows(me.grants, 'finance', 'edit');
  const [events, setEvents] = useState<EventLite[]>([]);
  const [eventId, setEventId] = useState('');
  const [pack, setPack] = useState<Pack | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<TabKey>('proof');
  const [target, setTarget] = useState<Row | null>(null);
  const [err, setErr] = useState('');

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
    fetch(`/api/dashboard/finance/event-payments?event_id=${encodeURIComponent(eventId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setPack(j); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [eventId]);
  useEffect(() => {
    load();
  }, [load]);

  const TABS: { key: TabKey; label: string; n: number }[] = pack
    ? [
        { key: 'unpaid', label: t('ep.board.tab.unpaid'), n: pack.totals.unpaidCount },
        { key: 'proof', label: t('ep.board.tab.proof'), n: pack.totals.proofCount },
        { key: 'verified', label: t('ep.board.tab.verified'), n: pack.totals.verifiedCount },
        { key: 'cash', label: t('ep.board.tab.cash'), n: pack.totals.cashCount },
      ]
    : [];
  const rows = pack ? pack.tabs[tab] : [];

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-xl font-bold font-serif text-ink">{t('ep.board.title')}</h2>
        <span className="text-sm text-ink-faint">{t('ep.board.subtitle')}</span>
      </div>
      <FinanceTabs active="eventpay" />

      <div className="flex flex-wrap items-center gap-2">
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={`${inputCls} w-auto`}>
          {events.length === 0 && <option value="">{t('ep.board.pickEvent')}</option>}
          {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        <span className="flex-1" />
        {pack && (
          <span className="text-sm text-ink-muted">
            {t('ep.board.totalDue')} <b className="text-[#B4402E] tabular-nums">{moneyRM(pack.totals.unpaidDue)}</b>
            <span className="text-ink-faint"> · </span>
            {t('ep.board.totalPaid')} <b className="text-[#3F6B2E] tabular-nums">{moneyRM(pack.totals.verifiedPaid + pack.totals.cashPaid)}</b>
          </span>
        )}
      </div>

      {err && <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-xl px-3 py-2.5">{err}</p>}

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((x) => (
          <button
            key={x.key}
            onClick={() => setTab(x.key)}
            className={`px-3.5 py-2 rounded-lg text-sm border transition ${
              tab === x.key ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border-strong hover:border-accent'
            }`}
          >
            {x.label} <span className="tabular-nums opacity-80">{x.n}</span>
          </button>
        ))}
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">{t('ep.loading')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <th className="px-4 py-2.5 font-normal">{t('ep.board.col.name')}</th>
                  <th className="px-4 py-2.5 font-normal">{t('ep.board.col.centre')}</th>
                  <th className="px-4 py-2.5 font-normal text-right">{t('ep.board.col.due')}</th>
                  <th className="px-4 py-2.5 font-normal text-right">{t('ep.board.col.paid')}</th>
                  <th className="px-4 py-2.5 font-normal">{t('ep.board.col.status')}</th>
                  <th className="px-4 py-2.5 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-muted">{t('ep.empty')}</td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-accent/5">
                      <td className="px-4 py-2.5 text-ink">
                        {r.name}
                        <p className="text-[11px] text-ink-faint font-mono">{r.reg_no}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-muted">{r.centre_name ?? t('ep.board.hqBucket')}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink">{moneyRM(r.fee_total)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[#3F6B2E]">
                        {r.paid_amount == null ? t('ep.none') : moneyRM(r.paid_amount)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[11px] px-2 py-0.5 rounded-full pill-muted">{t(`ep.status.${r.payment_status}`)}</span>
                        {r.payment_method && <span className="ml-1 text-[11px] text-ink-faint">{t(`ep.method.${r.payment_method}`)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {r.has_proof && (
                          <button onClick={() => openProof(r.id)} className="text-xs text-accent-deep hover:underline mr-2">
                            {t('ep.board.viewProof')}
                          </button>
                        )}
                        {canEdit && r.payment_status === 'proof_submitted' && (
                          <button onClick={() => setTarget(r)} className="text-xs btn-primary px-3 py-1.5 rounded-lg">
                            {t('ep.board.verify')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {target && (
        <VerifyModal
          row={target}
          t={t}
          onClose={() => setTarget(null)}
          onDone={() => { setTarget(null); load(); }}
          onErr={setErr}
        />
      )}
    </div>
  );
}

function VerifyModal({ row, t, onClose, onDone, onErr }: {
  row: Row; t: TFunc; onClose: () => void; onDone: () => void; onErr: (m: string) => void;
}) {
  const [amount, setAmount] = useState(String(row.fee_total));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    const a = Number(amount);
    if (!Number.isFinite(a) || a < 0) return setErr(t('ep.err.failed'));
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/finance/event-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', registration_id: row.id, paid_amount: a, note: note.trim() || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? t('ep.err.failed')); onErr(j.error ?? ''); return; }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-ink/45 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-surface w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold font-serif text-ink mb-1">{t('ep.board.verifyTitle')}</h3>
        <p className="text-sm text-ink-muted mb-3">{row.name} · <span className="font-mono text-xs">{row.reg_no}</span></p>
        {err && <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2 mb-2">{err}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">{t('ep.board.verifyAmount')}</label>
            <input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
            <p className="text-[11px] text-ink-faint mt-1">{t('ep.board.verifyHint')}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">{t('ep.board.verifyNote')}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-border-strong rounded-xl bg-surface text-ink">{t('ep.cancel')}</button>
          <button onClick={submit} disabled={busy} className="px-5 py-2 text-sm btn-primary rounded-xl disabled:opacity-50">
            {busy ? t('ep.saving') : t('ep.board.verify')}
          </button>
        </div>
      </div>
    </div>
  );
}
