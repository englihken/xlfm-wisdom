// src/app/dashboard/finance/mutual-aid/page.tsx
// 盈余互助 (D6) — the mutual-aid fund ledger (aggregate; 理事会 sees this page, never individual
// payments). 3 stat tiles (累计 / 本月转入 / 本月支用), the entries table (转入 green / 支用 red),
// and finance:admin-only actions: 归集本月结余 (preview per-centre surpluses → confirm; idempotent)
// and 记支用 (requires a 理事会 resolution number). finance:view to read.

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { FinanceTabs } from '@/components/finance-chrome';
import { moneyRM } from '@/lib/finance-display';

type Lite<T> = T | T[] | null;
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
type Entry = {
  id: string; entry_type: string; amount: number; description: string; resolution_no: string | null; month: string;
  centre: Lite<{ name_cn: string }>; creator: Lite<{ display_name: string | null; email: string }>;
};
type CollectResult = { centre: string; surplus: number; status: 'collected' | 'skipped' | 'no_surplus' };

const thisMonth = () => new Date().toISOString().slice(0, 7);
const inputCls = 'w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent';

export default function MutualAidPage() {
  return (
    <ErpGate active="finance" module="finance" titleSuffix="盈余互助">
      {(me) => <MutualAid me={me} />}
    </ErpGate>
  );
}

