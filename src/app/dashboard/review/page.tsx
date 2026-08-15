// src/app/dashboard/review/page.tsx
// P1 quality loop UI (智慧问答 module): 复盘队列 (§1.5) + 月度回顾 (§1.6).
// Queue lists open needs_improvement reviews with 没问题/已处理 dispositions
// (care ≥ edit; view-only accounts see the list without action buttons).
// Auth/shell pattern mirrors /dashboard/home.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient, signOutEverywhere } from '@/lib/supabase-browser';
import { PasswordChangeGate } from '@/components/password-change-gate';
import { DashboardNav } from '@/components/dashboard-nav';
import { TopBar } from '@/components/top-bar';
import { grantAllows, type Grants } from '@/lib/access';
import { useT } from '@/lib/i18n-react';

type Me = { email: string; displayName: string | null; role: 'admin' | 'volunteer' | 'erp_admin' | 'committee' | 'centre_head'; grants: Grants };

type ReviewItem = {
  id: string;
  conversationId: string;
  verdict: string;
  reason: string | null;
  improvementHint: string | null;
  questionKey: string | null;
  emotionalWeight: 'none' | 'light' | 'heavy';
  reviewedAt: string;
  status: string;
  category: string | null;
  conversationDate: string | null;
};

type MonthStats = {
  volume: number;
  categories: Record<string, number>;
  topQuestionKeys: { key: string; count: number }[];
  reviewedCount: number;
  needsImprovementCount: number;
  needsImprovementRate: number | null;
  heavyCount: number;
  unansweredCount: number;
};
type MonthlyData = {
  month: string;
  prevMonth: string;
  current: MonthStats;
  previous: {
    volume: number;
    needsImprovementRate: number | null;
    heavyCount: number;
    unansweredCount: number;
    reviewedCount: number;
  };
};

function mytDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    month: 'numeric',
    day: 'numeric',
  });
}

