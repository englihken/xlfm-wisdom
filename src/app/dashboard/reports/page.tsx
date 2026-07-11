// src/app/dashboard/reports/page.tsx
// 报表中心 — the E3 monthly review pack (月度检讨包). Re-gated onto role_grants
// module 'reports' (migration 032): admin manages, erp_admin/committee/
// finance_director view national, centre_head views the own-centre slice (the
// 关怀 / 运营·财务 pages are absent from their payload — never greyed).
//
// One dept page per chip; 演示模式 turns the same pages into the meeting deck
// (fullscreen, ←/→, dot navigator, ESC); 导出 PPT builds a native-chart deck via
// dynamically-imported pptxgenjs (never in the main bundle); print CSS emits one
// dept page per sheet. Charts are the hand-rolled SVG components in
// components/charts (brief §1 — no chart libraries). All new strings via t().

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseBrowserClient, signOutEverywhere } from '@/lib/supabase-browser';
import { PasswordChangeGate } from '@/components/password-change-gate';
import { DashboardNav } from '@/components/dashboard-nav';
import { TopBar } from '@/components/top-bar';
import { grantAllows, type Grants } from '@/lib/access';
import { t } from '@/lib/i18n';
import type { ReportsPack } from '@/lib/reports-pack';
import { StatTile } from '@/components/charts/StatTile';
import { TrendLine } from '@/components/charts/TrendLine';
import { Donut } from '@/components/charts/Donut';
import { HBars } from '@/components/charts/HBars';
import { FunnelBars } from '@/components/charts/FunnelBars';
import { ProgressRing } from '@/components/charts/ProgressRing';
import { GroupedBars } from '@/components/charts/GroupedBars';
import { CAT, NEUTRAL, EMERALD, AZURE, AMBER, ROSE } from '@/components/charts/palette';

type Role = 'admin' | 'volunteer' | 'erp_admin' | 'committee' | 'centre_head';
type Me = { email: string; displayName: string | null; role: Role; grants?: Grants };

const DEPT_META: Record<string, { chip: string; title: string }> = {
  outreach: { chip: 'reports.dept.outreach', title: 'reports.dept.outreach' },
  care: { chip: 'reports.dept.care', title: 'reports.dept.care' },
  ops: { chip: 'reports.dept.ops', title: 'reports.dept.ops' },
  eventsInv: { chip: 'reports.dept.eventsInv', title: 'reports.dept.eventsInv' },
  inbox: { chip: 'reports.dept.inbox', title: 'reports.dept.inbox' },
};

function monthCn(ym: string): string {
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
}

function moneyRM(v: number): string {
  return `RM ${Math.round(v).toLocaleString()}`;
}

