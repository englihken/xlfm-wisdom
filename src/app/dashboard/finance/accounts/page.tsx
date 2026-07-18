// src/app/dashboard/finance/accounts/page.tsx
// 账户 (财务 v2 Phase 1) — the centre's bank/cash wallets. Table 账户/类型/期初余额/
// 期初日期/当前结余 + a 中心结余 total. Current balance is computed SERVER-side
// (opening + ins − outs ± transfers, voided excluded) so the page never re-derives
// money on the client. Centre picker for all_centers callers; own_center is locked
// to their centre exactly like the D4 expenses page. finance:view to see, edit to
// mutate. Accounts are deactivated, never deleted — transactions FK them.

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { FinanceTabs } from '@/components/finance-chrome';
import { moneyRM } from '@/lib/finance-display';
import { accountKindLabel, balanceTone } from '@/lib/cashbook-display';
import { useT } from '@/lib/i18n-react';

type Centre = { id: string; code: string; name_cn: string };
type Account = {
  id: string; centre_id: string; kind: string; name: string;
  opening_balance: number | string; opening_as_of: string | null;
  is_active: boolean; balance: number;
};

const inputCls = 'w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent';

export default function AccountsPage() {
  const t = useT();
  return (
    <ErpGate active="finance" module="finance" titleSuffix={t('cash.tab.accounts')}>
      {(me) => <Accounts me={me} />}
    </ErpGate>
  );
}