function currentMonthMYT(): string {
  const d = new Date(Date.now() + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function ReviewPage() {
  const t = useT();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const [tab, setTab] = useState<'queue' | 'monthly'>('queue');

  // queue state
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // monthly state
  const [month, setMonth] = useState(currentMonthMYT());
  const [monthly, setMonthly] = useState<MonthlyData | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  const forceSignOut = useCallback(async () => {
    await signOutEverywhere();
    router.replace('/dashboard/login');
  }, [router]);

  // Auth gate + profile (same flow as the hub page).
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data, error }) => {
      if (error || !data.user) {
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
        if (res.status === 401) {
          router.replace('/dashboard/login');
          return;
        }
        if (res.status === 403) {
          await forceSignOut();
          return;
        }
        if (!res.ok) return;
        const json = (await res.json()) as Me & { mustChangePassword?: boolean };
        if (!active) return;
        const grants = json.grants ?? {};
        if (!grantAllows(grants, 'care', 'view')) {
          router.replace('/dashboard/home');
          return;
        }
        setMe({ email: json.email, displayName: json.displayName ?? null, role: json.role, grants });
        if (json.mustChangePassword) setMustChangePassword(true);
      } catch {
        /* loader covers */
      }
    })();
    return () => {
      active = false;
    };
  }, [checking, router, forceSignOut]);

  const loadQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/reviews?status=open&verdict=needs_improvement');
      if (!res.ok) {
        setQueueError(true);
        return;
      }
      const json = await res.json();
      setItems(json.items ?? []);
      setOpenCount(json.openCount ?? 0);
      setQueueError(false);
    } catch {
      setQueueError(true);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!me) return;
    loadQueue();
  }, [me, loadQueue]);

  useEffect(() => {
    if (!me || tab !== 'monthly') return;
    let active = true;
    setMonthlyLoading(true);
    fetch(`/api/dashboard/reviews/monthly?month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) setMonthly(j as MonthlyData);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setMonthlyLoading(false);
      });
    return () => {
      active = false;
    };
  }, [me, tab, month]);

  const disposition = async (id: string, action: 'dismiss' | 'handle', reason?: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/dashboard/reviews/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'dismiss' ? { action, reason } : { action }),
      });
      if (!res.ok) {
        setActionError(t('review.actionFailed'));
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
      setOpenCount((n) => Math.max(0, n - 1));
      setDismissingId(null);
      setDismissReason('');
    } catch {
      setActionError(t('review.actionFailed'));
    } finally {
      setBusyId(null);
    }
  };

  if (checking || !me) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-sm text-ink-muted">{t('review.loading')}</p>
      </div>
    );
  }
  if (mustChangePassword) {
    return <PasswordChangeGate onDone={() => setMustChangePassword(false)} />;
  }

  const canEdit = grantAllows(me.grants, 'care', 'edit');
  const rate = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);

  return (
    <div className="min-h-screen flex flex-col bg-bg md:ml-[72px]">
      <TopBar moduleTitle={t('review.moduleTitle')} userLabel={me.displayName || me.email} onLogout={forceSignOut} />
      <DashboardNav role={me.role} active="inbox" grants={me.grants} />

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
          {/* header row: back link + tabs */}
          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/dashboard" className="text-sm text-ink-muted hover:text-ink">
              {t('review.backToChat')}
            </Link>
            <div className="ml-auto flex items-center gap-1">
              {(
                [
                  ['queue', t('review.tabQueue')],
                  ['monthly', t('review.tabMonthly')],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-4 py-1.5 rounded-full text-sm transition ${
                    tab === key ? 'bg-accent/10 text-accent-deep font-medium' : 'text-ink-muted hover:bg-accent/5'
                  }`}
                >
                  {label}
                  {key === 'queue' && openCount > 0 && (
                    <span className="ml-1.5 inline-block min-w-[18px] text-center px-1 rounded-full bg-red-700 text-white text-[10.5px]">
                      {openCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {tab === 'queue' && (
            <section className="space-y-3">
              {actionError && <p className="text-sm text-red-700">{actionError}</p>}
              {queueLoading ? (
                <p className="text-sm text-ink-muted">{t('review.loading')}</p>
              ) : queueError ? (
                <p className="text-sm text-ink-muted">{t('review.loadFailed')}</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-ink-muted py-10 text-center">{t('review.empty')}</p>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border bg-surface p-4 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap text-xs text-ink-muted">
                      <span>{item.conversationDate ? mytDate(item.conversationDate) : mytDate(item.reviewedAt)}</span>
                      <span className="inline-block px-2 py-0.5 rounded-full bg-accent/10 text-accent-deep">
                        {item.category ?? t('review.uncategorized')}
                      </span>
                      {item.questionKey && (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-surface-soft border border-border">
                          {item.questionKey}
                        </span>
                      )}
                      {item.emotionalWeight === 'heavy' && (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-[#FEF2F2] text-red-700">
                          {t('review.emotionalHeavy')}
                        </span>
                      )}
                      {item.emotionalWeight === 'light' && (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">
                          {t('review.emotionalLight')}
                        </span>
                      )}
                      <Link
                        href={`/dashboard?conversation=${item.conversationId}`}
                        className="ml-auto text-accent-deep hover:underline"
                      >
                        {t('review.openConversation')} →
                      </Link>
                    </div>
                    {item.reason && <p className="text-sm text-ink">{item.reason}</p>}
                    {item.improvementHint && (
                      <p className="text-sm text-ink-muted">💡 {item.improvementHint}</p>
                    )}

                    {canEdit && dismissingId !== item.id && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => {
                            setDismissingId(item.id);
                            setDismissReason('');
                          }}
                          disabled={busyId === item.id}
                          className="px-3 py-1 rounded-full text-xs border border-border text-ink-muted hover:bg-accent/5 disabled:opacity-50"
                        >
                          {t('review.dismiss')}
                        </button>
                        <button
                          onClick={() => disposition(item.id, 'handle')}
                          disabled={busyId === item.id}
                          className="px-3 py-1 rounded-full text-xs bg-accent/10 text-accent-deep font-medium hover:bg-accent/20 disabled:opacity-50"
                        >
                          {t('review.handle')}
                        </button>
                      </div>
                    )}
                    {canEdit && dismissingId === item.id && (
                      <div className="pt-1 space-y-2">
                        <label className="block text-xs text-ink-muted">{t('review.dismissReasonLabel')}</label>
                        <textarea
                          value={dismissReason}
                          onChange={(e) => setDismissReason(e.target.value)}
                          placeholder={t('review.dismissReasonPlaceholder')}
                          rows={2}
                          className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface-soft text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => disposition(item.id, 'dismiss', dismissReason.trim())}
                            disabled={!dismissReason.trim() || busyId === item.id}
                            className="px-3 py-1 rounded-full text-xs bg-accent/10 text-accent-deep font-medium hover:bg-accent/20 disabled:opacity-50"
                          >
                            {t('review.dismissConfirm')}
                          </button>
                          <button
                            onClick={() => {
                              setDismissingId(null);
                              setDismissReason('');
                            }}
                            className="px-3 py-1 rounded-full text-xs text-ink-muted hover:bg-accent/5"
                          >
                            {t('review.cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </section>
          )}

          {tab === 'monthly' && (
            <section className="space-y-5">
              <div className="flex items-center gap-2">
                <label className="text-sm text-ink-muted">{t('review.month')}</label>
                <input
                  type="month"
                  value={month}
                  max={currentMonthMYT()}
                  onChange={(e) => e.target.value && setMonth(e.target.value)}
                  className="text-sm px-3 py-1.5 border border-border-strong rounded-lg bg-surface-soft text-ink focus:outline-none focus:border-accent"
                />
              </div>

              {monthlyLoading || !monthly ? (
                <p className="text-sm text-ink-muted">{t('review.loading')}</p>
              ) : monthly.current.volume === 0 ? (
                <p className="text-sm text-ink-muted py-10 text-center">{t('review.monthEmpty')}</p>
              ) : (
                <>
                  {/* stat tiles with deltas vs previous month */}
                  <div className="flex flex-wrap gap-3">
                    {(
                      [
                        [t('review.volume'), String(monthly.current.volume), String(monthly.previous.volume)],
                        [t('review.reviewed'), String(monthly.current.reviewedCount), String(monthly.previous.reviewedCount)],
                        [t('review.niRate'), rate(monthly.current.needsImprovementRate), rate(monthly.previous.needsImprovementRate)],
                        [t('review.heavy'), String(monthly.current.heavyCount), String(monthly.previous.heavyCount)],
                        [t('review.unanswered'), String(monthly.current.unansweredCount), String(monthly.previous.unansweredCount)],
                      ] as const
                    ).map(([label, value, prev]) => (
                      <div key={label} className="rounded-xl border border-border bg-surface px-4 py-3 min-w-[130px]">
                        <p className="text-xs text-ink-muted">{label}</p>
                        <p className="text-xl font-semibold text-ink mt-0.5">{value}</p>
                        <p className="text-[11px] text-ink-faint mt-0.5">{t('review.vsPrev', { value: prev })}</p>
                      </div>
                    ))}
                  </div>

                  {/* category mix */}
                  <div className="rounded-xl border border-border bg-surface p-4">
                    <p className="u-label mb-2">{t('review.categoryMix')}</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(monthly.current.categories)
                        .sort((a, b) => b[1] - a[1])
                        .map(([cat, n]) => (
                          <span key={cat} className="inline-block px-2.5 py-1 rounded-full text-xs bg-accent/10 text-accent-deep">
                            {cat} · {n}
                          </span>
                        ))}
                    </div>
                  </div>

                  {/* top question_key clusters */}
                  <div className="rounded-xl border border-border bg-surface p-4">
                    <p className="u-label mb-2">{t('review.topKeys')}</p>
                    {monthly.current.topQuestionKeys.length === 0 ? (
                      <p className="text-sm text-ink-muted">{t('review.notReviewedYet')}</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody>
                          {monthly.current.topQuestionKeys.map((k) => (
                            <tr key={k.key} className="border-b border-border last:border-0">
                              <td className="py-1.5 text-ink">{k.key}</td>
                              <td className="py-1.5 text-right text-ink-muted">{k.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