export default function ReportsPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [gate, setGate] = useState<'checking' | 'denied' | 'ok'>('checking');

  const [month, setMonth] = useState<string | null>(null);
  const [pack, setPack] = useState<ReportsPack | null>(null);
  const [loading, setLoading] = useState(true);
  const [dept, setDept] = useState('outreach');

  // 演示模式 state — pageIdx indexes pack.pages.
  const [present, setPresent] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);
  const presentRef = useRef(present);
  presentRef.current = present;

  const forceSignOut = useCallback(async () => {
    await signOutEverywhere();
    router.replace('/dashboard/login');
  }, [router]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: authData, error }) => {
      if (error || !authData.user) {
        router.replace('/dashboard/login');
        return;
      }
      setChecking(false);
    });
  }, [router]);

  useEffect(() => {
    if (checking) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/me');
        if (!active) return;
        if (res.status === 401) {
          router.replace('/dashboard/login');
          return;
        }
        if (res.status === 403) {
          await forceSignOut();
          return;
        }
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        setMe({ email: json.email, displayName: json.displayName ?? null, role: json.role, grants: json.grants ?? {} });
        if (json.mustChangePassword) setMustChangePassword(true);
        // E3 gate: the 报表 door opens on the reports grant, not on role.
        setGate(grantAllows(json.grants ?? {}, 'reports', 'view') ? 'ok' : 'denied');
      } catch {
        /* neutral loader covers failure */
      }
    })();
    return () => {
      active = false;
    };
  }, [checking, router, forceSignOut]);

  useEffect(() => {
    if (gate !== 'ok') return;
    let active = true;
    fetch(`/api/reports/pack${month ? `?month=${month}` : ''}`)
      .then((res) => {
        if (res.status === 401) {
          router.replace('/dashboard/login');
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((json) => {
        if (active && json) {
          const p = json as ReportsPack;
          setPack(p);
          setDept((d) => (p.pages.includes(d) ? d : p.pages[0]));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [gate, month, router]);

  // ── 演示模式 wiring (body class + fullscreen + keys + fullscreenchange) ──────
  const enterPresent = () => {
    if (!pack) return;
    setPageIdx(Math.max(0, pack.pages.indexOf(dept)));
    setPresent(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const exitPresent = useCallback(() => {
    setPresent(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    document.body.classList.toggle('rpt-present', present);
    return () => document.body.classList.remove('rpt-present');
  }, [present]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!presentRef.current) return;
      const n = pack?.pages.length ?? 0;
      if (n === 0) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setPageIdx((i) => (i + 1) % n);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPageIdx((i) => (i - 1 + n) % n);
      if (e.key === 'Escape') exitPresent();
    };
    const onFsChange = () => {
      if (!document.fullscreenElement && presentRef.current) setPresent(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [pack, exitPresent]);

  const changeMonth = (m: string) => {
    if (!pack || m === pack.month) return;
    setPack(null);
    setLoading(true);
    setMonth(m);
  };

  // ── 导出 PPT (dynamic import keeps pptxgenjs out of the main bundle) ─────────
  const [exporting, setExporting] = useState(false);
  const exportPpt = async () => {
    if (!pack || exporting) return;
    setExporting(true);
    try {
      await buildPptx(pack);
    } catch (e) {
      console.error('[reports] PPT export failed:', e);
    } finally {
      setExporting(false);
    }
  };

  const handleLogout = async () => {
    await forceSignOut();
    router.refresh();
  };

  if (checking || gate === 'checking') {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-sm text-ink-muted">{t('common.loading')}</p>
      </div>
    );
  }
  if (mustChangePassword) {
    return <PasswordChangeGate onDone={() => setMustChangePassword(false)} />;
  }
  if (gate === 'denied') {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-ink">{t('reports.denied')}</p>
          <p className="mt-2 text-sm text-ink-muted">{t('common.deniedHint')}</p>
          <Link href="/dashboard/home" className="btn-secondary inline-block mt-5 px-4 py-2 text-sm">
            {t('common.backHome')}
          </Link>
        </div>
      </div>
    );
  }

  const activeIdx = pack ? pack.pages.indexOf(dept) : 0;
  const shownIdx = present ? pageIdx : activeIdx;

  return (
    <div className="min-h-screen flex flex-col bg-bg md:ml-[72px] rpt-root">
      {/* 演示模式 + print CSS. Print emits every dept page, one per sheet, B/W-legible. */}
      <style>{`
        body.rpt-present .rpt-hide { display: none !important; }
        body.rpt-present .rpt-root { margin-left: 0 !important; }
        body.rpt-present .rpage { display: none !important; }
        body.rpt-present .rpage[data-on="1"] { display: block !important; }
        body.rpt-present .rpt-ptitle { display: flex !important; }
        body.rpt-present .rpt-pnav { display: flex !important; }
        body.rpt-present .present-hero { font-size: 44px !important; line-height: 1.15; }
        body.rpt-present .present-k { font-size: 15px !important; }
        body.rpt-present .rpt-page-wrap { max-width: 1500px; margin: 0 auto; padding: 34px 60px; }
        @media print {
          .rpt-hide, .rpt-pnav { display: none !important; }
          .rpt-root { margin-left: 0 !important; }
          .rpage { display: block !important; break-after: page; page-break-after: always; }
          .rpage .rpt-print-title { display: block !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="rpt-hide">
        <TopBar moduleTitle={t('reports.moduleTitle')} userLabel={me?.displayName || me?.email || undefined} onLogout={handleLogout} />
        <DashboardNav role={me?.role ?? 'volunteer'} active="reports" grants={me?.grants} />
      </div>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className={`${PAGE_WIDE} space-y-4 rpt-page-wrap`}>
          <div className="flex flex-wrap items-center justify-between gap-3 rpt-hide">
            <h2 className="font-serif text-xl font-bold text-ink">
              {t('reports.title')}
              {pack?.scope.locked && pack.scope.centreName && (
                <span className="ml-2 text-sm font-normal text-ink-muted">{pack.scope.centreName}</span>
              )}
            </h2>
          </div>

          {/* toolbar: month chips + actions */}
          <div className="bg-surface border border-border rounded-2xl px-4 py-3 rpt-hide">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-sm text-ink mr-1">{t('reports.monthLabel')}</b>
              {(pack?.months ?? []).map((m) => (
                <button
                  key={m}
                  onClick={() => changeMonth(m)}
                  className={`px-2.5 py-0.5 rounded-full text-[11.5px] font-semibold border transition ${
                    m === pack?.month ? 'pill-gold' : 'border-border text-ink-muted hover:bg-accent/5'
                  }`}
                >
                  {m}
                </button>
              ))}
              <span className="ml-auto" />
              <button onClick={enterPresent} className="btn-primary px-3.5 py-1 text-[12.5px]" disabled={!pack}>
                {t('reports.present')}
              </button>
              <button onClick={exportPpt} className="btn-secondary px-3 py-1 text-[12.5px]" disabled={!pack || exporting}>
                {exporting ? t('reports.exporting') : t('reports.exportPpt')}
              </button>
              <button onClick={() => window.print()} className="text-[12.5px] text-ink-muted hover:text-accent-deep px-2 py-1">
                {t('reports.print')}
              </button>
              {pack && (
                <a
                  href={`/api/reports/pack.csv?month=${pack.month}&page=${dept}`}
                  className="text-[12.5px] text-ink-faint hover:text-accent-deep px-1 py-1"
                >
                  CSV
                </a>
              )}
            </div>
          </div>

          {/* dept chips */}
          {pack && (
            <div className="flex gap-1.5 flex-wrap rpt-hide">
              {pack.pages.map((p) => (
                <button
                  key={p}
                  onClick={() => setDept(p)}
                  className={`px-3.5 py-1 rounded-full text-[12px] font-semibold border transition ${
                    dept === p ? 'pill-gold' : 'border-border bg-surface text-ink-muted hover:bg-accent/5'
                  }`}
                >
                  {t(DEPT_META[p]?.chip ?? p)}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-ink-muted">{t('common.loading')}</p>
          ) : !pack ? (
            <p className="text-sm text-ink-muted">{t('reports.loadFailed')}</p>
          ) : (
            <>
              {/* 演示模式 slide title + dot navigator */}
              <div className="rpt-ptitle hidden justify-between items-baseline font-serif text-[30px] font-bold text-ink mb-2">
                <span>
                  {t(DEPT_META[pack.pages[shownIdx]]?.title ?? '')} · {monthCn(pack.month)}
                </span>
                <span className="text-sm font-sans font-normal text-ink-muted">{t('reports.presentHint')}</span>
              </div>
              <div className="rpt-pnav hidden fixed bottom-6 left-1/2 -translate-x-1/2 gap-2.5 items-center z-50 bg-surface border border-border rounded-full px-4 py-2 shadow-lg">
                <button onClick={() => setPageIdx((i) => (i - 1 + pack.pages.length) % pack.pages.length)} className="text-base text-ink">
                  ←
                </button>
                <span className="flex gap-1.5">
                  {pack.pages.map((p, i) => (
                    <i key={p} className={`w-[7px] h-[7px] rounded-full ${i === shownIdx ? 'bg-accent' : 'bg-border-strong'}`} />
                  ))}
                </span>
                <button onClick={() => setPageIdx((i) => (i + 1) % pack.pages.length)} className="text-base text-ink">
                  →
                </button>
              </div>

              {pack.pages.map((p, i) => (
                <div
                  key={p}
                  className="rpage space-y-4"
                  data-on={i === shownIdx ? '1' : '0'}
                  style={{ display: !present && p !== dept ? 'none' : undefined }}
                >
                  {/* print-only page title */}
                  <h3 className="rpt-print-title hidden font-serif text-lg font-bold text-ink">
                    {t(DEPT_META[p]?.title ?? p)} · {monthCn(pack.month)}
                  </h3>
                  {p === 'outreach' && <OutreachPage pack={pack} />}
                  {p === 'care' && pack.care && <CarePage pack={pack} />}
                  {p === 'ops' && pack.ops && <OpsPage pack={pack} />}
                  {p === 'eventsInv' && <EventsInvPage pack={pack} />}
                  {p === 'inbox' && <InboxPage pack={pack} />}
                </div>
              ))}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ── shared card ───────────────────────────────────────────────────────────────
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

// A 0-data block renders 淡显 with a gentle note, never crashes (brief §2 ops).
function Faded({ note, children, when }: { note: string; when: boolean; children: React.ReactNode }) {
  if (!when) return <>{children}</>;
  return (
    <div>
      <div className="opacity-50 pointer-events-none">{children}</div>
      <p className="text-xs text-ink-faint mt-2">{note}</p>
    </div>
  );
}

// ── 渡人 page ─────────────────────────────────────────────────────────────────
function OutreachPage({ pack }: { pack: ReportsPack }) {
  const o = pack.outreach;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          value={o.newContacts}
          label={t('reports.outreach.newContacts')}
          sub={`${t('reports.prevMonth')} ${o.newContactsPrev}`}
          delta={o.newContactsDelta ?? undefined}
        />
        <StatTile
          value={o.chanting}
          valueColor={EMERALD}
          label={t('reports.outreach.chanting')}
          sub={`${t('reports.prevMonth')} ${o.chantingPrev} · ${t('reports.outreach.chantingSub')}`}
          delta={o.chantingDelta ?? undefined}
        />
        <StatTile
          value={o.volunteersWindow}
          label={`${t('reports.outreach.volunteers')}（${t('reports.windowPrefix')}${pack.windowDays}${t('reports.windowSuffix')}）`}
          sub={t('reports.outreach.volunteersSub')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('reports.outreach.trendTitle')}>
          <TrendLine
            labels={o.trend.months}
            series={[
              { label: t('reports.outreach.seriesNew'), color: AZURE, points: o.trend.newContacts },
              { label: t('reports.outreach.seriesChanting'), color: EMERALD, points: o.trend.chanting },
            ]}
          />
        </Card>
        <Card title={t('reports.outreach.sourcesTitle')} aside={`${t('reports.outreach.sourcesTotal')} ${o.newContacts}`}>
          <Donut
            segments={o.sources.map((s, i) => ({
              label: s.label,
              value: s.value,
              color: s.label === '其他' ? NEUTRAL : CAT[i % CAT.length],
            }))}
            centerValue={o.newContacts}
            centerLabel={t('reports.outreach.seriesNew')}
            valueHeader={t('reports.col.count')}
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title={`${t('reports.outreach.funnelTitle')} · ${t('reports.windowPrefix')}${pack.windowDays}${t('reports.windowSuffix')}`}
          aside={t('reports.outreach.funnelWindowNote')}
        >
          <FunnelBars steps={o.funnel.map((f) => ({ label: f.label, value: f.value }))} labelHeader={t('reports.col.stage')} valueHeader={t('reports.col.count')} />
          <p className="text-xs text-ink-faint mt-2">{t('reports.outreach.funnelFoot')}</p>
        </Card>
        <Card title={t('reports.outreach.centresTitle')} aside={t('reports.outreach.centresNote')}>
          <HBars
            rows={o.centres.map((c) => ({
              label: c.name,
              value: c.chanting,
              sub: `${t('reports.outreach.seriesNew')} ${c.newContacts}`,
            }))}
            color={EMERALD}
            labelHeader={t('reports.col.centre')}
            valueHeader={t('reports.outreach.seriesChanting')}
          />
        </Card>
      </div>

      <Card title={t('reports.outreach.eventsTitle')} aside={t('reports.outreach.eventsSub')}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                <th className="px-2 py-1.5 font-normal">{t('reports.col.event')}</th>
                <th className="px-2 py-1.5 font-normal">{t('reports.col.month')}</th>
                <th className="px-2 py-1.5 font-normal">{t('reports.col.registrations')}</th>
                <th className="px-2 py-1.5 font-normal">{t('reports.col.newContacts')}</th>
                <th className="px-2 py-1.5 font-normal">
                  {t('reports.col.chanting')}≤{pack.windowDays}
                  {t('reports.windowSuffix')}
                </th>
                <th className="px-2 py-1.5 font-normal">{t('reports.col.conversion')}</th>
              </tr>
            </thead>
            <tbody>
              {o.events.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-sm text-ink-faint">
                    {t('charts.noData')}
                  </td>
                </tr>
              )}
              {o.events.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-b-0">
                  <td className="px-2 py-2 text-ink font-medium">{e.title}</td>
                  <td className="px-2 py-2 text-ink-muted">{e.month}</td>
                  {e.upcoming ? (
                    <td colSpan={3} className="px-2 py-2 text-ink-faint">
                      {t('reports.outreach.eventUpcoming')}
                    </td>
                  ) : (
                    <>
                      <td className="px-2 py-2 tabular-nums text-ink">{e.registrations}</td>
                      <td className="px-2 py-2 tabular-nums text-ink">{e.newContacts}</td>
                      <td className="px-2 py-2 tabular-nums font-bold" style={{ color: EMERALD }}>
                        {e.chanting}
                      </td>
                    </>
                  )}
                  <td className="px-2 py-2">
                    {e.ratePct !== null ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#E7F2EC] text-[#2F7D5E] border border-[#CDE4D8]">
                        {e.ratePct}%
                      </span>
                    ) : (
                      <span className="pill-muted inline-block px-2 py-0.5 rounded-full text-[11px]">{t('reports.outreach.eventPending')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-faint mt-2">{t('reports.outreach.noCheckinFoot')}</p>
      </Card>
    </>
  );
}

// ── 关怀 page (relocated care-report queries) ─────────────────────────────────
function CarePage({ pack }: { pack: ReportsPack }) {
  const c = pack.care!;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          value={c.conversations}
          label={t('reports.care.conversations')}
          sub={`${t('reports.prevMonth')} ${c.conversationsPrev}`}
          delta={c.conversationsDelta ?? undefined}
        />
        <StatTile value={c.crisis} valueColor={c.crisis > 0 ? ROSE : undefined} label={`${t('reports.care.crisis')} ⚠`} sub={t('reports.care.crisisSub')} />
        <StatTile
          value={c.chatNewContacts}
          label={t('reports.care.chatNew')}
          sub={t('reports.care.chatNewSub')}
          delta={c.chatNewContactsDelta ?? undefined}
        />
      </div>
      <Card title={t('reports.care.categoriesTitle')} aside={t('reports.care.categoriesNote')}>
        <Faded when={c.categories.length === 0} note={t('charts.noData')}>
          <HBars
            rows={c.categories.map((x) => ({ label: x.label, value: x.value }))}
            color={AZURE}
            labelHeader={t('reports.col.category')}
            valueHeader={t('reports.col.count')}
          />
        </Faded>
      </Card>
    </>
  );
}

// ── 运营·财务 page ────────────────────────────────────────────────────────────
function OpsPage({ pack }: { pack: ReportsPack }) {
  const o = pack.ops!;
  const noFinance = o.income === 0 && o.expenses === 0;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile value={o.activeMembers} label={t('reports.ops.activeMembers')} />
        <div className="bg-surface border border-border rounded-2xl px-[18px] py-[14px]">
          <div className="float-right -mt-1">
            <ProgressRing pct={o.coverage.pct} />
          </div>
          <div className="text-[12.5px] text-ink-muted mt-1.5 present-k">{t('reports.ops.coverage')}</div>
          <div className="text-[11px] text-ink-faint mt-0.5">{t('reports.ops.coverageSub')}</div>
          <div className="text-[11px] text-ink-faint mt-0.5 tabular-nums">
            {o.coverage.paid} / {o.coverage.pledged}
          </div>
        </div>
        <StatTile value={moneyRM(o.income)} label={t('reports.ops.income')} sub={t('reports.ops.incomeSub')} />
        <StatTile value={moneyRM(o.expenses)} label={t('reports.ops.expenses')} sub={`${t('reports.ops.surplus')} ${moneyRM(o.surplus)}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('reports.ops.sixMonthTitle')}>
          <Faded when={noFinance && o.sixMonth.income.every((v) => v === 0)} note={t('reports.ops.noDataNote')}>
            <GroupedBars
              groups={o.sixMonth.months.map((m, i) => ({
                label: `${Number(m.slice(5))}月`,
                values: [o.sixMonth.income[i], o.sixMonth.expenses[i]] as [number, number],
              }))}
              series={[
                { label: t('reports.ops.seriesIncome'), color: EMERALD },
                { label: t('reports.ops.seriesExpenses'), color: AMBER },
              ]}
            />
          </Faded>
        </Card>
        <Card title={t('reports.ops.centreCoverageTitle')} aside={t('reports.outreach.centresNote')}>
          <Faded when={o.centreCoverage.length === 0} note={t('reports.ops.noDataNote')}>
            <HBars
              rows={o.centreCoverage.map((c) => ({
                label: c.name,
                value: Math.round(c.pct),
                display: `${Math.round(c.pct)}%`,
                sub: `${c.paid}/${c.pledged}`,
              }))}
              color={EMERALD}
              max={100}
              labelHeader={t('reports.col.centre')}
              valueHeader={t('reports.ops.coverage')}
            />
          </Faded>
          <p className="text-xs text-ink-faint mt-2">{t('reports.ops.centreCoverageFoot')}</p>
        </Card>
      </div>
    </>
  );
}

// ── 活动·库存 page ────────────────────────────────────────────────────────────
function EventsInvPage({ pack }: { pack: ReportsPack }) {
  const e = pack.eventsInv;
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('reports.eventsInv.capacityTitle')}>
          <Faded when={e.capacity.length === 0} note={t('reports.eventsInv.noOpenEvents')}>
            <HBars
              rows={e.capacity.map((c) => ({
                label: c.title,
                value: c.registrations,
                sub: `/ ${c.capacity}`,
              }))}
              color={AZURE}
              track
              max={Math.max(1, ...e.capacity.map((c) => c.capacity))}
              labelHeader={t('reports.col.event')}
              valueHeader={t('reports.col.registrations')}
            />
          </Faded>
          <p className="text-xs text-ink-faint mt-2">{t('reports.eventsInv.capacityFoot')}</p>
        </Card>
        <Card title={`⚠ ${t('reports.eventsInv.lowStockTitle')}`} aside={t('reports.eventsInv.lowStockNote')}>
          <Faded when={e.lowStock.length === 0} note={t('reports.eventsInv.noLowStock')}>
            <HBars
              rows={e.lowStock.map((i) => ({
                label: i.name,
                value: i.qty,
                sub: `/ ${i.line}`,
                warn: true,
              }))}
              color={ROSE}
              track
              max={Math.max(1, ...e.lowStock.map((i) => i.line))}
              labelHeader={t('reports.col.item')}
              valueHeader={t('reports.eventsInv.currentQty')}
            />
          </Faded>
          <p className="text-xs text-ink-faint mt-2">
            {t('reports.eventsInv.statusColorFoot')} {t('reports.eventsInv.stocktakeDiff')} {e.stocktakeDiff} · {t('reports.eventsInv.releasePhotos')} {e.releasePhotos}
          </p>
        </Card>
      </div>
    </>
  );
}

// ── 收件箱健康 page ───────────────────────────────────────────────────────────
function InboxPage({ pack }: { pack: ReportsPack }) {
  const ib = pack.inbox;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ib.board.slice(0, 3).map((b) => (
          <div key={b.centre_name} className="bg-surface border border-border rounded-2xl px-[17px] py-[14px]">
            <div className="font-bold text-[14.5px] text-ink">{b.centre_name}</div>
            <div className="text-[11.5px] text-ink-muted mt-0.5">
              {t('reports.inbox.owners')}：{b.owners_label}
            </div>
            <div className="flex gap-[18px] mt-2.5">
              <div>
                <div className="text-[22px] font-extrabold tabular-nums text-ink">{b.new_n}</div>
                <div className="text-[11px] text-ink-muted">{t('reports.inbox.unhandled')}</div>
              </div>
              <div>
                <div className="text-[22px] font-extrabold tabular-nums text-ink">
                  {b.oldest_unhandled_days > 0 ? `${b.oldest_unhandled_days}${t('reports.daySuffix')}` : '—'}
                </div>
                <div className="text-[11px] text-ink-muted">{t('reports.inbox.oldest')}</div>
              </div>
              <div>
                <div className="text-[22px] font-extrabold tabular-nums" style={{ color: b.crisis_n > 0 ? ROSE : undefined }}>
                  {b.crisis_n}
                </div>
                <div className="text-[11px] text-ink-muted">{t('reports.inbox.crisis')}</div>
              </div>
            </div>
          </div>
        ))}
        <StatTile
          value={ib.avgFirstResponseDays !== null ? `${ib.avgFirstResponseDays}${t('reports.daySuffix')}` : '—'}
          label={t('reports.inbox.avgFirstResponse')}
          sub={t('reports.inbox.avgFirstResponseSub')}
        />
      </div>
      {ib.board.length > 3 && (
        <Card title={t('reports.inbox.boardTitle')}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <th className="px-2 py-1.5 font-normal">{t('reports.inbox.mailbox')}</th>
                  <th className="px-2 py-1.5 font-normal">{t('reports.inbox.owners')}</th>
                  <th className="px-2 py-1.5 font-normal">{t('reports.inbox.unhandled')}</th>
                  <th className="px-2 py-1.5 font-normal">{t('reports.inbox.oldest')}</th>
                  <th className="px-2 py-1.5 font-normal">{t('reports.inbox.crisis')}</th>
                </tr>
              </thead>
              <tbody>
                {ib.board.map((b) => (
                  <tr key={b.centre_name} className="border-b border-border last:border-b-0">
                    <td className="px-2 py-1.5 text-ink">{b.centre_name}</td>
                    <td className="px-2 py-1.5 text-ink-muted">{b.owners_label}</td>
                    <td className="px-2 py-1.5 tabular-nums text-ink">{b.new_n}</td>
                    <td className="px-2 py-1.5 tabular-nums text-ink-muted">
                      {b.oldest_unhandled_days > 0 ? `${b.oldest_unhandled_days}${t('reports.daySuffix')}` : '—'}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums" style={{ color: b.crisis_n > 0 ? ROSE : undefined }}>
                      {b.crisis_n}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Card title={`${t('reports.inbox.surfacedTitle')}（${ib.surfaceDays}${t('reports.daySuffix')}）`} aside={t('reports.inbox.surfacedNote')}>
        {ib.surfaced.length === 0 ? (
          <p className="text-sm text-ink-faint">{t('reports.inbox.noSurfaced')}</p>
        ) : (
          <ul className="space-y-1.5">
            {ib.surfaced.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-[13px] border-b border-border last:border-b-0 py-1.5">
                <span className="text-ink truncate">「{s.subject}」</span>
                <span className="shrink-0 text-[12px] font-semibold" style={{ color: '#A07C22' }}>
                  {t('reports.inbox.agedPrefix')} {s.age_days} {t('reports.daySuffix')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

// ── PPT export (brief §2 导出 PPT): title slide + one slide per dept page, hero
// numbers as text + NATIVE pptx charts in the binding palette, footer page
// numbers. pptxgenjs is dynamically imported so it never enters the main bundle.
async function buildPptx(pack: ReportsPack) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  const P = { emerald: '009E63', azure: '0E86D4', amber: 'D97706', violet: '7C5CDB', neutral: 'A79E8B', rose: 'B04A4A', ink: '33302A', muted: '948A76' };
  pptx.defineSlideMaster({
    title: 'E3',
    background: { color: 'FFFFFF' },
    slideNumber: { x: 9.2, y: 5.3, color: P.muted, fontSize: 10 },
  });
  const mcn = monthCn(pack.month);

  // title slide
  const s0 = pptx.addSlide({ masterName: 'E3' });
  s0.addText(t('reports.packTitle'), { x: 0.6, y: 1.9, w: 8.8, h: 0.9, fontSize: 40, bold: true, color: P.ink });
  s0.addText(`${mcn} · ${t('reports.orgName')}`, { x: 0.62, y: 2.9, w: 8.8, h: 0.5, fontSize: 18, color: P.muted });
  if (pack.scope.locked && pack.scope.centreName) {
    s0.addText(pack.scope.centreName, { x: 0.62, y: 3.5, w: 8.8, h: 0.4, fontSize: 14, color: P.muted });
  }

  const heroRow = (
    slide: ReturnType<typeof pptx.addSlide>,
    heroes: { v: string; k: string; color?: string }[]
  ) => {
    heroes.forEach((h, i) => {
      const x = 0.5 + i * 3.1;
      slide.addText(h.v, { x, y: 0.85, w: 2.9, h: 0.7, fontSize: 32, bold: true, color: h.color ?? P.ink });
      slide.addText(h.k, { x, y: 1.5, w: 2.9, h: 0.35, fontSize: 12, color: P.muted });
    });
  };
  const slideTitle = (slide: ReturnType<typeof pptx.addSlide>, txt: string) => {
    slide.addText(`${txt} · ${mcn}`, { x: 0.5, y: 0.25, w: 9, h: 0.5, fontSize: 22, bold: true, color: P.ink });
  };

  for (const page of pack.pages) {
    const slide = pptx.addSlide({ masterName: 'E3' });
    slideTitle(slide, t(DEPT_META[page]?.title ?? page));

    if (page === 'outreach') {
      const o = pack.outreach;
      heroRow(slide, [
        { v: String(o.newContacts), k: t('reports.outreach.newContacts') },
        { v: String(o.chanting), k: t('reports.outreach.chanting'), color: P.emerald },
        { v: String(o.volunteersWindow), k: t('reports.outreach.volunteers') },
      ]);
      slide.addChart(pptx.ChartType.line, [
        { name: t('reports.outreach.seriesNew'), labels: o.trend.months, values: o.trend.newContacts },
        { name: t('reports.outreach.seriesChanting'), labels: o.trend.months, values: o.trend.chanting },
      ], {
        x: 0.4, y: 2.1, w: 4.9, h: 3.1,
        chartColors: [P.azure, P.emerald],
        lineSize: 2,
        showLegend: true, legendPos: 'b',
        title: t('reports.outreach.trendTitle'), showTitle: true, titleFontSize: 12, titleColor: P.ink,
      });
      if (o.sources.length > 0) {
        slide.addChart(pptx.ChartType.doughnut, [
          { name: t('reports.outreach.sourcesTitle'), labels: o.sources.map((s) => s.label), values: o.sources.map((s) => s.value) },
        ], {
          x: 5.5, y: 2.1, w: 4.1, h: 3.1,
          chartColors: o.sources.map((s, i) => (s.label === '其他' ? P.neutral : [P.emerald, P.azure, P.amber, P.violet][i % 4])),
          showLegend: true, legendPos: 'r',
          title: t('reports.outreach.sourcesTitle'), showTitle: true, titleFontSize: 12, titleColor: P.ink,
        });
      }
    } else if (page === 'care' && pack.care) {
      const c = pack.care;
      heroRow(slide, [
        { v: String(c.conversations), k: t('reports.care.conversations') },
        { v: String(c.crisis), k: `${t('reports.care.crisis')} ⚠`, color: c.crisis > 0 ? P.rose : P.ink },
        { v: String(c.chatNewContacts), k: t('reports.care.chatNew') },
      ]);
      if (c.categories.length > 0) {
        slide.addChart(pptx.ChartType.bar, [
          { name: t('reports.care.categoriesTitle'), labels: c.categories.map((x) => x.label), values: c.categories.map((x) => x.value) },
        ], {
          x: 0.4, y: 2.1, w: 9.2, h: 3.1,
          barDir: 'bar',
          chartColors: [P.azure],
          showLegend: false,
          title: t('reports.care.categoriesTitle'), showTitle: true, titleFontSize: 12, titleColor: P.ink,
        });
      }
    } else if (page === 'ops' && pack.ops) {
      const o = pack.ops;
      heroRow(slide, [
        { v: String(o.activeMembers), k: t('reports.ops.activeMembers') },
        { v: `${Math.round(o.coverage.pct)}%`, k: t('reports.ops.coverage'), color: P.emerald },
        { v: moneyRM(o.income), k: t('reports.ops.income') },
      ]);
      slide.addText(`${t('reports.ops.expenses')} ${moneyRM(o.expenses)} · ${t('reports.ops.surplus')} ${moneyRM(o.surplus)}`, {
        x: 0.5, y: 1.85, w: 9, h: 0.3, fontSize: 12, color: P.muted,
      });
      slide.addChart(pptx.ChartType.bar, [
        { name: t('reports.ops.seriesIncome'), labels: o.sixMonth.months.map((m) => `${Number(m.slice(5))}月`), values: o.sixMonth.income },
        { name: t('reports.ops.seriesExpenses'), labels: o.sixMonth.months.map((m) => `${Number(m.slice(5))}月`), values: o.sixMonth.expenses },
      ], {
        x: 0.4, y: 2.3, w: 9.2, h: 2.9,
        chartColors: [P.emerald, P.amber],
        showLegend: true, legendPos: 'b',
        title: t('reports.ops.sixMonthTitle'), showTitle: true, titleFontSize: 12, titleColor: P.ink,
      });
    } else if (page === 'eventsInv') {
      const e = pack.eventsInv;
      heroRow(slide, [
        { v: String(e.lowStock.length), k: `⚠ ${t('reports.eventsInv.lowStockTitle')}`, color: e.lowStock.length > 0 ? P.rose : P.ink },
        { v: String(e.stocktakeDiff), k: t('reports.eventsInv.stocktakeDiff') },
        { v: String(e.releasePhotos), k: t('reports.eventsInv.releasePhotos') },
      ]);
      if (e.capacity.length > 0) {
        slide.addChart(pptx.ChartType.bar, [
          { name: t('reports.col.registrations'), labels: e.capacity.map((c) => c.title), values: e.capacity.map((c) => c.registrations) },
          { name: t('reports.eventsInv.capacityLabel'), labels: e.capacity.map((c) => c.title), values: e.capacity.map((c) => c.capacity) },
        ], {
          x: 0.4, y: 2.1, w: 9.2, h: 3.1,
          barDir: 'bar',
          chartColors: [P.azure, 'EEE8DB'],
          showLegend: true, legendPos: 'b',
          title: t('reports.eventsInv.capacityTitle'), showTitle: true, titleFontSize: 12, titleColor: P.ink,
        });
      }
    } else if (page === 'inbox') {
      const ib = pack.inbox;
      heroRow(slide, [
        {
          v: ib.avgFirstResponseDays !== null ? `${ib.avgFirstResponseDays}${t('reports.daySuffix')}` : '—',
          k: t('reports.inbox.avgFirstResponse'),
        },
        { v: String(ib.board.reduce((s, b) => s + b.new_n, 0)), k: t('reports.inbox.unhandled') },
        { v: String(ib.board.reduce((s, b) => s + b.crisis_n, 0)), k: t('reports.inbox.crisis') },
      ]);
      const rows = [
        [t('reports.inbox.mailbox'), t('reports.inbox.owners'), t('reports.inbox.unhandled'), t('reports.inbox.oldest'), t('reports.inbox.crisis')].map((h) => ({
          text: h,
          options: { bold: true, color: P.muted, fontSize: 11 },
        })),
        ...ib.board.slice(0, 8).map((b) =>
          [b.centre_name, b.owners_label, String(b.new_n), b.oldest_unhandled_days > 0 ? `${b.oldest_unhandled_days}${t('reports.daySuffix')}` : '—', String(b.crisis_n)].map(
            (v) => ({ text: v, options: { color: P.ink, fontSize: 11 } })
          )
        ),
      ];
      slide.addTable(rows, { x: 0.4, y: 2.1, w: 9.2, colW: [2.2, 3, 1.3, 1.4, 1.3], border: { type: 'solid', color: 'EEE8DB', pt: 0.5 } });
    }
  }

  await pptx.writeFile({ fileName: `${t('reports.packTitle')}-${pack.month}.pptx` });
}
