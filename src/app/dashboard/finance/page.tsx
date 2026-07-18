// src/app/dashboard/finance/page.tsx
// 财务仪表板 (财务 v2 Phase 2) — the finance LANDING tab. Two shapes off one API:
//   • CENTRE view — an own_center 财政, or an all-centres caller drilled into one:
//     KPI tiles (收入/支出/结余/结存) · 近六个月收支 grouped bars · 本月支出分类 donut ·
//     账户结存 list.
//   • HQ CONSOLIDATED — all_centers with no centre chosen: org KPI tiles, a sortable
//     per-centre compare table (deficit rows flagged ⚠ and red, click to drill), plus
//     the same two charts consolidated.
// committee holds finance:view only, so it lands here read-only and never sees an
// entry or void control — 钱要透明, but transparency is not write access.
// Reads the cash book (finance_transactions) ONLY — fee_payments is NOT unioned,
// because the 月费 income category already carries fee income in the ledger.

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { FinanceTabs } from '@/components/finance-chrome';
import { moneyRM } from '@/lib/finance-display';
import { accountKindLabel, balanceTone, EXPENSE_GROUP_COLOR } from '@/lib/cashbook-display';
import { thisMonthMYT } from '@/lib/finance-cashbook';
import { StatTile } from '@/components/charts/StatTile';
import { GroupedBars } from '@/components/charts/GroupedBars';
import { Donut } from '@/components/charts/Donut';
import { EMERALD, NEUTRAL, ROSE } from '@/components/charts/palette';
import { useT, useLocale } from '@/lib/i18n-react';
import type { Locale } from '@/lib/i18n';

type Centre = { id: string; code: string; name_cn: string };
type Account = { id: string; centre_id: string; kind: string; name: string; is_active: boolean; balance: number };
type PerCentre = { id: string; name: string; income: number; expense: number; net: number; balance: number };
type Pack = {
  month: string;
  scope: { centreId: string | null; locked: boolean };
  centreId: string | null;
  centres: Centre[];
  kpis: { income: number; expense: number; net: number; balance: number };
  trend: { months: string[]; income: number[]; expense: number[] };
  expenseByGroup: { grp: string; value: number }[];
  accounts: Account[];
  perCentre: PerCentre[] | null;
};

const GENESIS_YEAR = 2026;
const MONTHS12 = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const yearLabel = (y: string, locale: Locale): string => (locale === 'zh' ? `${y}年` : y);
const monthChipLabel = (mm: string, locale: Locale): string => (locale === 'zh' ? `${Number(mm)}月` : mm);
const inputCls = 'text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent';

