// src/app/dashboard/finance/overview/page.tsx
// 财务总览 (D1) — WAS the finance landing tab; 财务 v2 Phase 2 moved the landing to the
// new 仪表板 at /dashboard/finance and parked this here unchanged. It reads the LEGACY
// fee_payments/expenses tables, which the v2 cash book does not touch, so the two
// surfaces answer different questions. Retire or fold in once Ken has reviewed v2.
// 财务总览 (D1). Scope-aware: 财务总监 sees all centres, an own_center
// 财政 sees only their own numbers. 4 stat tiles (本月已收 / 支出 / 结余 / 已缴·认捐 人数), then a
// state-GROUPED overview of every in-scope centre — 表格 (default on desktop) or 卡片 (default on
// <md), toggled by a segment. Both views band centres by state (band order = min sort in group,
// rows within a group by sort) with 已收 + 结余 subtotals, and click a row/card straight through
// to that centre's 月费台账. NO ranking anywhere. Below: the 活动收款汇总 (read-only aggregate
// from the events wing). All from /api/dashboard/finance/stats. Strings via t().

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { FinanceTabs } from '@/components/finance-chrome';
import { moneyRM } from '@/lib/finance-display';
import { useT, useLocale } from '@/lib/i18n-react';
import { centreName } from '@/lib/centre-name';

type Centre = {
  id: string;
  code: string;
  name_cn: string;
  name_en: string | null;
  state: string;
  sort: number;
  collected: number;
  expenses: number;
  surplus: number;
  pledgedCount: number;
  paidCount: number;
  paused: boolean;
  pausedNote: string | null;
  receiptBookAt: string | null;
  financeName: string | null;
};
type Stats = {
  month: string;
  kpis: { collected: number; expenses: number; surplus: number; pledgedCount: number; paidCount: number };
  centres: Centre[];
  events: { code: string; title: string; approvedFee: number; verifiedPaid: number; pendingProof: number; waived: number }[];
};

const thisMonth = () => new Date().toISOString().slice(0, 7);
type ViewMode = 'table' | 'card';

// Preserve API order (sorted by `sort`), so band order = min sort in group and
// rows within a group are already sort-ordered. NO ranking by amount.
function groupByState(centres: Centre[]): { state: string; centres: Centre[] }[] {
  const groups: { state: string; centres: Centre[] }[] = [];
  const idx = new Map<string, number>();
  for (const c of centres) {
    let i = idx.get(c.state);
    if (i == null) {
      i = groups.length;
      idx.set(c.state, i);
      groups.push({ state: c.state, centres: [] });
    }
    groups[i].centres.push(c);
  }
  return groups;
}

export default function FinanceOverviewPage() {
  const t = useT();
  return (
    <ErpGate active="finance" module="finance" titleSuffix={t('finance.tab.overview')}>
      {(me) => <Overview me={me} />}
    </ErpGate>
  );
}

