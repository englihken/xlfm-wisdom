// src/app/dashboard/finance/expenses/page.tsx
// 支出记录 (D4) — per-centre monthly expense ledger feeding the D1/D5 transparency numbers.
// Centre + month selectors (centre hidden+locked for own_center). Table 日期/类别/说明/金额/录入
// + 本月合计 (voided rows shown struck-through and EXCLUDED from the total). ＋记支出 modal
// (fixed category enum). Corrections are 作废, never deletes. finance:view to see; edit to mutate.

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { FinanceTabs } from '@/components/finance-chrome';
import { expenseCategoryLabel, expenseCategoryOptions, expenseCategoryPill, moneyRM } from '@/lib/finance-display';
import { useT } from '@/lib/i18n-react';

type Lite<T> = T | T[] | null;
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
type Centre = { id: string; code: string; name_cn: string };
type Expense = {
  id: string; spent_at: string; category: string; description: string; amount: number; receipt_path: string | null;
  voided_at: string | null; void_reason: string | null; enterer: Lite<{ display_name: string | null; email: string }>;
};

const inputCls = 'w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent';
const thisMonth = () => new Date().toISOString().slice(0, 7);

async function openReceipt(path: string) {
  const r = await fetch(`/api/dashboard/finance/media-url?path=${encodeURIComponent(path)}`);
  const j = await r.json().catch(() => ({}));
  if (j?.url) window.open(j.url, '_blank', 'noopener');
}

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

export default function ExpensesPage() {
  const t = useT();
  return (
    <ErpGate active="finance" module="finance" titleSuffix={t('finance.tab.expenses')}>
      {(me) => <Expenses me={me} />}
    </ErpGate>
  );
}

