// src/app/dashboard/wisdom/page.tsx
// 智库 page (batch 3 §3) — the standalone home for wisdom_entries.
//   list   : status filter (default draft) · language filter · canonical_question
//            · use_count · created_at
//   detail : click a row → detail panel with edit form (care ≥ edit → PATCH save)
//            + approve/retire buttons (care ADMIN only, `has_module_access('care','admin')`
//            via grantAllows) + Pinecone sync badge (GET /api/dashboard/wisdom/[id]
//            asks Pinecone whether wisdom_{id} really exists).
// Shell/auth mirrors /dashboard/review (TopBar + DashboardNav, /api/dashboard/me).
// The APIs are the ones the review tab already uses — no new write paths.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient, signOutEverywhere } from '@/lib/supabase-browser';
import { PasswordChangeGate } from '@/components/password-change-gate';
import { DashboardNav } from '@/components/dashboard-nav';
import { TopBar } from '@/components/top-bar';
import { grantAllows, type Grants } from '@/lib/access';
import { useT } from '@/lib/i18n-react';

type Me = { email: string; displayName: string | null; role: 'admin' | 'volunteer' | 'erp_admin' | 'committee' | 'centre_head'; grants: Grants };

type Lang = 'zh' | 'en' | 'id';
type Status = 'draft' | 'approved' | 'retired';

type WisdomEntry = {
  id: string;
  canonical_question: string;
  variants: string | null;
  keywords: string | null;
  answer_guidance: string | null;
  language: Lang;
  status: Status;
  source_conversation_id: string | null;
  source_review_id: string | null;
  approved_at: string | null;
  use_count: number;
  created_at: string;
  updated_at: string;
};

type WisdomForm = {
  canonical_question: string;
  variants: string;
  keywords: string;
  answer_guidance: string;
  language: Lang;
};

function mytDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const INPUT_CLS =
  'w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface-soft text-ink focus:outline-none focus:border-accent';