function Overview(_props: { me: ErpMe }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [month, setMonth] = useState(thisMonth());
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  // Default 表格 on desktop, 卡片 on <md. No persistence.
  const [view, setView] = useState<ViewMode>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'card' : 'table'
  );

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

  // Row/card → that centre's 月费台账, centre + year preselected.
  const openLedger = (centreId: string) => {
    const year = month.slice(0, 4);
    router.push(`/dashboard/finance/ledger?centre=${encodeURIComponent(centreId)}&year=${year}`);
  };

  const groups = stats ? groupByState(stats.centres) : [];

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold font-serif text-ink">{t('finance.overview.title')}</h2>
          {t('finance.overview.subtitle') && (
            <span className="text-sm text-ink-faint">{t('finance.overview.subtitle')}</span>
          )}
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent"
        />
      </div>
      <FinanceTabs active="overview" />

      {loading ? (
        <p className="p-6 text-sm text-ink-muted">{t('common.loading')}</p>
      ) : !stats ? (
        <p className="p-6 text-sm text-ink-muted">{t('finance.overview.loadFailed')}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile value={moneyRM(stats.kpis.collected)} label={t('finance.kpi.collected')} />
            <Tile value={moneyRM(stats.kpis.expenses)} label={t('finance.kpi.expenses')} />
            <Tile value={moneyRM(stats.kpis.surplus)} label={t('finance.kpi.surplus')} accent />
            <Tile value={`${stats.kpis.paidCount} / ${stats.kpis.pledgedCount}`} label={t('finance.kpi.paidPledged')} />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10.5px] tracking-wide text-[#8A7444] uppercase">
                {t('finance.overview.centresHeading', { month: stats.month })}
              </p>
              <ViewToggle view={view} onChange={setView} t={t} />
            </div>

            {view === 'table' ? (
              <CentreTable groups={groups} locale={locale} t={t} onOpen={openLedger} />
            ) : (
              <CentreCards groups={groups} locale={locale} t={t} onOpen={openLedger} />
            )}
          </div>

          <div>
            <p className="text-[10.5px] tracking-wide text-[#8A7444] uppercase mb-2">{t('finance.overview.eventsHeading')}</p>
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                      <th className="px-4 py-2.5 font-normal">{t('finance.events.col.event')}</th>
                      <th className="px-4 py-2.5 font-normal text-right">{t('finance.events.col.approved')}</th>
                      <th className="px-4 py-2.5 font-normal text-right">{t('finance.events.col.verified')}</th>
                      <th className="px-4 py-2.5 font-normal text-right">{t('finance.events.col.pending')}</th>
                      <th className="px-4 py-2.5 font-normal text-right">{t('finance.events.col.waived')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.events.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-muted">{t('finance.events.empty')}</td></tr>
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

function ViewToggle({ view, onChange, t }: { view: ViewMode; onChange: (v: ViewMode) => void; t: (k: string) => string }) {
  const seg = (v: ViewMode, label: string) => (
    <button
      onClick={() => onChange(v)}
      aria-pressed={view === v}
      className={`px-3 py-1.5 text-xs rounded-md transition ${
        view === v ? 'bg-surface text-ink shadow-sm font-medium' : 'text-ink-muted hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-soft border border-border">
      {seg('table', t('finance.view.table'))}
      {seg('card', t('finance.view.card'))}
    </div>
  );
}

function StatusPill({ paused, note, t }: { paused: boolean; note: string | null; t: (k: string) => string }) {
  return (
    <span
      title={note ?? undefined}
      className={`inline-block text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${
        paused ? 'text-accent-deep border border-gold-border bg-surface' : 'text-[#3F6B2E] bg-[#E7F0E0]'
      }`}
    >
      {paused ? t('finance.status.paused') : t('finance.status.collecting')}
    </span>
  );
}

function Treasurer({ name, t }: { name: string | null; t: (k: string) => string }) {
  if (name) return <span className="text-ink">{name}</span>;
  return <span className="text-[#B04A4A]">{t('finance.treasurer.unassigned')}</span>;
}

function bandTotals(centres: Centre[]) {
  return centres.reduce(
    (a, c) => ({ collected: a.collected + c.collected, surplus: a.surplus + c.surplus }),
    { collected: 0, surplus: 0 }
  );
}

function CentreTable({
  groups,
  locale,
  t,
  onOpen,
}: {
  groups: { state: string; centres: Centre[] }[];
  locale: string;
  t: (k: string, p?: Record<string, string | number>) => string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-ink-faint border-b border-border">
              <th className="px-4 py-2.5 font-normal">{t('finance.col.centre')}</th>
              <th className="px-3 py-2.5 font-normal">{t('finance.col.status')}</th>
              <th className="px-3 py-2.5 font-normal text-right">{t('finance.col.paidPledged')}</th>
              <th className="px-3 py-2.5 font-normal text-right">{t('finance.col.collectedFee')}</th>
              <th className="px-3 py-2.5 font-normal text-right">{t('finance.col.expenses')}</th>
              <th className="px-3 py-2.5 font-normal text-right">{t('finance.col.surplus')}</th>
              <th className="px-3 py-2.5 font-normal">{t('finance.col.receiptBook')}</th>
              <th className="px-3 py-2.5 font-normal">{t('finance.col.treasurer')}</th>
              <th className="px-2 py-2.5 font-normal" aria-hidden="true"></th>
            </tr>
          </thead>
          {groups.map((g) => {
              const sub = bandTotals(g.centres);
              return (
                <tbody key={g.state}>
                  <tr className="bg-surface-soft border-b border-border">
                    <td colSpan={9} className="px-4 py-2 text-[12px] text-ink">
                      <span className="font-semibold">📍 {g.state}</span>
                      <span className="text-ink-muted"> · {t('finance.overview.centresCount', { n: g.centres.length })}</span>
                      <span className="text-ink-muted"> · {t('finance.col.collected')} </span>
                      <b className="tabular-nums">{moneyRM(sub.collected)}</b>
                      <span className="text-ink-muted"> · {t('finance.col.surplus')} </span>
                      <b className="tabular-nums text-[#3F6B2E]">{moneyRM(sub.surplus)}</b>
                    </td>
                  </tr>
                  {g.centres.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => onOpen(c.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpen(c.id);
                        }
                      }}
                      className="border-b border-border last:border-b-0 hover:bg-accent/5 cursor-pointer"
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-ink">{centreName(c, locale)}</div>
                        {c.name_en && locale === 'zh' && <div className="text-[10.5px] text-ink-faint">{c.name_en}</div>}
                      </td>
                      <td className="px-3 py-2.5"><StatusPill paused={c.paused} note={c.pausedNote} t={t} /></td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{c.paidCount} / {c.pledgedCount}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{moneyRM(c.collected)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{moneyRM(c.expenses)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#3F6B2E]">{moneyRM(c.surplus)}</td>
                      <td className="px-3 py-2.5 text-ink-muted whitespace-nowrap">{c.receiptBookAt ? `№ ${c.receiptBookAt}` : '—'}</td>
                      <td className="px-3 py-2.5 text-[12px]"><Treasurer name={c.financeName} t={t} /></td>
                      <td className="px-2 py-2.5 text-ink-faint" aria-hidden="true">›</td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
        </table>
      </div>
    </div>
  );
}

function CentreCards({
  groups,
  locale,
  t,
  onOpen,
}: {
  groups: { state: string; centres: Centre[] }[];
  locale: string;
  t: (k: string, p?: Record<string, string | number>) => string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const sub = bandTotals(g.centres);
        return (
          <div key={g.state}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-2 text-[12px]">
              <span className="font-semibold text-ink">📍 {g.state}</span>
              <span className="text-ink-muted">· {t('finance.overview.centresCount', { n: g.centres.length })}</span>
              <span className="text-ink-muted">· {t('finance.col.collected')} <b className="tabular-nums">{moneyRM(sub.collected)}</b></span>
              <span className="text-ink-muted">· {t('finance.col.surplus')} <b className="tabular-nums text-[#3F6B2E]">{moneyRM(sub.surplus)}</b></span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {g.centres.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onOpen(c.id)}
                  className={`text-left border border-border rounded-2xl p-4 hover:border-accent transition ${c.paused ? 'bg-surface-soft' : 'bg-surface'}`}
                >
                  <div className="flex justify-between items-center gap-2">
                    <b className="text-sm text-ink">{centreName(c, locale)}</b>
                    <StatusPill paused={c.paused} note={c.pausedNote} t={t} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-xs text-ink">
                    <span>{t('finance.col.collected')} <b>{moneyRM(c.collected)}</b></span>
                    <span>{t('finance.col.expenses')} <b>{moneyRM(c.expenses)}</b></span>
                    <span className="text-[#3F6B2E]">{t('finance.col.surplus')} <b>{moneyRM(c.surplus)}</b></span>
                    <span>{t('finance.col.paidPledged')} <b>{c.paidCount} / {c.pledgedCount}</b></span>
                  </div>
                  <div className="mt-2 text-[11px] text-ink-faint">
                    {t('finance.col.receiptBook')} {c.receiptBookAt ? `№ ${c.receiptBookAt}` : '—'} · {t('finance.col.treasurer')}：
                    {c.financeName ?? t('finance.treasurer.unassigned')}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
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
