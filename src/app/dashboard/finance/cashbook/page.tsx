// src/app/dashboard/finance/cashbook/page.tsx
// 流水 (财务 v2 Phase 1) — the centre's cash book: a filterable transaction list
// plus the 录入 entry form (a modal, matching the D4 expenses idiom rather than a
// separate route — one obvious ＋记一笔 button beats a tab a volunteer has to find).
// Filters: 月份 (year+month picker, same shape as 报表) · 收支类型 · 类别 · 账户 ·
// 搜索 (说明/单号). Voided rows render struck-through and are excluded from every
// total. Corrections are 作废, never deletes. finance:view to see, edit to mutate —
// committee (view-only) gets no ＋记一笔 and no 作废.

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { FinanceTabs } from '@/components/finance-chrome';
import { moneyRM } from '@/lib/finance-display';
import {
  categoryName, groupLabel, groupedCategories, kindForDirection,
  accountKindLabel, directionLabel, amountTone, amountSign, type CategoryRow,
} from '@/lib/cashbook-display';
import { todayMYT, thisMonthMYT } from '@/lib/finance-cashbook';
import { useT, useLocale } from '@/lib/i18n-react';
import type { Locale } from '@/lib/i18n';

type Lite<T> = T | T[] | null;
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

type Centre = { id: string; code: string; name_cn: string };
type Account = { id: string; name: string; kind: string; is_active: boolean };
type Txn = {
  id: string; centre_id: string; txn_date: string; direction: string;
  amount: number | string; description: string | null; reference: string | null;
  receipt_path: string | null; voided_at: string | null; void_reason: string | null;
  account: Lite<{ id: string; name: string; kind: string }>;
  counterparty: Lite<{ id: string; name: string; kind: string }>;
  category: Lite<CategoryRow>;
  centre: Lite<{ id: string; name_cn: string }>;
  enterer: Lite<{ display_name: string | null; email: string }>;
};

const inputCls = 'w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent';
// The cash book starts with the ERP itself — no year before this is selectable.
const GENESIS_YEAR = 2026;
const MONTHS12 = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const yearLabel = (y: string, locale: Locale): string => (locale === 'zh' ? `${y}年` : y);
const monthChipLabel = (mm: string, locale: Locale): string => (locale === 'zh' ? `${Number(mm)}月` : mm);

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

export default function CashbookPage() {
  const t = useT();
  return (
    <ErpGate active="finance" module="finance" titleSuffix={t('cash.tab.cashbook')}>
      {(me) => <Cashbook me={me} />}
    </ErpGate>
  );
}