function MutualAid({ me }: { me: ErpMe }) {
  const canAdmin = grantAllows(me.grants, 'finance', 'admin');
  const [year, setYear] = useState(new Date().getFullYear());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [stats, setStats] = useState<{ cumulative: number; monthIn: number; monthOut: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCollect, setShowCollect] = useState(false);
  const [showDisburse, setShowDisburse] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/dashboard/finance/mutual-aid?year=${year}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) {
          setEntries(j.entries ?? []);
          setStats(j.stats ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [year]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold font-serif text-ink">🤝 盈余互助</h2>
          <span className="text-sm text-ink-faint">Surplus Mutual-Aid</span>
        </div>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent">
          {[year + 1, year, year - 1, year - 2].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <FinanceTabs active="mutual" />

      {loading ? (
        <p className="p-6 text-sm text-ink-muted">加载中…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Tile value={moneyRM(stats?.cumulative ?? 0)} label="互助基金累计" />
            <Tile value={`+ ${moneyRM(stats?.monthIn ?? 0)}`} label="本月转入（各中心结余）" tone="green" />
            <Tile value={`− ${moneyRM(stats?.monthOut ?? 0)}`} label="本月支用" tone="red" />
          </div>

          {canAdmin && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setShowCollect(true)} className="px-4 py-1.5 text-sm btn-primary">归集本月结余</button>
              <button onClick={() => setShowDisburse(true)} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">记支用</button>
            </div>
          )}

          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                    <th className="px-4 py-2.5 font-normal">月份</th><th className="px-4 py-2.5 font-normal">类型</th>
                    <th className="px-4 py-2.5 font-normal">说明</th><th className="px-4 py-2.5 font-normal text-right">金额</th>
                    <th className="px-4 py-2.5 font-normal">经手</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-muted">本年暂无互助记录。</td></tr>
                  ) : (
                    entries.map((e) => {
                      const centre = one(e.centre);
                      const by = one(e.creator);
                      const isIn = e.entry_type === 'in';
                      return (
                        <tr key={e.id} className="border-b border-border last:border-b-0">
                          <td className="px-4 py-2 text-ink-muted">{e.month.slice(0, 7)}</td>
                          <td className="px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${isIn ? 'bg-[#E7F0E0] text-[#3F6B2E]' : 'bg-[#FCEBEA] text-[#B4402E]'}`}>{isIn ? '转入' : '支用'}</span></td>
                          <td className="px-4 py-2 text-ink">
                            {e.description}
                            {e.resolution_no && <span className="ml-1.5 text-[11px] text-ink-faint">（决议 {e.resolution_no}）</span>}
                            {centre && <span className="ml-1.5 text-[11px] text-ink-faint">· {centre.name_cn}</span>}
                          </td>
                          <td className={`px-4 py-2 text-right tabular-nums font-semibold ${isIn ? 'text-[#3F6B2E]' : 'text-[#B4402E]'}`}>{isIn ? '+' : '−'}{moneyRM(e.amount)}</td>
                          <td className="px-4 py-2 text-xs text-ink-faint">{by?.display_name || by?.email || '系统'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-ink-faint">支用必须挂理事会决议编号 · 理事会见此页（聚合），不见任何个人缴费明细</p>
        </>
      )}

      {showCollect && <CollectModal onClose={() => setShowCollect(false)} onDone={() => { setShowCollect(false); load(); }} />}
      {showDisburse && <DisburseModal onClose={() => setShowDisburse(false)} onDone={() => { setShowDisburse(false); load(); }} />}
    </div>
  );
}

function Tile({ value, label, tone }: { value: string; label: string; tone?: 'green' | 'red' }) {
  return (
    <div className="bg-surface border border-border rounded-2xl px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${tone === 'green' ? 'text-[#3F6B2E]' : tone === 'red' ? 'text-[#B4402E]' : 'text-ink'}`}>{value}</div>
      <div className="text-[11px] text-ink-muted mt-0.5">{label}</div>
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

function CollectModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [month, setMonth] = useState(thisMonth());
  const [preview, setPreview] = useState<CollectResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const runPreview = useCallback(async (m: string) => {
    setErr('');
    setPreview(null);
    const res = await fetch('/api/dashboard/finance/mutual-aid/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: m, preview: true }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setErr(j.error ?? '预览失败');
    else setPreview(j.results ?? []);
  }, []);
  useEffect(() => {
    runPreview(month);
  }, [month, runPreview]);

  const toCollect = (preview ?? []).filter((r) => r.status === 'collected');
  const confirm = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/finance/mutual-aid/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? '归集失败');
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="归集本月结余" onClose={onClose}>
      <ErrLine msg={err} />
      <div className="mb-3"><p className="text-xs text-ink-muted mb-1">月份</p><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} /></div>
      <p className="text-xs text-ink-muted mb-2">各中心「已收 − 支出」结余转入互助基金。已归集过的中心会自动跳过（可安全重跑）。</p>
      {preview === null ? (
        <p className="text-sm text-ink-muted">计算中…</p>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border max-h-56 overflow-auto text-xs">
          {preview.map((r) => (
            <div key={r.centre} className="flex justify-between px-3 py-1.5">
              <span className="text-ink">{r.centre}</span>
              <span className={r.status === 'collected' ? 'text-[#3F6B2E]' : 'text-ink-faint'}>
                {r.status === 'collected' ? `+ ${moneyRM(r.surplus)}` : r.status === 'skipped' ? '已归集' : '无结余'}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 justify-end mt-3">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
        <button disabled={busy || toCollect.length === 0} onClick={confirm} className="px-5 py-1.5 text-sm btn-primary">{busy ? '归集中…' : `确认归集（${toCollect.length} 中心）`}</button>
      </div>
    </ModalShell>
  );
}

function DisburseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [month, setMonth] = useState(thisMonth());
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [resolutionNo, setResolutionNo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr('');
    if (!(Number(amount) > 0)) return setErr('金额须大于 0');
    if (!description.trim()) return setErr('请填写说明');
    if (!resolutionNo.trim()) return setErr('支用必须填写理事会决议编号');
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/finance/mutual-aid/disburse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month, amount: Number(amount), description: description.trim(), resolution_no: resolutionNo.trim() }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? '记支用失败');
      else onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell title="记支用（互助基金）" onClose={onClose}>
      <ErrLine msg={err} />
      <div className="grid grid-cols-2 gap-3">
        <div><p className="text-xs text-ink-muted mb-1">月份</p><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} /></div>
        <div><p className="text-xs text-ink-muted mb-1">金额 RM</p><input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} /></div>
        <div className="col-span-2"><p className="text-xs text-ink-muted mb-1">说明</p><input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} placeholder="如：同修家庭急难补助" /></div>
        <div className="col-span-2"><p className="text-xs text-ink-muted mb-1">理事会决议编号（必填）</p><input value={resolutionNo} onChange={(e) => setResolutionNo(e.target.value)} className={inputCls} placeholder="如：2026-07 决议 №3" /></div>
      </div>
      <div className="flex gap-2 justify-end mt-3">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? '保存中…' : '确认支用'}</button>
      </div>
    </ModalShell>
  );
}