function Expenses({ me }: { me: ErpMe }) {
  const t = useT();
  const canEdit = grantAllows(me.grants, 'finance', 'edit');
  const [centres, setCentres] = useState<Centre[]>([]);
  const [locked, setLocked] = useState(false);
  const [centreId, setCentreId] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Expense | null>(null);

  useEffect(() => {
    fetch('/api/dashboard/finance/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setCentres(j.centres ?? []);
        setLocked(!!j.scope?.locked);
        setCentreId((c) => c || j.centres?.[0]?.id || '');
      })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!centreId) return;
    setLoading(true);
    fetch(`/api/dashboard/finance/expenses?centre_id=${encodeURIComponent(centreId)}&month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) setRows(j.expenses ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [centreId, month]);
  useEffect(() => {
    load();
  }, [load]);

  const centre = centres.find((c) => c.id === centreId) ?? null;
  const total = useMemo(() => rows.filter((r) => !r.voided_at).reduce((s, r) => s + Number(r.amount), 0), [rows]);

  const exportCsv = () => {
    downloadCsv(
      `${t('expenses.csv.filename')}_${centre?.name_cn ?? ''}_${month}.csv`,
      [t('expenses.col.date'), t('expenses.col.category'), t('expenses.col.description'), t('expenses.col.amount'), t('expenses.col.enterer'), t('expenses.csv.col.status')],
      rows.map((r) => {
        const by = one(r.enterer);
        return [r.spent_at, expenseCategoryLabel(r.category, t), r.description, Number(r.amount).toFixed(2), by?.display_name || by?.email || '', r.voided_at ? t('expenses.csv.voided', { reason: r.void_reason ?? '' }) : ''];
      })
    );
  };

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold font-serif text-ink">{t('expenses.title')}</h2>
        {t('expenses.subtitle') && <span className="text-sm text-ink-faint">{t('expenses.subtitle')}</span>}
      </div>
      <FinanceTabs active="expenses" />

      <div className="flex flex-wrap items-center gap-2">
        {!locked && centres.length > 0 && (
          <select value={centreId} onChange={(e) => setCentreId(e.target.value)} className={`${inputCls} w-auto`}>
            {centres.map((c) => <option key={c.id} value={c.id}>{c.name_cn}</option>)}
          </select>
        )}
        {locked && centre && <span className="text-sm font-medium text-ink px-3 py-2">{centre.name_cn}</span>}
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={`${inputCls} w-auto`} />
        <span className="flex-1" />
        {canEdit && <button onClick={() => setShowAdd(true)} className="px-4 py-1.5 text-sm btn-primary">{t('expenses.addExpense')}</button>}
        <button onClick={exportCsv} className="px-3 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">{t('expenses.exportCsv')}</button>
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">{t('expenses.loading')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <th className="px-4 py-2.5 font-normal">{t('expenses.col.date')}</th><th className="px-4 py-2.5 font-normal">{t('expenses.col.category')}</th>
                  <th className="px-4 py-2.5 font-normal">{t('expenses.col.description')}</th><th className="px-4 py-2.5 font-normal text-right">{t('expenses.col.amount')}</th>
                  <th className="px-4 py-2.5 font-normal">{t('expenses.col.enterer')}</th>{canEdit && <th className="px-4 py-2.5 font-normal"></th>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={canEdit ? 6 : 5} className="px-4 py-8 text-center text-sm text-ink-muted">{t('expenses.empty')}</td></tr>
                ) : (
                  rows.map((r) => {
                    const by = one(r.enterer);
                    const voided = !!r.voided_at;
                    return (
                      <tr key={r.id} className={`border-b border-border last:border-b-0 ${voided ? 'opacity-55' : 'hover:bg-accent/5'}`}>
                        <td className={`px-4 py-2 text-ink-muted ${voided ? 'line-through' : ''}`}>{r.spent_at.slice(5)}</td>
                        <td className="px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${expenseCategoryPill(r.category)}`}>{expenseCategoryLabel(r.category, t)}</span></td>
                        <td className={`px-4 py-2 text-ink ${voided ? 'line-through' : ''}`}>
                          {r.receipt_path && <button onClick={() => openReceipt(r.receipt_path!)} title={t('expenses.viewReceipt')} className="mr-1 text-accent-deep no-underline">📎</button>}
                          {r.description}
                          {voided && <span className="ml-1.5 text-[11px] text-[#B4402E] no-underline">{t('expenses.voidedTag', { reason: r.void_reason ?? '' })}</span>}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums text-ink ${voided ? 'line-through' : ''}`}>{moneyRM(r.amount)}</td>
                        <td className="px-4 py-2 text-xs text-ink-faint">{by?.display_name || by?.email || ''}</td>
                        {canEdit && <td className="px-4 py-2 text-right">{!voided && <button onClick={() => setVoidTarget(r)} className="text-xs text-[#B4402E] hover:underline">{t('expenses.void')}</button>}</td>}
                      </tr>
                    );
                  })
                )}
                {rows.length > 0 && (
                  <tr className="border-t-2 border-border">
                    <td colSpan={3} className="px-4 py-2.5 text-right text-ink-muted">{t('expenses.monthTotal')}</td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-ink">{moneyRM(total)}</td>
                    <td colSpan={canEdit ? 2 : 1}></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-ink-faint">{t('expenses.footer')}</p>

      {showAdd && centre && <ExpenseModal centre={centre} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load(); }} />}
      {voidTarget && <VoidModal expense={voidTarget} onClose={() => setVoidTarget(null)} onDone={() => { setVoidTarget(null); load(); }} />}
    </div>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] bg-ink/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold font-serif text-ink mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}
function ErrLine({ msg }: { msg: string }) {
  return msg ? <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2 mb-2">{msg}</p> : null;
}

function ExpenseModal({ centre, onClose, onDone }: { centre: Centre; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [spentAt, setSpentAt] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }));
  const [category, setCategory] = useState('rent');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr('');
    if (!description.trim()) return setErr(t('expenses.err.description'));
    if (!(Number(amount) > 0)) return setErr(t('expenses.err.amountPositive'));
    setBusy(true);
    try {
      let receiptPath: string | undefined;
      if (photo) {
        const fd = new FormData();
        fd.append('file', photo);
        const up = await fetch('/api/dashboard/finance/upload', { method: 'POST', body: fd });
        const uj = await up.json().catch(() => ({}));
        if (!up.ok || !uj.path) {
          setErr(uj.error ?? t('expenses.err.uploadFailed'));
          setBusy(false);
          return;
        }
        receiptPath = uj.path;
      }
      const res = await fetch('/api/dashboard/finance/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centre_id: centre.id, spent_at: spentAt, category, description: description.trim(), amount: Number(amount), receipt_path: receiptPath ?? null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? t('expenses.err.saveFailed'));
      else onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell title={t('expenses.modal.title', { centre: centre.name_cn })} onClose={onClose}>
      <ErrLine msg={err} />
      <div className="grid grid-cols-2 gap-3">
        <div><p className="text-xs text-ink-muted mb-1">{t('expenses.field.date')}</p><input type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} className={inputCls} /></div>
        <div><p className="text-xs text-ink-muted mb-1">{t('expenses.field.category')}</p><select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>{expenseCategoryOptions(t).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="col-span-2"><p className="text-xs text-ink-muted mb-1">{t('expenses.field.description')}</p><input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} /></div>
        <div><p className="text-xs text-ink-muted mb-1">{t('expenses.field.amount')}</p><input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} /></div>
        <div><p className="text-xs text-ink-muted mb-1">{t('expenses.field.photoOptional')}</p><input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} className="w-full text-xs text-ink-muted file:mr-2 file:px-2 file:py-1 file:rounded file:border file:border-border-strong file:bg-surface file:text-ink" /></div>
      </div>
      <div className="flex gap-2 justify-end mt-3">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('expenses.cancel')}</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? t('expenses.saving') : t('expenses.save')}</button>
      </div>
    </ModalShell>
  );
}

function VoidModal({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr('');
    if (!reason.trim()) return setErr(t('expenses.err.voidReason'));
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard/finance/expenses/${expense.id}/void`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? t('expenses.err.voidFailed'));
      else onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell title={t('expenses.voidTitle')} onClose={onClose}>
      <ErrLine msg={err} />
      <p className="text-xs text-ink-muted mb-2">{t('expenses.voidBody', { cat: expenseCategoryLabel(expense.category, t), desc: expense.description, money: moneyRM(expense.amount) })}</p>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputCls} />
      <div className="flex gap-2 justify-end mt-3">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('expenses.cancel')}</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm border border-[#E5C4BF] text-[#B4402E] rounded-lg bg-surface hover:border-[#B4402E]">{busy ? t('expenses.processing') : t('expenses.confirmVoid')}</button>
      </div>
    </ModalShell>
  );
}
