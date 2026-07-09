// src/app/dashboard/finance/expenses/page.tsx
// 支出记录 (D4) — per-centre monthly expense ledger feeding the D1/D5 transparency numbers.
// Centre + month selectors (centre hidden+locked for own_center). Table 日期/类别/说明/金额/录入
// + 本月合计 (voided rows shown struck-through and EXCLUDED from the total). ＋记支出 modal
// (fixed category enum). Corrections are 作废, never deletes. finance:view to see; edit to mutate.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { FinanceTabs } from '@/components/finance-chrome';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_OPTIONS, expenseCategoryPill, moneyRM } from '@/lib/finance-display';

type Lite<T> = T | T[] | null;
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
type Centre = { id: string; code: string; name_cn: string };
type Expense = {
  id: string; spent_at: string; category: string; description: string; amount: number;
  voided_at: string | null; void_reason: string | null; enterer: Lite<{ display_name: string | null; email: string }>;
};

const inputCls = 'w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent';
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function ExpensesPage() {
  return (
    <ErpGate active="finance" module="finance" titleSuffix="支出记录">
      {(me) => <Expenses me={me} />}
    </ErpGate>
  );
}

function Expenses({ me }: { me: ErpMe }) {
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

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold font-serif text-ink">🧾 支出记录</h2>
        <span className="text-sm text-ink-faint">Expenses</span>
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
        {canEdit && <button onClick={() => setShowAdd(true)} className="px-4 py-1.5 text-sm btn-primary">＋ 记支出</button>}
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">加载中…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <th className="px-4 py-2.5 font-normal">日期</th><th className="px-4 py-2.5 font-normal">类别</th>
                  <th className="px-4 py-2.5 font-normal">说明</th><th className="px-4 py-2.5 font-normal text-right">金额</th>
                  <th className="px-4 py-2.5 font-normal">录入</th>{canEdit && <th className="px-4 py-2.5 font-normal"></th>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={canEdit ? 6 : 5} className="px-4 py-8 text-center text-sm text-ink-muted">本月暂无支出记录。</td></tr>
                ) : (
                  rows.map((r) => {
                    const by = one(r.enterer);
                    const voided = !!r.voided_at;
                    return (
                      <tr key={r.id} className={`border-b border-border last:border-b-0 ${voided ? 'opacity-55' : 'hover:bg-accent/5'}`}>
                        <td className={`px-4 py-2 text-ink-muted ${voided ? 'line-through' : ''}`}>{r.spent_at.slice(5)}</td>
                        <td className="px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${expenseCategoryPill(r.category)}`}>{EXPENSE_CATEGORY_LABELS[r.category] ?? r.category}</span></td>
                        <td className={`px-4 py-2 text-ink ${voided ? 'line-through' : ''}`}>
                          {r.description}
                          {voided && <span className="ml-1.5 text-[11px] text-[#B4402E] no-underline">（已作废：{r.void_reason}）</span>}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums text-ink ${voided ? 'line-through' : ''}`}>{moneyRM(r.amount)}</td>
                        <td className="px-4 py-2 text-xs text-ink-faint">{by?.display_name || by?.email || ''}</td>
                        {canEdit && <td className="px-4 py-2 text-right">{!voided && <button onClick={() => setVoidTarget(r)} className="text-xs text-[#B4402E] hover:underline">作废</button>}</td>}
                      </tr>
                    );
                  })
                )}
                {rows.length > 0 && (
                  <tr className="border-t-2 border-border">
                    <td colSpan={3} className="px-4 py-2.5 text-right text-ink-muted">本月合计</td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-ink">{moneyRM(total)}</td>
                    <td colSpan={canEdit ? 2 : 1}></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-ink-faint">类别固定枚举（租金 / 水电 / 维护 / 活动 / 杂项）· 单据照片稍后接入（私有 bucket）· 无删除，错录 = 作废</p>

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
  const [spentAt, setSpentAt] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }));
  const [category, setCategory] = useState('rent');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr('');
    if (!description.trim()) return setErr('请填写说明');
    if (!(Number(amount) > 0)) return setErr('金额须大于 0');
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/finance/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centre_id: centre.id, spent_at: spentAt, category, description: description.trim(), amount: Number(amount) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? '保存失败');
      else onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell title={`记支出 · ${centre.name_cn}`} onClose={onClose}>
      <ErrLine msg={err} />
      <div className="grid grid-cols-2 gap-3">
        <div><p className="text-xs text-ink-muted mb-1">日期</p><input type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} className={inputCls} /></div>
        <div><p className="text-xs text-ink-muted mb-1">类别</p><select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>{EXPENSE_CATEGORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="col-span-2"><p className="text-xs text-ink-muted mb-1">说明</p><input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} /></div>
        <div><p className="text-xs text-ink-muted mb-1">金额 RM</p><input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} /></div>
      </div>
      <div className="flex gap-2 justify-end mt-3">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? '保存中…' : '保存'}</button>
      </div>
    </ModalShell>
  );
}

function VoidModal({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr('');
    if (!reason.trim()) return setErr('请填写作废原因');
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard/finance/expenses/${expense.id}/void`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? '作废失败');
      else onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell title="作废支出" onClose={onClose}>
      <ErrLine msg={err} />
      <p className="text-xs text-ink-muted mb-2">{EXPENSE_CATEGORY_LABELS[expense.category]} · {expense.description} · {moneyRM(expense.amount)}。作废保留审计痕迹（不删除）。</p>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputCls} />
      <div className="flex gap-2 justify-end mt-3">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm border border-[#E5C4BF] text-[#B4402E] rounded-lg bg-surface hover:border-[#B4402E]">{busy ? '处理中…' : '确认作废'}</button>
      </div>
    </ModalShell>
  );
}
