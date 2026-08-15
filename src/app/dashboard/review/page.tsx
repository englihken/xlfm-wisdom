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

type WisdomEntry = {
  id: string;
  canonical_question: string;
  variants: string | null;
  keywords: string | null;
  answer_guidance: string | null;
  language: 'zh' | 'en' | 'id';
  status: 'draft' | 'approved' | 'retired';
  source_conversation_id: string | null;
  source_review_id: string | null;
  approved_at: string | null;
  use_count: number;
  updated_at: string;
};
type WisdomForm = {
  id: string | null; // null = creating
  canonical_question: string;
  variants: string;
  keywords: string;
  answer_guidance: string;
  language: 'zh' | 'en' | 'id';
  sourceReviewId: string | null;
  sourceConversationId: string | null;
};
const EMPTY_WISDOM_FORM: WisdomForm = {
  id: null,
  canonical_question: '',
  variants: '',
  keywords: '',
  answer_guidance: '',
  language: 'zh',
  sourceReviewId: null,
  sourceConversationId: null,
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

  const [tab, setTab] = useState<'queue' | 'monthly' | 'wisdom'>('queue');

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

  // 智库 state (P2)
  const [wisdomItems, setWisdomItems] = useState<WisdomEntry[]>([]);
  const [wisdomCounts, setWisdomCounts] = useState({ draft: 0, approved: 0, retired: 0 });
  const [wisdomStatus, setWisdomStatus] = useState<'all' | 'draft' | 'approved' | 'retired'>('all');
  const [wisdomLoading, setWisdomLoading] = useState(false);
  const [wisdomForm, setWisdomForm] = useState<WisdomForm | null>(null);
  const [wisdomBusy, setWisdomBusy] = useState(false);
  const [wisdomNotice, setWisdomNotice] = useState<string | null>(null);
  const [draftingReviewId, setDraftingReviewId] = useState<string | null>(null);

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

  // ── 智库 (P2) ──────────────────────────────────────────────────────────────
  const loadWisdom = useCallback(async (status: string) => {
    setWisdomLoading(true);
    try {
      const res = await fetch(`/api/dashboard/wisdom?status=${status}`);
      if (!res.ok) return;
      const json = await res.json();
      setWisdomItems(json.items ?? []);
      setWisdomCounts(json.counts ?? { draft: 0, approved: 0, retired: 0 });
    } catch {
      /* transient */
    } finally {
      setWisdomLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!me || tab !== 'wisdom') return;
    loadWisdom(wisdomStatus);
  }, [me, tab, wisdomStatus, loadWisdom]);

  // 起草智库条目 from a queue row: prefill the form with the visitor's main
  // question + the bot's answer as the guidance starting point (P2 §2).
  const draftFromReview = async (item: ReviewItem) => {
    setDraftingReviewId(item.id);
    try {
      const res = await fetch(`/api/dashboard/conversations/${item.conversationId}`);
      let question = item.questionKey ?? '';
      let guidance = '';
      if (res.ok) {
        const json = await res.json();
        const msgs = (json.messages ?? []) as { role: string; content: string }[];
        // Longest user message ≈ the substantive question; last assistant
        // message = the answer the guidance starts from.
        const userMsgs = msgs.filter((m) => m.role === 'user');
        question = userMsgs.reduce((a, b) => (b.content.length > a.length ? b.content : a), question);
        const assistantMsgs = msgs.filter((m) => m.role === 'assistant');
        guidance = assistantMsgs.length ? assistantMsgs[assistantMsgs.length - 1].content : '';
      }
      setWisdomForm({
        ...EMPTY_WISDOM_FORM,
        canonical_question: question.slice(0, 500),
        answer_guidance: guidance.slice(0, 8000),
        keywords: item.questionKey ?? '',
        sourceReviewId: item.id,
        sourceConversationId: item.conversationId,
      });
      setTab('wisdom');
    } finally {
      setDraftingReviewId(null);
    }
  };

  const saveWisdom = async () => {
    if (!wisdomForm) return;
    setWisdomBusy(true);
    setWisdomNotice(null);
    try {
      const isNew = !wisdomForm.id;
      const res = await fetch(isNew ? '/api/dashboard/wisdom' : `/api/dashboard/wisdom/${wisdomForm.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isNew ? {} : { action: 'save' }),
          canonical_question: wisdomForm.canonical_question,
          variants: wisdomForm.variants,
          keywords: wisdomForm.keywords,
          answer_guidance: wisdomForm.answer_guidance,
          language: wisdomForm.language,
          ...(isNew
            ? { sourceReviewId: wisdomForm.sourceReviewId, sourceConversationId: wisdomForm.sourceConversationId }
            : {}),
        }),
      });
      if (!res.ok) {
        setWisdomNotice(t('wisdom.actionFailed'));
        return;
      }
      const json = await res.json();
      // 起草 flow: the review left the open queue as 'drafted'.
      if (isNew && wisdomForm.sourceReviewId && json.reviewDrafted) {
        setItems((prev) => prev.filter((i) => i.id !== wisdomForm.sourceReviewId));
        setOpenCount((n) => Math.max(0, n - 1));
      }
      setWisdomForm(null);
      setWisdomNotice(t('wisdom.saved'));
      loadWisdom(wisdomStatus);
    } catch {
      setWisdomNotice(t('wisdom.actionFailed'));
    } finally {
      setWisdomBusy(false);
    }
  };

  const wisdomAction = async (id: string, action: 'approve' | 'retire') => {
    setWisdomBusy(true);
    setWisdomNotice(null);
    try {
      const res = await fetch(`/api/dashboard/wisdom/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        setWisdomNotice(t('wisdom.actionFailed'));
        return;
      }
      loadWisdom(wisdomStatus);
    } catch {
      setWisdomNotice(t('wisdom.actionFailed'));
    } finally {
      setWisdomBusy(false);
    }
  };

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
  const isAdmin = grantAllows(me.grants, 'care', 'admin');
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
                  ['wisdom', t('wisdom.tab')],
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
                        <button
                          onClick={() => draftFromReview(item)}
                          disabled={draftingReviewId === item.id}
                          className="px-3 py-1 rounded-full text-xs border border-gold-border text-accent-deep hover:bg-accent/5 disabled:opacity-50"
                        >
                          ✍️ {t('wisdom.draft')}
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
          {tab === 'wisdom' && (
            <section className="space-y-4">
              {/* status filter + new-entry */}
              <div className="flex items-center gap-1 flex-wrap">
                {(
                  [
                    ['all', t('wisdom.statusAll'), null],
                    ['draft', t('wisdom.statusDraft'), wisdomCounts.draft],
                    ['approved', t('wisdom.statusApproved'), wisdomCounts.approved],
                    ['retired', t('wisdom.statusRetired'), wisdomCounts.retired],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    onClick={() => setWisdomStatus(key)}
                    className={`px-3 py-1 rounded-full text-xs transition ${
                      wisdomStatus === key
                        ? 'bg-accent/10 text-accent-deep font-medium'
                        : 'text-ink-muted hover:bg-accent/5'
                    }`}
                  >
                    {label}
                    {count !== null && <span className="ml-1 text-ink-faint">({count})</span>}
                  </button>
                ))}
                {canEdit && (
                  <button
                    onClick={() => setWisdomForm({ ...EMPTY_WISDOM_FORM })}
                    className="ml-auto px-3 py-1 rounded-full text-xs bg-accent/10 text-accent-deep font-medium hover:bg-accent/20"
                  >
                    {t('wisdom.new')}
                  </button>
                )}
              </div>
              {wisdomNotice && <p className="text-sm text-ink-muted">{wisdomNotice}</p>}

              {/* create/edit form */}
              {wisdomForm && (
                <div className="rounded-xl border border-gold-border bg-surface p-4 space-y-3">
                  {wisdomForm.sourceReviewId && (
                    <p className="text-xs text-ink-muted">🔗 {t('wisdom.fromReview')}</p>
                  )}
                  <div>
                    <label className="block text-xs text-ink-muted mb-1">{t('wisdom.fieldQuestion')} *</label>
                    <textarea
                      value={wisdomForm.canonical_question}
                      onChange={(e) => setWisdomForm({ ...wisdomForm, canonical_question: e.target.value })}
                      rows={2}
                      className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface-soft text-ink focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted mb-1">{t('wisdom.fieldVariants')}</label>
                    <textarea
                      value={wisdomForm.variants}
                      onChange={(e) => setWisdomForm({ ...wisdomForm, variants: e.target.value })}
                      rows={2}
                      className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface-soft text-ink focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-xs text-ink-muted mb-1">{t('wisdom.fieldKeywords')}</label>
                      <input
                        value={wisdomForm.keywords}
                        onChange={(e) => setWisdomForm({ ...wisdomForm, keywords: e.target.value })}
                        className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface-soft text-ink focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-muted mb-1">{t('wisdom.fieldLanguage')}</label>
                      <select
                        value={wisdomForm.language}
                        onChange={(e) => setWisdomForm({ ...wisdomForm, language: e.target.value as 'zh' | 'en' | 'id' })}
                        className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface-soft text-ink focus:outline-none focus:border-accent"
                      >
                        <option value="zh">中文</option>
                        <option value="en">English</option>
                        <option value="id">Bahasa Indonesia</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted mb-1">{t('wisdom.fieldGuidance')} *</label>
                    <textarea
                      value={wisdomForm.answer_guidance}
                      onChange={(e) => setWisdomForm({ ...wisdomForm, answer_guidance: e.target.value })}
                      rows={8}
                      className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface-soft text-ink focus:outline-none focus:border-accent"
                    />
                  </div>
                  <p className="text-[11px] text-ink-faint">{t('wisdom.approveNote')}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveWisdom}
                      disabled={wisdomBusy || !wisdomForm.canonical_question.trim() || !wisdomForm.answer_guidance.trim()}
                      className="px-4 py-1.5 rounded-full text-sm bg-accent/10 text-accent-deep font-medium hover:bg-accent/20 disabled:opacity-50"
                    >
                      {t('wisdom.save')}
                    </button>
                    <button
                      onClick={() => setWisdomForm(null)}
                      className="px-4 py-1.5 rounded-full text-sm text-ink-muted hover:bg-accent/5"
                    >
                      {t('wisdom.cancel')}
                    </button>
                    {!wisdomForm.canonical_question.trim() || !wisdomForm.answer_guidance.trim() ? (
                      <span className="text-xs text-ink-faint">{t('wisdom.requiredHint')}</span>
                    ) : null}
                  </div>
                </div>
              )}

              {/* entry list */}
              {wisdomLoading ? (
                <p className="text-sm text-ink-muted">{t('review.loading')}</p>
              ) : wisdomItems.length === 0 ? (
                <p className="text-sm text-ink-muted py-8 text-center">{t('wisdom.empty')}</p>
              ) : (
                wisdomItems.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-border bg-surface p-4 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full ${
                          entry.status === 'approved'
                            ? 'bg-accent/10 text-accent-deep'
                            : entry.status === 'retired'
                              ? 'bg-surface-soft text-ink-faint border border-border'
                              : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {entry.status === 'approved'
                          ? t('wisdom.statusApproved')
                          : entry.status === 'retired'
                            ? t('wisdom.statusRetired')
                            : t('wisdom.statusDraft')}
                      </span>
                      <span className="text-ink-faint uppercase">{entry.language}</span>
                      {entry.use_count > 0 && (
                        <span className="text-ink-faint">{t('wisdom.useCount', { n: entry.use_count })}</span>
                      )}
                      <span className="ml-auto text-ink-faint">{mytDate(entry.updated_at)}</span>
                    </div>
                    <p className="text-sm font-medium text-ink">{entry.canonical_question}</p>
                    {entry.answer_guidance && (
                      <p className="text-sm text-ink-muted line-clamp-3 whitespace-pre-line">{entry.answer_guidance}</p>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      {canEdit && (
                        <button
                          onClick={() =>
                            setWisdomForm({
                              id: entry.id,
                              canonical_question: entry.canonical_question,
                              variants: entry.variants ?? '',
                              keywords: entry.keywords ?? '',
                              answer_guidance: entry.answer_guidance ?? '',
                              language: entry.language,
                              sourceReviewId: null,
                              sourceConversationId: null,
                            })
                          }
                          className="px-3 py-1 rounded-full text-xs border border-border text-ink-muted hover:bg-accent/5"
                        >
                          {t('wisdom.edit')}
                        </button>
                      )}
                      {isAdmin && entry.status !== 'approved' && (
                        <button
                          onClick={() => wisdomAction(entry.id, 'approve')}
                          disabled={wisdomBusy}
                          className="px-3 py-1 rounded-full text-xs bg-accent/10 text-accent-deep font-medium hover:bg-accent/20 disabled:opacity-50"
                        >
                          {t('wisdom.approve')}
                        </button>
                      )}
                      {isAdmin && entry.status === 'approved' && (
                        <button
                          onClick={() => wisdomAction(entry.id, 'retire')}
                          disabled={wisdomBusy}
                          className="px-3 py-1 rounded-full text-xs border border-border text-ink-muted hover:bg-accent/5 disabled:opacity-50"
                        >
                          {t('wisdom.retire')}
                        </button>
                      )}
                      {entry.status === 'approved' && canEdit && (
                        <span className="text-[11px] text-ink-faint">{t('wisdom.demotedNote')}</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