function Cashbook({ me }: { me: ErpMe }) {
  const t = useT();
  const locale = useLocale();
  const canEdit = grantAllows(me.grants, 'finance', 'edit');

  const [centres, setCentres] = useState<Centre[]>([]);
  const [locked, setLocked] = useState(false);
  const [centreId, setCentreId] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cats, setCats] = useState<CategoryRow[]>([]);

  const [month, setMonth] = useState(thisMonthMYT());
  const [selYear, setSelYear] = useState(thisMonthMYT().slice(0, 4));
  const [fDirection, setFDirection] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fAccount, setFAccount] = useState('');
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');

  const [rows, setRows] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Txn | null>(null);

  // Reference data: scoped centres, then the org-wide category taxonomy (never
  // changes per centre, so it is fetched once).
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
    fetch('/api/dashboard/finance/categories')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setCats(j.categories ?? []); })
      .catch(() => {});
  }, []);

  // Accounts follow the selected centre — they drive both the 账户 filter and the
  // entry modal's account pickers.
  useEffect(() => {
    if (!centreId) return;
    let active = true;
    fetch(`/api/dashboard/finance/accounts?centre_id=${encodeURIComponent(centreId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (active && j) setAccounts(j.accounts ?? []); })
      .catch(() => {});
    return () => { active = false; };
  }, [centreId]);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const h = setTimeout(() => setQ(qLive), 300);
    return () => clearTimeout(h);
  }, [qLive]);

  const load = useCallback(() => {
    if (!centreId) return;
    setLoading(true);
    const sp = new URLSearchParams({ centre_id: centreId, month });
    if (fDirection) sp.set('direction', fDirection);
    if (fCategory) sp.set('category_id', fCategory);
    if (fAccount) sp.set('account_id', fAccount);
    if (q.trim()) sp.set('q', q.trim());
    fetch(`/api/dashboard/finance/txns?${sp.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setRows(j.txns ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [centreId, month, fDirection, fCategory, fAccount, q]);
  useEffect(() => {
    load();
  }, [load]);

  const centre = centres.find((c) => c.id === centreId) ?? null;
  const activeAccounts = useMemo(() => accounts.filter((a) => a.is_active), [accounts]);

  // Month totals — voided excluded, transfers excluded (a transfer moves money
  // between the centre's own wallets; counting it would double-count the month).
  const sums = useMemo(() => {
    let inC = 0, outC = 0;
    for (const r of rows) {
      if (r.voided_at) continue;
      const c = Math.round(Number(r.amount) * 100);
      if (r.direction === 'in') inC += c;
      else if (r.direction === 'out') outC += c;
    }
    return { in: inC / 100, out: outC / 100, net: (inC - outC) / 100 };
  }, [rows]);

  const changeMonth = (m: string) => {
    if (m === month) return;
    setMonth(m);
  };

  const catLabelOf = (r: Txn): string => {
    const c = one(r.category);
    if (c) return categoryName(c, locale);
    return r.direction === 'transfer' ? t('cash.dir.transfer') : '';
  };

  const exportCsv = () => {
    downloadCsv(
      `${t('cash.book.csvFilename')}_${centre?.name_cn ?? ''}_${month}.csv`,
      [t('cash.col.date'), t('cash.col.account'), t('cash.col.category'), t('cash.col.description'), t('cash.col.amount'), t('cash.col.enterer'), t('cash.col.status')],
      rows.map((r) => {
        const acct = one(r.account);
        const by = one(r.enterer);
        return [
          r.txn_date,
          acct?.name ?? '',
          catLabelOf(r),
          r.description ?? '',
          `${amountSign(r.direction)}${Number(r.amount).toFixed(2)}`,
          by?.display_name || by?.email || '',
          r.voided_at ? t('cash.voidedTag', { reason: r.void_reason ?? '' }) : '',
        ];
      })
    );
  };

  const thisYear = Number(thisMonthMYT().slice(0, 4));
  const years = Array.from({ length: Math.max(1, thisYear - GENESIS_YEAR + 1) }, (_, i) => String(GENESIS_YEAR + i));
  const curMonth = thisMonthMYT();

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold font-serif text-ink">{t('cash.book.title')}</h2>
        <span className="text-sm text-ink-faint">{t('cash.book.subtitle')}</span>
      </div>
      <FinanceTabs active="cashbook" />

      {/* centre + primary action */}
      <div className="flex flex-wrap items-center gap-2">
        {!locked && centres.length > 0 && (
          <select value={centreId} onChange={(e) => setCentreId(e.target.value)} className={`${inputCls} w-auto`}>
            {centres.map((c) => <option key={c.id} value={c.id}>{c.name_cn}</option>)}
          </select>
        )}
        {locked && centre && <span className="text-sm font-medium text-ink px-3 py-2">{centre.name_cn}</span>}
        <span className="flex-1" />
        {canEdit && centre && activeAccounts.length > 0 && (
          <button onClick={() => setShowAdd(true)} className="px-4 py-1.5 text-sm btn-primary">{t('cash.book.add')}</button>
        )}
        <button onClick={exportCsv} className="px-3 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">{t('cash.book.exportCsv')}</button>
      </div>

      {canEdit && centre && accounts.length === 0 && (
        <p className="text-sm text-ink-muted bg-surface-soft border border-border rounded-2xl px-4 py-3">{t('cash.book.noAccounts')}</p>
      )}

      {/* month: year control + fixed 12-month grid (same shape as 报表) */}
      <div className="bg-surface border border-border rounded-2xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {years.length <= 3 ? (
            <div className="flex gap-1">
              {years.map((y) => (
                <button key={y} onClick={() => setSelYear(y)}
                  className={`px-2.5 py-0.5 rounded-full text-[11.5px] font-semibold border transition ${
                    y === selYear ? 'pill-gold' : 'border-border text-ink-muted hover:bg-accent/5'
                  }`}>
                  {yearLabel(y, locale)}
                </button>
              ))}
            </div>
          ) : (
            <select value={selYear} onChange={(e) => setSelYear(e.target.value)}
              className="text-[11.5px] font-semibold px-2 py-1 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent">
              {years.map((y) => <option key={y} value={y}>{yearLabel(y, locale)}</option>)}
            </select>
          )}
          <span className="w-px h-4 bg-border mx-0.5" aria-hidden />
          <div className="flex flex-wrap gap-1">
            {MONTHS12.map((mm) => {
              const ym = `${selYear}-${mm}`;
              const on = ym === month;
              const avail = ym <= curMonth; // no future months
              return (
                <button key={mm} disabled={!avail} onClick={() => changeMonth(ym)} title={ym}
                  className={`px-2.5 py-0.5 rounded-full text-[11.5px] font-semibold border transition ${
                    on ? 'pill-gold'
                      : avail ? 'border-border text-ink-muted hover:bg-accent/5'
                        : 'border-transparent text-ink-faint opacity-40 cursor-not-allowed'
                  }`}>
                  {monthChipLabel(mm, locale)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={fDirection} onChange={(e) => { setFDirection(e.target.value); setFCategory(''); }} className={`${inputCls} w-auto`}>
          <option value="">{t('cash.all')}</option>
          <option value="in">{t('cash.dir.in')}</option>
          <option value="out">{t('cash.dir.out')}</option>
          <option value="transfer">{t('cash.dir.transfer')}</option>
        </select>
        <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="">{t('cash.col.category')} · {t('cash.all')}</option>
          {(fDirection === 'in' || fDirection === 'out'
            ? groupedCategories(cats, kindForDirection(fDirection))
            : [...groupedCategories(cats, 'income'), ...groupedCategories(cats, 'expense')]
          ).map((g) => (
            <optgroup key={`${g.grp}-${g.items[0]?.kind}`} label={groupLabel(g.grp, t)}>
              {g.items.map((c) => <option key={c.id} value={c.id}>{categoryName(c, locale)}</option>)}
            </optgroup>
          ))}
        </select>
        <select value={fAccount} onChange={(e) => setFAccount(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="">{t('cash.col.account')} · {t('cash.all')}</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input value={qLive} onChange={(e) => setQLive(e.target.value)} placeholder={t('cash.book.search')} className={`${inputCls} w-auto min-w-[200px]`} />
      </div>

      {/* month summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface border border-border rounded-2xl px-4 py-3">
          <p className="text-[11px] text-ink-faint mb-1">{t('cash.book.sumIn')}</p>
          <p className="text-lg font-bold tabular-nums text-[#3F6B2E]">{moneyRM(sums.in)}</p>
        </div>
        <div className="bg-surface border border-border rounded-2xl px-4 py-3">
          <p className="text-[11px] text-ink-faint mb-1">{t('cash.book.sumOut')}</p>
          <p className="text-lg font-bold tabular-nums text-[#B4402E]">{moneyRM(sums.out)}</p>
        </div>
        <div className="bg-surface border border-border rounded-2xl px-4 py-3">
          <p className="text-[11px] text-ink-faint mb-1">{t('cash.book.sumNet')}</p>
          <p className={`text-lg font-bold tabular-nums ${sums.net < 0 ? 'text-[#B4402E]' : 'text-ink'}`}>{moneyRM(sums.net)}</p>
        </div>
      </div>

      {/* ledger */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">{t('cash.loading')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <th className="px-4 py-2.5 font-normal">{t('cash.col.date')}</th>
                  <th className="px-4 py-2.5 font-normal">{t('cash.col.account')}</th>
                  <th className="px-4 py-2.5 font-normal">{t('cash.col.category')}</th>
                  <th className="px-4 py-2.5 font-normal">{t('cash.col.description')}</th>
                  <th className="px-4 py-2.5 font-normal text-right">{t('cash.col.amount')}</th>
                  <th className="px-4 py-2.5 font-normal">{t('cash.col.enterer')}</th>
                  {canEdit && <th className="px-4 py-2.5 font-normal"></th>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={canEdit ? 7 : 6} className="px-4 py-8 text-center text-sm text-ink-muted">{t('cash.book.empty')}</td></tr>
                ) : (
                  rows.map((r) => {
                    const acct = one(r.account);
                    const cp = one(r.counterparty);
                    const by = one(r.enterer);
                    const voided = !!r.voided_at;
                    return (
                      <tr key={r.id} className={`border-b border-border last:border-b-0 ${voided ? 'opacity-55' : 'hover:bg-accent/5'}`}>
                        <td className={`px-4 py-2 text-ink-muted whitespace-nowrap ${voided ? 'line-through' : ''}`}>{r.txn_date.slice(5)}</td>
                        <td className={`px-4 py-2 text-ink ${voided ? 'line-through' : ''}`}>
                          {acct?.name ?? ''}
                          {r.direction === 'transfer' && cp && <span className="ml-1 text-[11px] text-ink-faint">{t('cash.transferTo', { name: cp.name })}</span>}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${r.direction === 'transfer' ? 'pill-muted' : 'pill-gold'}`}>{catLabelOf(r)}</span>
                        </td>
                        <td className={`px-4 py-2 text-ink ${voided ? 'line-through' : ''}`}>
                          {r.receipt_path && <button onClick={() => openReceipt(r.receipt_path!)} title={t('cash.viewReceipt')} className="mr-1 text-accent-deep no-underline">📎</button>}
                          {r.description ?? ''}
                          {r.reference && <span className="ml-1.5 text-[11px] text-ink-faint">#{r.reference}</span>}
                          {voided && <span className="ml-1.5 text-[11px] text-[#B4402E] no-underline">{t('cash.voidedTag', { reason: r.void_reason ?? '' })}</span>}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums font-medium ${amountTone(r.direction)} ${voided ? 'line-through' : ''}`}>
                          {amountSign(r.direction)}{moneyRM(Number(r.amount))}
                        </td>
                        <td className="px-4 py-2 text-xs text-ink-faint">{by?.display_name || by?.email || ''}</td>
                        {canEdit && <td className="px-4 py-2 text-right">{!voided && <button onClick={() => setVoidTarget(r)} className="text-xs text-[#B4402E] hover:underline">{t('cash.void')}</button>}</td>}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-ink-faint">{t('cash.book.footer')}</p>

      {showAdd && centre && (
        <EntryModal centre={centre} accounts={activeAccounts} cats={cats}
          onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load(); }} />
      )}
      {voidTarget && (
        <VoidModal txn={voidTarget} label={catLabelOf(voidTarget)}
          onClose={() => setVoidTarget(null)} onDone={() => { setVoidTarget(null); load(); }} />
      )}
    </div>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] bg-ink/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold font-serif text-ink mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}
function ErrLine({ msg }: { msg: string }) {
  return msg ? <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2 mb-2">{msg}</p> : null;
}

// 录入 — segmented 收入/支出/转账. Switching direction clears the category, because
// an income category is never valid on an expense (the server rejects a mismatch,
// but the UI should never let it get that far).
function EntryModal({ centre, accounts, cats, onClose, onDone }: {
  centre: Centre; accounts: Account[]; cats: CategoryRow[]; onClose: () => void; onDone: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [direction, setDirection] = useState<'in' | 'out' | 'transfer'>('in');
  const [txnDate, setTxnDate] = useState(todayMYT());
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const isTransfer = direction === 'transfer';
  const groups = useMemo(
    () => (isTransfer ? [] : groupedCategories(cats, kindForDirection(direction))),
    [cats, direction, isTransfer]
  );

  const pickDirection = (d: 'in' | 'out' | 'transfer') => {
    setDirection(d);
    setCategoryId('');
  };

  const submit = async () => {
    setErr('');
    if (!accountId) return setErr(t('cash.entry.err.account'));
    if (isTransfer) {
      if (!toAccountId) return setErr(t('cash.entry.err.accountTo'));
      if (toAccountId === accountId) return setErr(t('cash.entry.err.sameAccount'));
    } else if (!categoryId) {
      return setErr(t('cash.entry.err.category'));
    }
    if (!(Number(amount) > 0)) return setErr(t('cash.entry.err.amountPositive'));

    setBusy(true);
    try {
      let receiptPath: string | undefined;
      if (photo) {
        const fd = new FormData();
        fd.append('file', photo);
        const up = await fetch('/api/dashboard/finance/upload', { method: 'POST', body: fd });
        const uj = await up.json().catch(() => ({}));
        if (!up.ok || !uj.path) {
          setErr(uj.error ?? t('cash.entry.err.uploadFailed'));
          setBusy(false);
          return;
        }
        receiptPath = uj.path;
      }
      const res = await fetch('/api/dashboard/finance/txns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          centre_id: centre.id,
          txn_date: txnDate,
          direction,
          account_id: accountId,
          counterparty_account_id: isTransfer ? toAccountId : null,
          category_id: isTransfer ? null : categoryId,
          amount: Number(amount),
          description: description.trim(),
          reference: reference.trim(),
          receipt_path: receiptPath ?? null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? t('cash.entry.err.saveFailed'));
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  const segCls = (on: boolean) =>
    `flex-1 px-3 py-1.5 text-sm font-semibold rounded-lg border transition ${
      on ? 'pill-gold' : 'border-border text-ink-muted hover:bg-accent/5'
    }`;

  return (
    <ModalShell title={t('cash.entry.title', { centre: centre.name_cn })} onClose={onClose}>
      <ErrLine msg={err} />

      <div className="flex gap-1.5 mb-3">
        <button onClick={() => pickDirection('in')} className={segCls(direction === 'in')}>{t('cash.dir.in')}</button>
        <button onClick={() => pickDirection('out')} className={segCls(direction === 'out')}>{t('cash.dir.out')}</button>
        <button onClick={() => pickDirection('transfer')} className={segCls(isTransfer)}>{t('cash.dir.transfer')}</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-ink-muted mb-1">{t('cash.entry.field.date')}</p>
          <input type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <p className="text-xs text-ink-muted mb-1">{t('cash.entry.field.amount')}</p>
          <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        </div>

        <div className={isTransfer ? '' : 'col-span-2'}>
          <p className="text-xs text-ink-muted mb-1">{isTransfer ? t('cash.entry.field.accountFrom') : t('cash.entry.field.account')}</p>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {accountKindLabel(a.kind, t)}</option>)}
          </select>
        </div>
        {isTransfer && (
          <div>
            <p className="text-xs text-ink-muted mb-1">{t('cash.entry.field.accountTo')}</p>
            <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name} · {accountKindLabel(a.kind, t)}</option>)}
            </select>
          </div>
        )}

        {!isTransfer && (
          <div className="col-span-2">
            <p className="text-xs text-ink-muted mb-1">{t('cash.entry.field.category')}</p>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
              <option value="">{t('cash.entry.field.categoryPlaceholder')}</option>
              {groups.map((g) => (
                <optgroup key={g.grp} label={groupLabel(g.grp, t)}>
                  {g.items.map((c) => <option key={c.id} value={c.id}>{categoryName(c, locale)}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        <div className="col-span-2">
          <p className="text-xs text-ink-muted mb-1">{t('cash.entry.field.description')}</p>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        </div>
        <div>
          <p className="text-xs text-ink-muted mb-1">{t('cash.entry.field.reference')}</p>
          <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} />
        </div>
        <div>
          <p className="text-xs text-ink-muted mb-1">{t('cash.entry.field.photoOptional')}</p>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-ink-muted file:mr-2 file:px-2 file:py-1 file:rounded file:border file:border-border-strong file:bg-surface file:text-ink" />
        </div>
      </div>

      <div className="flex gap-2 justify-end mt-3">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('cash.cancel')}</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? t('cash.saving') : t('cash.save')}</button>
      </div>
    </ModalShell>
  );
}

function VoidModal({ txn, label, onClose, onDone }: { txn: Txn; label: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr('');
    if (!reason.trim()) return setErr(t('cash.err.voidReason'));
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard/finance/txns/${txn.id}/void`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? t('cash.err.voidFailed'));
      else onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell title={t('cash.voidTitle')} onClose={onClose}>
      <ErrLine msg={err} />
      <p className="text-xs text-ink-muted mb-2">
        {t('cash.voidBody', { desc: txn.description || label, money: moneyRM(Number(txn.amount)) })}
      </p>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputCls} />
      <div className="flex gap-2 justify-end mt-3">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('cash.cancel')}</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm border border-[#E5C4BF] text-[#B4402E] rounded-lg bg-surface hover:border-[#B4402E]">{busy ? t('cash.processing') : t('cash.confirmVoid')}</button>
      </div>
    </ModalShell>
  );
}