function Accounts({ me }: { me: ErpMe }) {
  const t = useT();
  const canEdit = grantAllows(me.grants, 'finance', 'edit');
  const [centres, setCentres] = useState<Centre[]>([]);
  const [locked, setLocked] = useState(false);
  const [centreId, setCentreId] = useState('');
  const [rows, setRows] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);

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
    fetch(`/api/dashboard/finance/accounts?centre_id=${encodeURIComponent(centreId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setRows(j.accounts ?? []);
        setTotal(Number(j.total ?? 0));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [centreId]);
  useEffect(() => {
    load();
  }, [load]);

  const centre = centres.find((c) => c.id === centreId) ?? null;

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold font-serif text-ink">{t('cash.accounts.title')}</h2>
        <span className="text-sm text-ink-faint">{t('cash.accounts.subtitle')}</span>
      </div>
      <FinanceTabs active="accounts" />

      <div className="flex flex-wrap items-center gap-2">
        {!locked && centres.length > 0 && (
          <select value={centreId} onChange={(e) => setCentreId(e.target.value)} className={`${inputCls} w-auto`}>
            {centres.map((c) => <option key={c.id} value={c.id}>{c.name_cn}</option>)}
          </select>
        )}
        {locked && centre && <span className="text-sm font-medium text-ink px-3 py-2">{centre.name_cn}</span>}
        <span className="flex-1" />
        {canEdit && centre && <button onClick={() => setShowAdd(true)} className="px-4 py-1.5 text-sm btn-primary">{t('cash.accounts.add')}</button>}
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">{t('cash.loading')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <th className="px-4 py-2.5 font-normal">{t('cash.acct.col.name')}</th>
                  <th className="px-4 py-2.5 font-normal">{t('cash.acct.col.kind')}</th>
                  <th className="px-4 py-2.5 font-normal text-right">{t('cash.acct.col.opening')}</th>
                  <th className="px-4 py-2.5 font-normal">{t('cash.acct.col.openingAsOf')}</th>
                  <th className="px-4 py-2.5 font-normal text-right">{t('cash.acct.col.balance')}</th>
                  {canEdit && <th className="px-4 py-2.5 font-normal"></th>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={canEdit ? 6 : 5} className="px-4 py-8 text-center text-sm text-ink-muted">{t('cash.accounts.empty')}</td></tr>
                ) : (
                  rows.map((a) => (
                    <tr key={a.id} className={`border-b border-border last:border-b-0 ${a.is_active ? 'hover:bg-accent/5' : 'opacity-55'}`}>
                      <td className="px-4 py-2.5 text-ink">
                        {a.name}
                        {!a.is_active && <span className="ml-1.5 text-[11px] text-ink-faint">{t('cash.acct.inactive')}</span>}
                      </td>
                      <td className="px-4 py-2.5"><span className="inline-block px-2 py-0.5 rounded-full text-[11px] pill-gold">{accountKindLabel(a.kind, t)}</span></td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{moneyRM(Number(a.opening_balance))}</td>
                      <td className="px-4 py-2.5 text-xs text-ink-faint">{a.opening_as_of ?? ''}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${balanceTone(a.balance)}`}>{moneyRM(a.balance)}</td>
                      {canEdit && <td className="px-4 py-2.5 text-right"><button onClick={() => setEditTarget(a)} className="text-xs text-accent-deep hover:underline">{t('cash.acct.edit')}</button></td>}
                    </tr>
                  ))
                )}
                {rows.length > 0 && (
                  <tr className="border-t-2 border-border">
                    <td colSpan={4} className="px-4 py-2.5 text-right text-ink-muted">{t('cash.accounts.total')}</td>
                    <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${balanceTone(total)}`}>{moneyRM(total)}</td>
                    {canEdit && <td></td>}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-ink-faint">{t('cash.accounts.footer')} {t('cash.accounts.totalNote')}</p>

      {showAdd && centre && <AccountModal centre={centre} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load(); }} />}
      {editTarget && <AccountModal account={editTarget} onClose={() => setEditTarget(null)} onDone={() => { setEditTarget(null); load(); }} />}
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

// One modal for both create (centre given) and edit (account given). Editing an
// account never moves it between centres — centre_id is not sent on PATCH.
function AccountModal({ centre, account, onClose, onDone }: { centre?: Centre; account?: Account; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const editing = !!account;
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState(account?.kind ?? 'bank');
  const [opening, setOpening] = useState(account ? String(Number(account.opening_balance)) : '0');
  const [openingAsOf, setOpeningAsOf] = useState(account?.opening_as_of ?? '');
  const [isActive, setIsActive] = useState(account?.is_active ?? true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    if (!name.trim()) return setErr(t('cash.acct.err.name'));
    if (opening.trim() !== '' && !Number.isFinite(Number(opening))) return setErr(t('cash.acct.err.opening'));
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        kind,
        opening_balance: opening.trim() === '' ? 0 : Number(opening),
        opening_as_of: openingAsOf || null,
        ...(editing ? { is_active: isActive } : { centre_id: centre!.id }),
      };
      const res = await fetch(editing ? `/api/dashboard/finance/accounts/${account!.id}` : '/api/dashboard/finance/accounts', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? t('cash.acct.err.saveFailed'));
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={editing ? t('cash.acct.editTitle') : t('cash.acct.addTitle', { centre: centre?.name_cn ?? '' })} onClose={onClose}>
      <ErrLine msg={err} />
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <p className="text-xs text-ink-muted mb-1">{t('cash.acct.field.name')}</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('cash.acct.field.namePlaceholder')} className={inputCls} />
        </div>
        <div>
          <p className="text-xs text-ink-muted mb-1">{t('cash.acct.field.kind')}</p>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
            <option value="bank">{t('cash.kind.bank')}</option>
            <option value="cash">{t('cash.kind.cash')}</option>
          </select>
        </div>
        <div>
          <p className="text-xs text-ink-muted mb-1">{t('cash.acct.field.opening')}</p>
          <input type="number" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} className={inputCls} />
        </div>
        <div>
          <p className="text-xs text-ink-muted mb-1">{t('cash.acct.field.openingAsOf')}</p>
          <input type="date" value={openingAsOf} onChange={(e) => setOpeningAsOf(e.target.value)} className={inputCls} />
        </div>
        {editing && (
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              {t('cash.acct.field.active')}
            </label>
          </div>
        )}
      </div>
      <div className="flex gap-2 justify-end mt-3">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('cash.cancel')}</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? t('cash.saving') : t('cash.save')}</button>
      </div>
    </ModalShell>
  );
}
