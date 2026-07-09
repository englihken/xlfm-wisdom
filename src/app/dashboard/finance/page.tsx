// src/app/dashboard/finance/page.tsx
// 财务总览 (D1) — the finance landing tab. Scope-aware: 财务总监 sees all centres, an own_center
// 财政 sees only their own numbers + card. 4 stat tiles (本月已收 / 支出 / 结余→盈余互助 / 已缴·认捐
// 人数), a per-centre card grid (pause state shown read-only — toggle it on 月费台账), and the
// 活动收款汇总 (read-only aggregate from the events wing). All from /api/dashboard/finance/stats.

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useEffect, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { FinanceTabs } from '@/components/finance-chrome';
import { moneyRM } from '@/lib/finance-display';

type Stats = {
  month: string;
  kpis: { collected: number; expenses: number; surplus: number; pledgedCount: number; paidCount: number };
  centres: { id: string; code: string; name_cn: string; collected: number; expenses: number; surplus: number; paused: boolean; pausedNote: string | null; receiptBookAt: string | null; financeName: string | null }[];
  events: { code: string; title: string; approvedFee: number; verifiedPaid: number; pendingProof: number; waived: number }[];
};

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function FinanceOverviewPage() {
  return (
    <ErpGate active="finance" module="finance" titleSuffix="总览">
      {(me) => <Overview me={me} />}
    </ErpGate>
  );
}

function Overview(_props: { me: ErpMe }) {
  const [month, setMonth] = useState(thisMonth());
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard/finance/stats?month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) setStats(j);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month]);

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold font-serif text-ink">💰 财务总览</h2>
          <span className="text-sm text-ink-faint">Finance Overview</span>
        </div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent" />
      </div>
      <FinanceTabs active="overview" />

      {loading ? (
        <p className="p-6 text-sm text-ink-muted">加载中…</p>
      ) : !stats ? (
        <p className="p-6 text-sm text-ink-muted">无法加载统计数据。</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile value={moneyRM(stats.kpis.collected)} label="本月已收（月费）" />
            <Tile value={moneyRM(stats.kpis.expenses)} label="本月支出" />
            <Tile value={moneyRM(stats.kpis.surplus)} label="本月结余 → 盈余互助" accent />
            <Tile value={`${stats.kpis.paidCount} / ${stats.kpis.pledgedCount}`} label="本月已缴人数 / 认捐人数" />
          </div>

          <div>
            <p className="text-[10.5px] tracking-wide text-[#8A7444] uppercase mb-2">各中心 · {stats.month}</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {stats.centres.map((c) => (
                <div key={c.id} className={`border border-border rounded-2xl p-4 ${c.paused ? 'bg-surface-soft' : 'bg-surface'}`}>
                  <div className="flex justify-between items-center gap-2">
                    <b className="text-sm text-ink">{c.name_cn}</b>
                    <span title={c.pausedNote ?? undefined} className={`text-[11px] px-2 py-0.5 rounded-full ${c.paused ? 'text-accent-deep border border-gold-border bg-surface' : 'text-[#3F6B2E] bg-[#E7F0E0]'}`}>
                      {c.paused ? '本月已足 · 已暂停' : '收款中'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-xs text-ink">
                    <span>已收 <b>{moneyRM(c.collected)}</b></span>
                    <span>支出 <b>{moneyRM(c.expenses)}</b></span>
                    <span className="text-[#3F6B2E]">结余 <b>{moneyRM(c.surplus)}</b></span>
                  </div>
                  <div className="mt-2 text-[11px] text-ink-faint">
                    收据簿至 № {c.receiptBookAt ?? '—'} · 财政：{c.financeName ?? '（未指派）'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10.5px] tracking-wide text-[#8A7444] uppercase mb-2">活动收款汇总 · 来自活动模块（只读聚合）</p>
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                      <th className="px-4 py-2.5 font-normal">活动</th>
                      <th className="px-4 py-2.5 font-normal text-right">已批费用合计</th>
                      <th className="px-4 py-2.5 font-normal text-right">已核实收款</th>
                      <th className="px-4 py-2.5 font-normal text-right">待核实</th>
                      <th className="px-4 py-2.5 font-normal text-right">已豁免</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.events.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-muted">暂无活动数据。</td></tr>
                    ) : (
                      stats.events.map((e) => (
                        <tr key={e.code} className="border-b border-border last:border-b-0">
                          <td className="px-4 py-2"><span className="font-mono text-[11px] text-ink-muted">{e.code}</span> {e.title}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{moneyRM(e.approvedFee)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-[#3F6B2E]">{moneyRM(e.verifiedPaid)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{e.pendingProof || '0'}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{e.waived || '0'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-2xl px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${accent ? 'text-[#3F6B2E]' : 'text-ink'}`}>{value}</div>
      <div className="text-[11px] text-ink-muted mt-0.5">{label}</div>
    </div>
  );
}