export default function WisdomPage() {
  const t = useT();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  // list
  const [status, setStatus] = useState<'all' | Status>('draft');
  const [lang, setLang] = useState<'all' | Lang>('all');
  const [items, setItems] = useState<WisdomEntry[]>([]);
  const [counts, setCounts] = useState({ draft: 0, approved: 0, retired: 0 });
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(false);

  // detail / edit
  const [selected, setSelected] = useState<WisdomEntry | null>(null);
  const [synced, setSynced] = useState<boolean | null | 'checking'>(null);
  const [form, setForm] = useState<WisdomForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const forceSignOut = useCallback(async () => {
    await signOutEverywhere();
    router.replace('/dashboard/login');
  }, [router]);

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

  const load = useCallback(async (s: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/wisdom?status=${s}`);
      if (!res.ok) {
        setListError(true);
        return;
      }
      const json = await res.json();
      setItems(json.items ?? []);
      setCounts(json.counts ?? { draft: 0, approved: 0, retired: 0 });
      setListError(false);
    } catch {
      setListError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!me) return;
    load(status);
  }, [me, status, load]);

  const visible = useMemo(
    () => (lang === 'all' ? items : items.filter((e) => e.language === lang)),
    [items, lang]
  );

  // Detail: fetch the row + Pinecone truth for the badge.
  const openDetail = useCallback(async (entry: WisdomEntry) => {
    setSelected(entry);
    setForm(null);
    setNotice(null);
    setSynced('checking');
    try {
      const res = await fetch(`/api/dashboard/wisdom/${entry.id}`);
      if (!res.ok) {
        setSynced(null);
        return;
      }
      const json = (await res.json()) as { entry: WisdomEntry; pineconeSynced: boolean | null };
      setSelected(json.entry);
      setSynced(json.pineconeSynced);
    } catch {
      setSynced(null);
    }
  }, []);

  const startEdit = (entry: WisdomEntry) =>
    setForm({
      canonical_question: entry.canonical_question,
      variants: entry.variants ?? '',
      keywords: entry.keywords ?? '',
      answer_guidance: entry.answer_guidance ?? '',
      language: entry.language,
    });

  const save = async () => {
    if (!selected || !form) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/dashboard/wisdom/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', ...form }),
      });
      if (!res.ok) {
        setNotice(t('wisdom.actionFailed'));
        return;
      }
      const json = (await res.json()) as { entry: WisdomEntry; demotedToDraft?: boolean };
      setForm(null);
      setNotice(json.demotedToDraft ? `${t('wisdom.saved')} · ${t('wisdom.demotedNote')}` : t('wisdom.saved'));
      await openDetail(json.entry);
      load(status);
    } catch {
      setNotice(t('wisdom.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: 'approve' | 'retire') => {
    if (!selected) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/dashboard/wisdom/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setNotice(j?.error ?? t('wisdom.actionFailed'));
        return;
      }
      const json = (await res.json()) as { entry: WisdomEntry };
      setNotice(action === 'approve' ? t('wisdom.approved') : t('wisdom.retired'));
      // Re-read so the badge reflects what Pinecone actually holds now.
      await openDetail(json.entry);
      load(status);
    } catch {
      setNotice(t('wisdom.actionFailed'));
    } finally {
      setBusy(false);
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

  const statusLabel = (s: Status) =>
    s === 'approved' ? t('wisdom.statusApproved') : s === 'retired' ? t('wisdom.statusRetired') : t('wisdom.statusDraft');
  const statusCls = (s: Status) =>
    s === 'approved'
      ? 'bg-accent/10 text-accent-deep'
      : s === 'retired'
        ? 'bg-surface-soft text-ink-faint border border-border'
        : 'bg-amber-50 text-amber-800';

  return (
    <div className="min-h-screen flex flex-col bg-bg md:ml-[72px]">
      <TopBar moduleTitle={t('wisdom.pageTitle')} userLabel={me.displayName || me.email} onLogout={forceSignOut} />
      <DashboardNav role={me.role} active="inbox" grants={me.grants} />

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
          {/* header: back link + filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/dashboard/review" className="text-sm text-ink-muted hover:text-ink">
              {t('wisdom.backToReview')}
            </Link>
            <div className="ml-auto flex items-center gap-1 flex-wrap">
              {(
                [
                  ['draft', t('wisdom.statusDraft'), counts.draft],
                  ['approved', t('wisdom.statusApproved'), counts.approved],
                  ['retired', t('wisdom.statusRetired'), counts.retired],
                  ['all', t('wisdom.statusAll'), null],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  onClick={() => setStatus(key)}
                  className={`px-3 py-1 rounded-full text-xs transition ${
                    status === key ? 'bg-accent/10 text-accent-deep font-medium' : 'text-ink-muted hover:bg-accent/5'
                  }`}
                >
                  {label}
                  {count !== null && <span className="ml-1 text-ink-faint">({count})</span>}
                </button>
              ))}
              <select
                aria-label={t('wisdom.filterLanguage')}
                value={lang}
                onChange={(e) => setLang(e.target.value as 'all' | Lang)}
                className="ml-2 text-xs px-2 py-1 border border-border rounded-full bg-surface text-ink-muted focus:outline-none focus:border-accent"
              >
                <option value="all">{t('wisdom.langAll')}</option>
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="id">Bahasa Indonesia</option>
              </select>
            </div>
          </div>

          {!canEdit && <p className="text-xs text-ink-faint">{t('wisdom.viewOnly')}</p>}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            {/* ── list ── */}
            <section className="rounded-xl border border-border bg-surface overflow-hidden">
              {loading ? (
                <p className="text-sm text-ink-muted p-4">{t('review.loading')}</p>
              ) : listError ? (
                <p className="text-sm text-ink-muted p-4">{t('wisdom.actionFailed')}</p>
              ) : visible.length === 0 ? (
                <p className="text-sm text-ink-muted py-10 text-center">{t('wisdom.empty')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-ink-faint border-b border-border">
                        <th className="px-3 py-2 font-medium whitespace-nowrap">{t('wisdom.colStatus')}</th>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">{t('wisdom.colLanguage')}</th>
                        <th className="px-3 py-2 font-medium">{t('wisdom.colQuestion')}</th>
                        <th className="px-3 py-2 font-medium text-right">{t('wisdom.colUseCount')}</th>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">{t('wisdom.colCreated')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((entry) => (
                        <tr
                          key={entry.id}
                          onClick={() => openDetail(entry)}
                          className={`border-b border-border last:border-b-0 cursor-pointer transition ${
                            selected?.id === entry.id ? 'bg-accent/5' : 'hover:bg-accent/5'
                          }`}
                        >
                          <td className="px-3 py-2 align-top">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${statusCls(entry.status)}`}>
                              {statusLabel(entry.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2 align-top text-xs text-ink-faint uppercase">{entry.language}</td>
                          <td className="px-3 py-2 align-top text-ink">{entry.canonical_question}</td>
                          <td className="px-3 py-2 align-top text-right text-ink-muted tabular-nums">{entry.use_count}</td>
                          <td className="px-3 py-2 align-top text-xs text-ink-faint whitespace-nowrap">
                            {mytDateTime(entry.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ── detail / edit ── */}
            <section className="rounded-xl border border-gold-border bg-surface p-4 space-y-3 self-start lg:sticky lg:top-4">
              {!selected ? (
                <p className="text-sm text-ink-muted py-8 text-center">{t('wisdom.detail')}</p>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className={`inline-block px-2 py-0.5 rounded-full ${statusCls(selected.status)}`}>
                      {statusLabel(selected.status)}
                    </span>
                    <span className="text-ink-faint uppercase">{selected.language}</span>
                    <span className="text-ink-faint">{t('wisdom.useCount', { n: selected.use_count })}</span>
                    {/* Pinecone badge — from GET, i.e. what the index actually holds */}
                    {synced === 'checking' ? (
                      <span className="text-ink-faint">{t('wisdom.pineconeChecking')}</span>
                    ) : synced === true ? (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800">
                        ✓ {t('wisdom.pineconeSynced')}
                      </span>
                    ) : selected.status === 'approved' && synced === false ? (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-red-50 text-red-800">
                        {t('wisdom.pineconeMissing')}
                      </span>
                    ) : synced === false ? (
                      <span className="text-ink-faint">{t('wisdom.pineconeNotApplicable')}</span>
                    ) : null}
                    <button
                      onClick={() => {
                        setSelected(null);
                        setForm(null);
                        setNotice(null);
                      }}
                      className="ml-auto text-ink-muted hover:text-ink"
                    >
                      {t('wisdom.close')}
                    </button>
                  </div>

                  {notice && <p className="text-sm text-ink-muted">{notice}</p>}

                  {form ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-ink-muted mb-1">{t('wisdom.fieldQuestion')} *</label>
                        <textarea
                          value={form.canonical_question}
                          onChange={(e) => setForm({ ...form, canonical_question: e.target.value })}
                          rows={2}
                          className={INPUT_CLS}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-ink-muted mb-1">{t('wisdom.fieldVariants')}</label>
                        <textarea
                          value={form.variants}
                          onChange={(e) => setForm({ ...form, variants: e.target.value })}
                          rows={2}
                          className={INPUT_CLS}
                        />
                      </div>
                      <div className="flex gap-3 flex-wrap">
                        <div className="flex-1 min-w-[160px]">
                          <label className="block text-xs text-ink-muted mb-1">{t('wisdom.fieldKeywords')}</label>
                          <input
                            value={form.keywords}
                            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                            className={INPUT_CLS}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-ink-muted mb-1">{t('wisdom.fieldLanguage')}</label>
                          <select
                            value={form.language}
                            onChange={(e) => setForm({ ...form, language: e.target.value as Lang })}
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
                          value={form.answer_guidance}
                          onChange={(e) => setForm({ ...form, answer_guidance: e.target.value })}
                          rows={10}
                          className={INPUT_CLS}
                        />
                      </div>
                      {selected.status === 'approved' && (
                        <p className="text-[11px] text-ink-faint">{t('wisdom.demotedNote')}</p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={save}
                          disabled={busy || !form.canonical_question.trim() || !form.answer_guidance.trim()}
                          className="px-4 py-1.5 rounded-full text-sm bg-accent/10 text-accent-deep font-medium hover:bg-accent/20 disabled:opacity-50"
                        >
                          {t('wisdom.save')}
                        </button>
                        <button
                          onClick={() => setForm(null)}
                          className="px-4 py-1.5 rounded-full text-sm text-ink-muted hover:bg-accent/5"
                        >
                          {t('wisdom.cancel')}
                        </button>
                        {!form.canonical_question.trim() || !form.answer_guidance.trim() ? (
                          <span className="text-xs text-ink-faint">{t('wisdom.requiredHint')}</span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <p className="text-[11px] text-ink-faint mb-0.5">{t('wisdom.fieldQuestion')}</p>
                        <p className="text-sm font-medium text-ink">{selected.canonical_question}</p>
                      </div>
                      {selected.variants && (
                        <div>
                          <p className="text-[11px] text-ink-faint mb-0.5">{t('wisdom.fieldVariants')}</p>
                          <p className="text-sm text-ink-muted whitespace-pre-line">{selected.variants}</p>
                        </div>
                      )}
                      {selected.keywords && (
                        <div>
                          <p className="text-[11px] text-ink-faint mb-0.5">{t('wisdom.fieldKeywords')}</p>
                          <p className="text-sm text-ink-muted">{selected.keywords}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[11px] text-ink-faint mb-0.5">{t('wisdom.fieldGuidance')}</p>
                        <p className="text-sm text-ink whitespace-pre-line">{selected.answer_guidance}</p>
                      </div>
                      <p className="text-[11px] text-ink-faint">
                        {t('wisdom.createdAt', { date: mytDateTime(selected.created_at) })}
                        {selected.approved_at ? ` · ${t('wisdom.approvedAt', { date: mytDateTime(selected.approved_at) })}` : ''}
                      </p>
                      {selected.source_conversation_id && (
                        <p className="text-[11px] text-ink-faint">🔗 {t('wisdom.fromReview')}</p>
                      )}
                      <p className="text-[11px] text-ink-faint">{t('wisdom.approveNote')}</p>
                      <div className="flex items-center gap-2 flex-wrap pt-1">
                        {canEdit && (
                          <button
                            onClick={() => startEdit(selected)}
                            disabled={busy}
                            className="px-3 py-1 rounded-full text-xs border border-border text-ink-muted hover:bg-accent/5 disabled:opacity-50"
                          >
                            {t('wisdom.edit')}
                          </button>
                        )}
                        {isAdmin && selected.status !== 'approved' && (
                          <button
                            onClick={() => act('approve')}
                            disabled={busy}
                            className="px-3 py-1 rounded-full text-xs bg-accent/10 text-accent-deep font-medium hover:bg-accent/20 disabled:opacity-50"
                          >
                            {t('wisdom.approve')}
                          </button>
                        )}
                        {isAdmin && selected.status === 'approved' && (
                          <button
                            onClick={() => act('retire')}
                            disabled={busy}
                            className="px-3 py-1 rounded-full text-xs border border-border text-ink-muted hover:bg-accent/5 disabled:opacity-50"
                          >
                            {t('wisdom.retire')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
