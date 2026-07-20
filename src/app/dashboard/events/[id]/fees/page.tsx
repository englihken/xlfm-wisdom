// src/app/dashboard/events/[id]/fees/page.tsx
// 费用分配 (活动收款 Phase 1) — set the per-person amount for an 'assigned' fee
// item after room allocation. One row per room type, because room type is what
// encodes occupancy; the admin types one number per group.
//
// Everything protective happens server-side (settled rows untouched, waived→unpaid
// flip, no downward re-price on a row that has paid). This page only reports what
// the server decided, including the needs-review list.

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ErpGate } from '@/components/erp-gate';
import { moneyRM } from '@/lib/finance-display';
import { UNASSIGNED_ROOM_TYPE } from '@/lib/event-payments';
import { useT } from '@/lib/i18n-react';

type Group = { key: string; pax: number | null; count: number; settled: number; amounts: number[] };
type Pack = {
  assignedItems: { item: string; label: string | null; amount: number }[];
  groups: Group[];
  totalPriceable: number;
  hasAssignedItem: boolean;
};
type Review = { registration_id: string; reg_no: string; reason: string };

const inputCls = 'w-full rounded-xl border border-border-strong bg-surface px-3 py-2 text-ink outline-none focus:border-accent';

export default function EventFeesPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  return (
    <ErpGate active="events" module="events" titleSuffix={t('ep.assign.title')}>
      {() => <Assign id={id} />}
    </ErpGate>
  );
}

function Assign({ id }: { id: string }) {
  const t = useT();
  const [pack, setPack] = useState<Pack | null>(null);
  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [review, setReview] = useState<Review[]>([]);

  const load = useCallback(() => {
    fetch(`/api/dashboard/events/${id}/fees/assign`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Pack | null) => {
        if (!j) return;
        setPack(j);
        setItem((cur) => cur || j.assignedItems[0]?.item || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const groupLabel = (g: Group) =>
    g.key === UNASSIGNED_ROOM_TYPE ? t('ep.assign.groupNone') : g.key;

  const submit = async () => {
    setErr('');
    setFlash('');
    const groups = Object.entries(amounts)
      .filter(([, v]) => v.trim() !== '')
      .map(([key, v]) => ({ key, amount: Number(v) }));
    if (groups.length === 0) return setErr(t('ep.assign.confirm', { n: 0 }));
    if (groups.some((g) => !Number.isFinite(g.amount) || g.amount < 0)) return setErr(t('ep.err.failed'));
    if (!window.confirm(t('ep.assign.confirm', { n: groups.length }))) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard/events/${id}/fees/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, groups }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? t('ep.err.failed'));
        return;
      }
      setFlash(t('ep.assign.done', { updated: j.updated ?? 0, flipped: j.flipped ?? 0 }));
      setReview(j.needsReview ?? []);
      setAmounts({});
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-xl font-bold font-serif text-ink">{t('ep.assign.title')}</h2>
          <p className="text-sm text-ink-faint">{t('ep.assign.subtitle')}</p>
        </div>
        <Link href={`/dashboard/events/${id}`} className="text-sm text-ink-muted hover:text-accent-deep px-2 py-1">
          {t('ep.collect.back')}
        </Link>
      </div>

      {flash && <p className="text-sm text-[#3F6B2E] bg-[#E7F0E0] border border-[#3F6B2E]/20 rounded-xl px-3 py-2.5">{flash}</p>}
      {err && <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-xl px-3 py-2.5">{err}</p>}

      {loading ? (
        <p className="p-6 text-sm text-ink-muted">{t('ep.loading')}</p>
      ) : !pack?.hasAssignedItem ? (
        <div className="bg-surface border border-border rounded-2xl p-6">
          <p className="text-sm text-ink-muted leading-relaxed">{t('ep.assign.noItem')}</p>
        </div>
      ) : (
        <>
          {pack.assignedItems.length > 1 && (
            <div className="bg-surface border border-border rounded-2xl p-4">
              <p className="text-xs text-ink-muted mb-1">{t('ep.assign.item')}</p>
              <select value={item} onChange={(e) => setItem(e.target.value)} className={`${inputCls} w-auto`}>
                {pack.assignedItems.map((f) => <option key={f.item} value={f.item}>{f.label || f.item}</option>)}
              </select>
            </div>
          )}

          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                    <th className="px-4 py-2.5 font-normal">{t('ep.assign.col.group')}</th>
                    <th className="px-4 py-2.5 font-normal text-right">{t('ep.assign.col.count')}</th>
                    <th className="px-4 py-2.5 font-normal">{t('ep.assign.col.current')}</th>
                    <th className="px-4 py-2.5 font-normal w-44">{t('ep.assign.col.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.groups.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-ink-muted">{t('ep.empty')}</td></tr>
                  ) : (
                    pack.groups.map((g) => (
                      <tr key={g.key} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-2.5 text-ink">
                          {groupLabel(g)}
                          {g.pax && <span className="text-xs text-ink-faint"> · {t('ep.assign.paxN', { n: g.pax })}</span>}
                          {g.settled > 0 && (
                            <p className="text-[11px] text-[#7A6420]">{t('ep.assign.settledNote', { n: g.settled })}</p>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-ink">{g.count}</td>
                        <td className="px-4 py-2.5 text-ink-muted tabular-nums">
                          {g.amounts.length === 0
                            ? t('ep.none')
                            : g.amounts.length === 1
                              ? moneyRM(g.amounts[0])
                              : t('ep.assign.mixed')}
                        </td>
                        <td className="px-4 py-2.5">
                          <input
                            type="number" min={0} step="0.01" inputMode="decimal"
                            value={amounts[g.key] ?? ''}
                            onChange={(e) => setAmounts((p) => ({ ...p, [g.key]: e.target.value }))}
                            className={inputCls}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={submit} disabled={busy} className="btn-primary px-5 py-2.5 text-sm font-medium disabled:opacity-50">
              {busy ? t('ep.saving') : t('ep.assign.submit')}
            </button>
          </div>

          {review.length > 0 && (
            <div className="bg-surface border border-[#E7D9A8] rounded-2xl p-4">
              <b className="text-[13px] text-[#7A6420]">{t('ep.assign.review', { n: review.length })}</b>
              <ul className="mt-2 space-y-1">
                {review.map((r) => (
                  <li key={r.registration_id} className="text-xs text-ink-muted">
                    <span className="font-mono">{r.reg_no}</span> · {t(`ep.assign.reason.${r.reason}`)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-ink-faint">{t('ep.assign.footer')}</p>
        </>
      )}
    </div>
  );
}
