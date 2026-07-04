// src/app/dashboard/reports/page.tsx
// 报表 — admin-only reporting. Same client-side auth gate + /me pattern as the inbox
// and settings: redirect on no session, sign out on 403, and non-admins see a polite
// notice (the /api/dashboard/reports route would 403 them regardless — UI hiding is
// not security). Charts are pure CSS/JSX; no chart libraries.
//
// All setState lives inside async callbacks or event handlers, never synchronously in
// an effect body, to satisfy the React-compiler set-state-in-effect ESLint rule.

'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { PasswordChangeGate } from '@/components/password-change-gate';
import { DashboardNav } from '@/components/dashboard-nav';

type Role = 'admin' | 'volunteer';
type Me = { email: string; displayName: string | null; role: Role };

type Range = '7d' | '30d' | 'all';

type ReportsData = {
  range: Range;
  categories: { label: string; count: number; isJunk: boolean }[];
  crisisCount: number;
  stages: { stage: string; count: number }[];
  volumeByDay: { date: string; count: number }[];
  totals: { conversations: number; contacts: number };
};

const RANGES: { id: Range; label: string }[] = [
  { id: '7d', label: '最近7天' },
  { id: '30d', label: '最近30天' },
  { id: 'all', label: '全部' },
];

export default function ReportsPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  // Access gate driven by /me AFTER the session check. Until it resolves we show
  // ONLY a neutral loader — never the privileged chrome (title / rail / controls).
  const [gate, setGate] = useState<'checking' | 'denied' | 'ok'>('checking');

  const [range, setRange] = useState<Range>('30d');
  const [data, setData] = useState<ReportsData | null>(null);
  const [reportsLoading, setReportsLoading] = useState(true);

  const handleUnauthorized = useCallback(() => {
    router.replace('/dashboard/login');
  }, [router]);

  const forceSignOut = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace('/dashboard/login');
  }, [router]);

  // Auth gate — mirrors the inbox. setState only inside the async callback.
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

  // Load our own profile once past the gate. 403 = valid session but not an active
  // volunteer → sign out. All setState is inside the async IIFE.
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
        setMe({ email: json.email, displayName: json.displayName ?? null, role: json.role });
        if (json.mustChangePassword) setMustChangePassword(true);
        setGate(json.role === 'admin' ? 'ok' : 'denied');
      } catch {
        /* stays on the neutral loader — no chrome revealed on failure */
      }
    })();
    return () => {
      active = false;
    };
  }, [checking, router, forceSignOut]);

  // Load report metrics for the current range. Fires ONLY after the gate resolves to
  // 'ok' (confirmed admin) — never in parallel with the role check — and again when
  // the range changes. reportsLoading starts true and is set in the range-change
  // handler for refetches, so this effect only writes in its callbacks.
  useEffect(() => {
    if (gate !== 'ok') return;
    let active = true;
    fetch(`/api/dashboard/reports?range=${range}`)
      .then((res) => {
        if (res.status === 401) {
          handleUnauthorized();
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((json) => {
        if (active && json) setData(json as ReportsData);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReportsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [gate, range, handleUnauthorized]);

  // Range pill click — an event handler, so resetting the panel state here keeps the
  // fetch effect free of synchronous setState.
  const changeRange = (next: Range) => {
    if (next === range) return;
    setData(null);
    setReportsLoading(true);
    setRange(next);
  };

  const handleLogout = async () => {
    await forceSignOut();
    router.refresh();
  };

  // Neutral loader while EITHER the session check or the role check is in flight.
  // Nothing here reveals what the page is (no title, rail, top bar, or controls).
  if (checking || gate === 'checking') {
    return (
      <div className="min-h-screen bg-[#FFF3DA] flex items-center justify-center">
        <p className="text-sm text-[#8B6F47]">加载中…</p>
      </div>
    );
  }

  if (mustChangePassword) {
    return <PasswordChangeGate onDone={() => setMustChangePassword(false)} />;
  }

  // Logged in but not an admin — polite notice, same as settings.
  if (gate === 'denied') {
    return (
      <div className="min-h-screen bg-[#FFF3DA] flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-[#583A0F]">此页面仅限管理员</p>
          <p className="mt-2 text-sm text-[#8B6F47]">如需帮助，请联系系统管理员。</p>
          <Link
            href="/dashboard"
            className="inline-block mt-5 px-4 py-2 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition"
          >
            返回收件箱
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#FFF3DA] md:ml-[72px]">
      {/* TOP BAR — navigation lives in the rail now; keep title, name, 登出. */}
      <header className="shrink-0 border-b border-[#EFE3BF] bg-white/60 backdrop-blur-sm">
        <div className="px-5 py-3 flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-[#583A0F]">
            心灵法门人文关怀系统 <span className="text-[#B89968] font-normal">· 报表</span>
          </h1>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-sm text-[#8B6F47]">
              {me?.displayName || me?.email}
            </span>
            <button
              onClick={handleLogout}
              className="px-4 py-1.5 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      <DashboardNav role={me?.role ?? 'volunteer'} active="reports" />

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
          {/* HEADER ROW — title + range pills */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-[#583A0F]">报表</h2>
            <div className="flex items-center gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => changeRange(r.id)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition ${
                    range === r.id
                      ? 'bg-[#FAEFD0] text-[#583A0F] border-[#EFE3BF]'
                      : 'text-[#8B6F47] border-transparent hover:bg-[#FAEFD0]/60'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {reportsLoading ? (
            <p className="text-sm text-[#8B6F47]">加载中…</p>
          ) : !data ? (
            <p className="text-sm text-[#8B6F47]">无法加载报表</p>
          ) : (
            <>
              {/* STAT CARDS */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard label="对话总数" value={data.totals.conversations} />
                <StatCard label="有缘人总数" value={data.totals.contacts} />
                <StatCard label="危机对话" value={data.crisisCount} danger={data.crisisCount > 0} />
              </div>

              {/* 问题分布 — horizontal bar chart */}
              <Card title="问题分布">
                <CategoryChart categories={data.categories} />
              </Card>

              {/* 修行阶段 — four journey blocks */}
              <Card title="修行阶段">
                <StageBlocks stages={data.stages} />
              </Card>

              {/* 每日对话量 — column chart */}
              <Card title="每日对话量">
                <VolumeChart volumeByDay={data.volumeByDay} />
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────────

function StatCard({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div
      className={`bg-[#FFFEF6] border rounded-2xl p-5 ${
        danger ? 'border-[#FCA5A5]' : 'border-[#EFE3BF]'
      }`}
    >
      <p className="text-sm text-[#8B6F47]">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${danger ? 'text-red-600' : 'text-[#583A0F]'}`}>
        {value}
      </p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl p-5 sm:p-6">
      <h3 className="text-base font-semibold text-[#583A0F] mb-4">{title}</h3>
      {children}
    </section>
  );
}

// Horizontal bars: real categories first (gold), then a thin divider and the muted
// 闲聊测试 junk bucket last — real signal visually separated from noise.
function CategoryChart({
  categories,
}: {
  categories: { label: string; count: number; isJunk: boolean }[];
}) {
  const real = categories.filter((c) => !c.isJunk);
  const junk = categories.filter((c) => c.isJunk);
  const max = Math.max(1, ...categories.map((c) => c.count));

  if (real.length === 0 && junk.length === 0) {
    return <p className="text-sm text-[#8B6F47]">暂无数据</p>;
  }

  const Bar = ({
    label,
    count,
    junkStyle,
  }: {
    label: string;
    count: number;
    junkStyle?: boolean;
  }) => (
    <div className="flex items-center gap-3">
      <div
        className={`w-24 shrink-0 text-sm truncate ${
          junkStyle ? 'text-[#B89968]' : 'text-[#583A0F]'
        }`}
        title={label}
      >
        {label}
      </div>
      <div className="flex-1 h-6 rounded-full bg-[#FAEFD0] overflow-hidden">
        <div
          className={`h-full rounded-full ${junkStyle ? 'bg-[#C9BCA0]' : 'bg-[#D89938]'}`}
          style={{ width: `${Math.max((count / max) * 100, count > 0 ? 4 : 0)}%` }}
        />
      </div>
      <div
        className={`w-10 shrink-0 text-right text-sm ${
          junkStyle ? 'text-[#B89968]' : 'text-[#8B6F47]'
        }`}
      >
        {count}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {real.length === 0 ? (
        <p className="text-sm text-[#8B6F47]">暂无数据</p>
      ) : (
        real.map((c) => <Bar key={c.label} label={c.label} count={c.count} />)
      )}
      {junk.length > 0 && (
        <div className="pt-3 mt-1 border-t border-[#EFE3BF] space-y-3">
          {junk.map((c) => (
            <Bar key={c.label} label={c.label} count={c.count} junkStyle />
          ))}
        </div>
      )}
    </div>
  );
}

// Four stat blocks in a row, joined by → to read as a progression.
function StageBlocks({ stages }: { stages: { stage: string; count: number }[] }) {
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {stages.map((s, i) => (
        <Fragment key={s.stage}>
          <div className="flex-1 min-w-[68px] text-center bg-[#FAEFD0] rounded-xl px-3 py-4">
            <p className="text-2xl font-bold text-[#A87929]">{s.count}</p>
            <p className="mt-1 text-xs text-[#8B6F47]">{s.stage}</p>
          </div>
          {i < stages.length - 1 && (
            <div className="hidden sm:flex items-center text-[#B89968]" aria-hidden="true">
              →
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

// CSS column chart. Height ∝ count; labels thinned so the axis never crowds.
function VolumeChart({ volumeByDay }: { volumeByDay: { date: string; count: number }[] }) {
  const max = Math.max(1, ...volumeByDay.map((d) => d.count));
  const hasData = volumeByDay.some((d) => d.count > 0);
  // Aim for ~8 visible date labels regardless of window length.
  const step = Math.max(1, Math.ceil(volumeByDay.length / 8));

  if (!hasData) {
    return <p className="text-sm text-[#8B6F47]">暂无数据</p>;
  }

  return (
    <div className="flex items-stretch gap-1 h-44">
      {volumeByDay.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <div className="w-full flex-1 flex items-end">
            <div
              className="w-full rounded-t bg-[#D89938]"
              style={{ height: `${Math.max((d.count / max) * 100, d.count > 0 ? 3 : 0)}%` }}
              title={`${d.date}：${d.count}`}
            />
          </div>
          <span className="h-3 text-[9px] leading-none text-[#B89968] truncate">
            {i % step === 0 ? d.date : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