type SortKey = 'name' | 'income' | 'expense' | 'net' | 'balance';

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-2.5 gap-2">
        <b className="text-[14px] text-ink">{title}</b>
        {aside && <span className="text-xs text-ink-faint">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export default function FinanceDashboardPage() {
  const t = useT();
  return (
    <ErpGate active="finance" module="finance" titleSuffix={t('fdash.tab.dashboard')}>
      {(me) => <Dashboard me={me} />}
    </ErpGate>
  );
}

function Dashboard({ me }: { me: ErpMe }) {
  const t = useT();
  const locale = useLocale();
  // committee has view but not edit — the badge tells them why nothing is clickable.
  const canEdit = grantAllows(me.grants, 'finance', 'edit');

  const [month, setMonth] = useState(thisMonthMYT());
  const [selYear, setSelYear] = useState(thisMonthMYT().slice(0, 4));
  const [centreId, setCentreId] = useState(''); // '' = consolidated (all_centers only)
  const [pack, setPack] = useState<Pack | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'net', dir: 'desc' });

  const load = useCallback(() => {
    setLoading(true);
    const sp = new URLSearchParams({ month });
    if (centreId) sp.set('centre_id', centreId);
    fetch(`/api/dashboard/finance/dashboard?${sp.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setPack(j); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month, centreId]);
  useEffect(() => {
    load();
  }, [load]);

  const locked = !!pack?.scope.locked;
  const isOrgView = !!pack?.perCentre; // consolidated only when the API sent a table
  const centres = pack?.centres ?? [];
  const drilledCentre = centres.find((c) => c.id === (pack?.centreId ?? '')) ?? null;

  const sortedCentres = useMemo(() => {
    const rows = pack?.perCentre ? [...pack.perCentre] : [];
    const dir = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) =>
      sort.key === 'name' ? a.name.localeCompare(b.name, 'zh') * dir : (a[sort.key] - b[sort.key]) * dir
    );
    return rows;
  }, [pack?.perCentre, sort]);

  const orgTotals = useMemo(() => {
    const rows = pack?.perCentre ?? [];
    const c = (n: number) => Math.round(n * 100);
    return {
      income: rows.reduce((s, r) => s + c(r.income), 0) / 100,
      expense: rows.reduce((s, r) => s + c(r.expense), 0) / 100,
      net: rows.reduce((s, r) => s + c(r.net), 0) / 100,
      balance: rows.reduce((s, r) => s + c(r.balance), 0) / 100,
    };
  }, [pack?.perCentre]);

  const pieSegments = useMemo(
    () =>
      (pack?.expenseByGroup ?? [])
        .filter((g) => g.value > 0)
        .map((g) => ({ label: t(`cash.grp.${g.grp}`), value: g.value, color: EXPENSE_GROUP_COLOR[g.grp] ?? NEUTRAL })),
    [pack?.expenseByGroup, t]
  );
  const pieTotal = pieSegments.reduce((s, g) => s + g.value, 0);

  const thisYear = Number(thisMonthMYT().slice(0, 4));
  const years = Array.from({ length: Math.max(1, thisYear - GENESIS_YEAR + 1) }, (_, i) => String(GENESIS_YEAR + i));
  const curMonth = thisMonthMYT();

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  const sortMark = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  const k = pack?.kpis;
  const netTone = (k?.net ?? 0) < 0 ? ROSE : EMERALD;

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-xl font-bold font-serif text-ink">{t('fdash.title')}</h2>
        <span className="text-sm text-ink-faint">
          {isOrgView ? t('fdash.subtitleOrg') : t('fdash.subtitleCentre')}
        </span>
        {!canEdit && (
          <span className="text-[11px] px-2 py-0.5 rounded-full pill-muted">{t('fdash.readonly')}</span>
        )}
      </div>
      <FinanceTabs active="dashboard" />

      {/* centre selector — hidden entirely for a locked 财政 (one centre, no choice) */}
      {!locked && centres.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={centreId} onChange={(e) => setCentreId(e.target.value)} className={inputCls}>
            <option value="">{t('fdash.allCentres')}</option>
            {centres.map((c) => <option key={c.id} value={c.id}>{c.name_cn}</option>)}
          </select>
          {centreId && (
            <button onClick={() => setCentreId('')} className="text-[12.5px] text-ink-muted hover:text-accent-deep px-2 py-1">
              {t('fdash.backToOrg')}
            </button>
          )}
        </div>
      )}
      {locked && drilledCentre && <p className="text-sm font-medium text-ink">{drilledCentre.name_cn}</p>}

      {/* month: year control + fixed 12-month grid (the 报表 selector shape) */}
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
              const avail = ym <= curMonth;
              return (
                <button key={mm} disabled={!avail} onClick={() => setMonth(ym)} title={ym}
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

      {loading || !pack || !k ? (
        <p className="p-6 text-sm text-ink-muted">{t('fdash.loading')}</p>
      ) : (
        <>
          {/* KPI tiles */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile value={moneyRM(k.income)} label={t('fdash.kpi.income')} valueColor={EMERALD} />
            <StatTile value={moneyRM(k.expense)} label={t('fdash.kpi.expense')} valueColor={ROSE} />
            <StatTile
              value={moneyRM(k.net)}
              label={t('fdash.kpi.net')}
              valueColor={netTone}
              sub={k.net < 0 ? t('fdash.kpi.netSubDeficit') : t('fdash.kpi.netSubSurplus')}
            />
            <StatTile value={moneyRM(k.balance)} label={t('fdash.kpi.balance')} sub={t('fdash.kpi.balanceSub')} />
          </div>

          {/* charts */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t('fdash.trend.title')}>
              <GroupedBars
                groups={pack.trend.months.map((m, i) => ({
                  label: locale === 'zh' ? `${Number(m.slice(5))}月` : m.slice(5),
                  values: [pack.trend.income[i] ?? 0, pack.trend.expense[i] ?? 0] as [number, number],
                }))}
                series={[
                  { label: t('fdash.trend.income'), color: EMERALD },
                  { label: t('fdash.trend.expense'), color: ROSE },
                ]}
              />
            </Card>

            <Card title={t('fdash.pie.title')}>
              {pieSegments.length === 0 ? (
                <p className="text-sm text-ink-faint py-6">{t('fdash.pie.empty')}</p>
              ) : (
                <Donut
                  segments={pieSegments}
                  centerValue={moneyRM(pieTotal).replace('RM ', '')}
                  centerLabel={t('fdash.pie.center')}
                  valueHeader={t('fdash.pie.valueHeader')}
                  format={moneyRM}
                  showPct
                />
              )}
            </Card>
          </div>

          {/* HQ per-centre compare, or the drilled centre's wallets */}
          {isOrgView ? (
            <Card title={t('fdash.centres.title')} aside={t('fdash.centres.hint')}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                      {([
                        ['name', t('fdash.centres.col.centre'), false],
                        ['income', t('fdash.centres.col.income'), true],
                        ['expense', t('fdash.centres.col.expense'), true],
                        ['net', t('fdash.centres.col.net'), true],
                        ['balance', t('fdash.centres.col.balance'), true],
                      ] as [SortKey, string, boolean][]).map(([key, label, right]) => (
                        <th key={key} className={`px-4 py-2.5 font-normal ${right ? 'text-right' : ''}`}>
                          <button onClick={() => toggleSort(key)} className="hover:text-accent-deep transition">
                            {label}{sortMark(key)}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCentres.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-muted">{t('fdash.centres.empty')}</td></tr>
                    ) : (
                      sortedCentres.map((r) => {
                        const deficit = r.net < 0;
                        return (
                          <tr key={r.id} onClick={() => setCentreId(r.id)}
                            className="border-b border-border last:border-b-0 hover:bg-accent/5 cursor-pointer">
                            <td className="px-4 py-2.5 text-ink">
                              {deficit && <span title={t('fdash.centres.deficitTitle')} className="mr-1 text-[#B4402E]">⚠</span>}
                              {r.name}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-[#3F6B2E]">{moneyRM(r.income)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-[#B4402E]">{moneyRM(r.expense)}</td>
                            <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${deficit ? 'text-[#B4402E]' : 'text-ink'}`}>
                              {moneyRM(r.net)}
                            </td>
                            <td className={`px-4 py-2.5 text-right tabular-nums ${balanceTone(r.balance)}`}>{moneyRM(r.balance)}</td>
                          </tr>
                        );
                      })
                    )}
                    {sortedCentres.length > 0 && (
                      <tr className="border-t-2 border-border">
                        <td className="px-4 py-2.5 text-right text-ink-muted">{t('fdash.centres.total')}</td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums text-[#3F6B2E]">{moneyRM(orgTotals.income)}</td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums text-[#B4402E]">{moneyRM(orgTotals.expense)}</td>
                        <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${orgTotals.net < 0 ? 'text-[#B4402E]' : 'text-ink'}`}>
                          {moneyRM(orgTotals.net)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums text-ink">{moneyRM(orgTotals.balance)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Card title={t('fdash.accounts.title')}>
              {pack.accounts.length === 0 ? (
                <p className="text-sm text-ink-faint py-4">{t('fdash.accounts.empty')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {pack.accounts.map((a) => (
                        <tr key={a.id} className={`border-b border-border last:border-b-0 ${a.is_active ? '' : 'opacity-55'}`}>
                          <td className="px-4 py-2.5 text-ink">{a.name}</td>
                          <td className="px-4 py-2.5">
                            <span className="inline-block px-2 py-0.5 rounded-full text-[11px] pill-gold">{accountKindLabel(a.kind, t)}</span>
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${balanceTone(a.balance)}`}>{moneyRM(a.balance)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-border">
                        <td colSpan={2} className="px-4 py-2.5 text-right text-ink-muted">{t('fdash.accounts.total')}</td>
                        <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${balanceTone(k.balance)}`}>{moneyRM(k.balance)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          <p className="text-xs text-ink-faint">{t('fdash.footer')}</p>
        </>
      )}
    </div>
  );
}
