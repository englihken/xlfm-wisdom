// src/app/dashboard/page.tsx
// 心灵法门人文关怀系统 — volunteer inbox (Phase 3 Session 2).
// Three-panel read-only dashboard: conversation list · message thread · contact
// profile. Auth-gated client-side (redirects to login); all conversation data is
// read through server-side, auth-protected API routes (never directly from the
// browser). Human takeover comes in a later session.

'use client';

import { useEffect, useState, useCallback, useRef, Fragment, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient, signOutEverywhere } from '@/lib/supabase-browser';
import { MasterMarkdown, MessageSources, type Source } from '@/components/assistant-message';
import { PasswordChangeGate } from '@/components/password-change-gate';
import { DashboardNav } from '@/components/dashboard-nav';
import { TopBar } from '@/components/top-bar';
import { visibleModules, grantAllows, type Grants } from '@/lib/access';
import { OutreachQuickPanel } from '@/components/outreach-quick-panel';
import { STAGES, stageLabel } from '@/lib/outreach';
import { useT } from '@/lib/i18n-react';
import type { TFunc } from '@/lib/i18n';

// ── Types (mirror the API route shapes) ──────────────────────────────────────
type ListItem = {
  id: string;
  contactName: string;
  channel: string;
  stage: string | null;
  status: string;
  category: string | null;
  crisisFlag: boolean;
  lastMessagePreview: string;
  lastMessageAt: string;
  unread: boolean;
  assignedToMe: boolean;
};

type ThreadMessage = {
  id: string;
  role: 'user' | 'assistant' | 'volunteer';
  content: string;
  sources: Source[] | null;
  created_at: string;
  sentByName?: string | null;
};

type ContactProfile = {
  id: string;
  display_name: string | null;
  channel: string | null;
  wa_id: string | null;
  browser_id: string | null;
  stage: string | null;
  summary: string | null;
  notes: string | null;
  first_seen: string;
  last_seen: string;
  // When the rolling 有缘人档案 was last regenerated (server-derived; null = never).
  profile_updated_at?: string | null;
};

type Detail = {
  conversation: {
    id: string;
    channel: string;
    status: string;
    category: string | null;
    crisisFlag: boolean;
    summary?: string | null; // one-line gist of THIS conversation (cron-generated)
    assignedVolunteerName?: string | null;
    assignedToMe?: boolean;
  };
  contact: ContactProfile | null;
  messages: ThreadMessage[];
};

// ── Display helpers ──────────────────────────────────────────────────────────
const CHANNELS: Record<string, { icon: string; labelKey?: string }> = {
  web: { icon: '◍', labelKey: 'care.channelWeb' },
  whatsapp: { icon: '✆' },
};
function channelMeta(t: TFunc, channel: string) {
  const meta = CHANNELS[channel];
  if (!meta) return { icon: '◍', label: channel };
  // whatsapp has no labelKey — its label is the (non-translated) brand name.
  return { icon: meta.icon, label: meta.labelKey ? t(meta.labelKey) : 'WhatsApp' };
}

const STATUS_LABEL_KEYS: Record<string, string> = {
  ai_handling: 'care.status.aiHandling',
  needs_human: 'care.status.needsHuman',
  volunteer_handling: 'care.status.volunteerHandling',
  human_handling: 'care.status.volunteerHandling',
  resolved: 'care.status.resolved',
  closed: 'care.status.closed',
};
// Gold pill for ACTIVE handling states; muted pill for FINISHED/terminal states;
// needs_human keeps a semantic red (a warning that a human is required) — never
// goldified.
const STATUS_STYLES: Record<string, string> = {
  ai_handling: 'pill-gold',
  needs_human: 'bg-[#FEF2F2] text-red-700 border border-[#FCA5A5]',
  volunteer_handling: 'pill-gold',
  human_handling: 'pill-gold',
  resolved: 'pill-muted',
  closed: 'pill-muted',
};
function statusLabel(t: TFunc, status: string) {
  const key = STATUS_LABEL_KEYS[status];
  return key ? t(key) : status;
}
function statusStyle(status: string) {
  return STATUS_STYLES[status] ?? 'pill-gold';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Day-group bucketing in Malaysia time (Asia/Kuala_Lumpur, UTC+8, no DST). The
// server stores UTC, so we ask for the MYT calendar day explicitly. en-CA yields a
// sortable YYYY-MM-DD key.
function mytDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}
function dayLabelFromKey(
  t: TFunc,
  key: string,
  todayKey: string,
  yesterdayKey: string
): string {
  if (key === todayKey) return t('care.today');
  if (key === yesterdayKey) return t('care.yesterday');
  const [, m, d] = key.split('-');
  return `${m}/${d}`;
}
// Group an already-newest-first list under consecutive MYT day headers.
function buildDayGroups(
  t: TFunc,
  items: ListItem[],
  todayKey: string,
  yesterdayKey: string
): { key: string; label: string; items: ListItem[] }[] {
  const groups: { key: string; label: string; items: ListItem[] }[] = [];
  for (const c of items) {
    const key = mytDayKey(c.lastMessageAt);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: dayLabelFromKey(t, key, todayKey, yesterdayKey), items: [] };
      groups.push(g);
    }
    g.items.push(c);
  }
  return groups;
}

// The logged-in volunteer's own profile (from /api/dashboard/me). `role` gates the
// admin-only 设置 link; `mustChangePassword` triggers the first-login gate.
type Me = {
  displayName: string | null;
  role: 'admin' | 'volunteer' | 'erp_admin' | 'committee';
  mustChangePassword?: boolean;
  grants?: Grants;
};

export default function DashboardPage() {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  // Profile gate: stay on the neutral loader until /me resolves, so the inbox chrome
  // never flashes before the password-change gate (or the confirmed profile).
  const [profileReady, setProfileReady] = useState(false);

  const [conversations, setConversations] = useState<ListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Search: `searchInput` is the raw field; `query` is the 300ms-debounced value
  // actually sent to the list API.
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');

  // Inbox filter tab + human-takeover action state (takeover / handback).
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Ignore stale list responses when search + polling races overlap.
  const listReqRef = useRef(0);
  // Latest selected id, read inside the polling closure without re-arming it.
  const selectedIdRef = useRef<string | null>(null);

  // If any dashboard API returns 401, the session is gone — back to login.
  const handleUnauthorized = useCallback(() => {
    router.replace('/dashboard/login');
  }, [router]);

  // Clear the Supabase session and return to login. Used both by the 登出 button
  // and when /me reports the account is no longer an active volunteer (403).
  const forceSignOut = useCallback(async () => {
    await signOutEverywhere();
    router.replace('/dashboard/login');
  }, [router]);

  // After a contact edit saves, merge the changed fields into the loaded detail
  // so the panel reflects the save without a refetch. Called from event handlers
  // (never an effect), so the React-compiler set-state-in-effect rule is happy.
  const applyContactUpdate = useCallback((updates: Partial<ContactProfile>) => {
    setDetail((prev) =>
      prev && prev.contact ? { ...prev, contact: { ...prev.contact, ...updates } } : prev
    );
  }, []);

  // Auth gate.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data, error }) => {
      if (error || !data.user) {
        router.replace('/dashboard/login');
        return;
      }
      setEmail(data.user.email ?? '');
      setChecking(false);
    });
  }, [router]);

  // Once past the auth gate, load our own volunteer profile. A 403 means the
  // session is valid but this account is not (or no longer) an active volunteer:
  // sign out and return to login. All setState stays inside the async callback.
  useEffect(() => {
    if (checking) return;
    let active = true;
    fetch('/api/dashboard/me')
      .then(async (res) => {
        if (!active) return;
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        if (res.status === 403) {
          await forceSignOut();
          return;
        }
        if (!res.ok) return;
        const json = (await res.json()) as Me;
        if (active) {
          const grants = json.grants ?? {};
          // Landing is decided ONCE, at login (see login/page.tsx). This page must NOT
          // re-run a landing redirect, or clicking 收件箱 would bounce a multi-door user
          // straight back out. The ONLY guard here: an account with NO care access that
          // reaches the inbox by URL is routed away (members → members list; otherwise
          // the hub chooser). A caller WITH care access renders the inbox normally —
          // including multi-door users, so 收件箱 always opens the inbox.
          const mods = visibleModules({ role: json.role, grants });
          if (!mods.includes('inbox')) {
            router.replace(mods.includes('members') ? '/dashboard/members' : '/dashboard/home');
            return;
          }
          setMe({ displayName: json.displayName ?? null, role: json.role, grants });
          // Fail open: only gate when the flag is explicitly true.
          if (json.mustChangePassword) setMustChangePassword(true);
          setProfileReady(true);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [checking, handleUnauthorized, forceSignOut, router]);

  // Fire-and-forget: tell the server this volunteer has now read the conversation.
  const markRead = useCallback((id: string) => {
    fetch(`/api/dashboard/conversations/${id}/read`, { method: 'POST' }).catch(() => {});
  }, []);

  // Select a conversation. Reset the detail panels + optimistically clear the unread
  // dot here (in the event handler, not an effect) so the fetch effect stays free of
  // synchronous setState.
  const selectConversation = (id: string) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: false } : c)));
    markRead(id);
  };

  // Fetch the (optionally searched) conversation list. Never calls setState before
  // its first await, so it's safe to invoke straight from an effect. A per-call id
  // discards stale responses when a search change and a poll overlap.
  const loadList = useCallback(async () => {
    const reqId = ++listReqRef.current;
    try {
      const res = await fetch(
        `/api/dashboard/conversations${query ? `?q=${encodeURIComponent(query)}` : ''}`
      );
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) return;
      const json = await res.json();
      if (reqId !== listReqRef.current) return; // superseded by a newer request
      setConversations(json.conversations ?? []);
    } catch {
      /* keep the current list on a transient error */
    } finally {
      if (reqId === listReqRef.current) setListLoading(false);
    }
  }, [query, handleUnauthorized]);

  // Silent refresh of the open thread (used by polling). Only replaces detail when
  // the message set actually changed, so it never disrupts scroll or steals focus.
  const refreshOpenDetail = useCallback(async (convId: string) => {
    try {
      const res = await fetch(`/api/dashboard/conversations/${convId}`);
      if (!res.ok) return;
      const json = (await res.json()) as Detail;
      setDetail((prev) => {
        if (!prev || prev.conversation.id !== json.conversation.id) return prev; // switched away
        const prevLast = prev.messages[prev.messages.length - 1]?.id;
        const nextLast = json.messages[json.messages.length - 1]?.id;
        if (prev.messages.length === json.messages.length && prevLast === nextLast) return prev;
        return json;
      });
    } catch {
      /* ignore — the next poll will retry */
    }
  }, []);

  // Debounce the search field (300ms) into `query`. setState lives in the timeout
  // callback, never synchronously in the effect body.
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Load the list once authenticated, and again whenever the debounced query
  // changes (loadList's identity changes with `query`).
  useEffect(() => {
    if (checking) return;
    loadList();
  }, [checking, loadList]);

  // Keep the ref in sync so the polling closure sees the current selection.
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Light auto-refresh: poll the list every 30s, and the open thread with it. Pauses
  // while the tab is hidden, and refreshes immediately when it becomes visible again.
  useEffect(() => {
    if (checking) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      loadList();
      const openId = selectedIdRef.current;
      if (openId) refreshOpenDetail(openId);
    };
    const interval = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [checking, loadList, refreshOpenDetail]);

  // Load the selected conversation's thread + profile. Loading/reset state is
  // set in selectConversation (the event handler); this effect only fetches and
  // writes results inside the async callbacks.
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    fetch(`/api/dashboard/conversations/${selectedId}`)
      .then((res) => {
        if (res.status === 401) {
          handleUnauthorized();
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((json) => {
        if (active && json) setDetail(json as Detail);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId, handleUnauthorized]);

  // ── Human takeover actions (event handlers; setState is safe here) ──────────
  const handleTakeover = async () => {
    if (!selectedId || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/dashboard/conversations/${selectedId}/takeover`, { method: 'POST' });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      const json = await res.json().catch(() => null);
      if (res.status === 409) {
        setActionError(
          t('care.takenBy', { name: json?.assignedTo ?? t('care.anotherVolunteer') })
        );
        return;
      }
      if (!res.ok) {
        setActionError(json?.error ?? t('care.actionFailed'));
        return;
      }
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              conversation: {
                ...prev.conversation,
                status: 'volunteer_handling',
                assignedVolunteerName: me?.displayName ?? t('care.me'),
                assignedToMe: true,
                // Takeover regenerates this conversation's gist server-side —
                // show it immediately (null = refresh unavailable, keep current).
                summary: json?.conversationSummary ?? prev.conversation.summary,
              },
              contact:
                prev.contact && json?.contactSummary
                  ? {
                      ...prev.contact,
                      summary: json.contactSummary,
                      profile_updated_at:
                        json.profileUpdatedAt ?? prev.contact.profile_updated_at,
                    }
                  : prev.contact,
            }
          : prev
      );
      loadList();
    } catch {
      setActionError(t('care.actionFailed'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleHandback = async () => {
    if (!selectedId || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/dashboard/conversations/${selectedId}/handback`, { method: 'POST' });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setActionError(json?.error ?? t('care.actionFailed'));
        return;
      }
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              conversation: {
                ...prev.conversation,
                status: 'ai_handling',
                assignedVolunteerName: null,
                assignedToMe: false,
              },
            }
          : prev
      );
      loadList();
    } catch {
      setActionError(t('care.actionFailed'));
    } finally {
      setActionBusy(false);
    }
  };

  // Sends a volunteer reply. Returns a tag so the composer can surface the 24h
  // window notice / errors and clear itself on success.
  const handleSendReply = async (text: string): Promise<'ok' | 'window_expired' | 'error'> => {
    if (!selectedId) return 'error';
    try {
      const res = await fetch(`/api/dashboard/conversations/${selectedId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.status === 401) {
        handleUnauthorized();
        return 'error';
      }
      const json = await res.json().catch(() => null);
      if (res.ok && json?.windowExpired) return 'window_expired';
      if (!res.ok || !json?.message) return 'error';
      const msg = json.message;
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              messages: [
                ...prev.messages,
                {
                  id: msg.id,
                  role: 'volunteer',
                  content: msg.content,
                  sources: null,
                  created_at: msg.created_at,
                  sentByName: msg.sentByName ?? me?.displayName ?? t('care.volunteerLabel'),
                },
              ],
            }
          : prev
      );
      loadList();
      return 'ok';
    } catch {
      return 'error';
    }
  };

  const handleLogout = async () => {
    await forceSignOut();
    router.refresh();
  };

  // Neutral loader while EITHER the session check or the profile fetch is in flight,
  // so the inbox chrome never flashes before the password gate resolves.
  if (checking || !profileReady) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-sm text-ink-muted">{t('care.loading')}</p>
      </div>
    );
  }

  // First-login: force a password change before showing the inbox. On success the
  // gate clears and we continue in the same session.
  if (mustChangePassword) {
    return <PasswordChangeGate onDone={() => setMustChangePassword(false)} />;
  }

  // Apply the filter tab, then day-group the (already newest-first) list under MYT
  // date headers.
  const visibleConversations =
    filter === 'mine' ? conversations.filter((c) => c.assignedToMe) : conversations;
  const nowMs = Date.now();
  const todayKey = mytDayKey(new Date(nowMs).toISOString());
  const yesterdayKey = mytDayKey(new Date(nowMs - 86_400_000).toISOString());
  const dayGroups = buildDayGroups(t, visibleConversations, todayKey, yesterdayKey);

  return (
    <div className="h-screen flex flex-col bg-bg md:ml-[72px]">
      {/* TOP BAR — navigation lives in the rail now; shared frame carries brand. */}
      <TopBar moduleTitle={t('care.moduleTitle')} userLabel={me?.displayName || email || undefined} onLogout={handleLogout} />

      <DashboardNav role={me?.role ?? 'volunteer'} active="inbox" grants={me?.grants} />

      {/* THREE PANELS */}
      <div className="flex-1 flex min-h-0">
        {/* LEFT — search + conversation list */}
        <aside className="w-[340px] shrink-0 border-r border-border bg-surface-soft flex flex-col min-h-0">
          {/* SEARCH */}
          <div className="shrink-0 p-3 border-b border-border">
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('care.searchPlaceholder')}
              className="w-full text-sm px-4 py-2 border border-border-strong rounded-full bg-surface-soft text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
            />
          </div>

          {/* FILTER TABS */}
          <div className="shrink-0 px-3 py-2 border-b border-border flex items-center gap-1">
            {([['all', t('care.filterAll')], ['mine', t('care.filterMine')]] as const).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs transition ${
                  filter === f
                    ? 'bg-accent/10 text-accent-deep font-medium'
                    : 'text-ink-muted hover:bg-accent/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* LIST (scrolls; day headers stick within this container) */}
          <div className="flex-1 overflow-y-auto">
            {listLoading ? (
              <p className="p-6 text-sm text-ink-muted">{t('care.loading')}</p>
            ) : visibleConversations.length === 0 ? (
              <p className="p-6 text-sm text-ink-muted">
                {filter === 'mine'
                  ? t('care.emptyMine')
                  : query
                    ? t('care.emptySearch')
                    : t('care.emptyAll')}
              </p>
            ) : (
              <ul className="pb-2">
                {dayGroups.map((group) => (
                  <Fragment key={group.key}>
                    <li className="sticky top-0 z-[1] px-4 py-1.5 font-serif text-[11.5px] tracking-[0.2em] text-label bg-surface-soft/95 backdrop-blur-sm border-b border-border">
                      {group.label}
                    </li>
                    {group.items.map((c) => {
                      const ch = channelMeta(t, c.channel);
                      const selected = c.id === selectedId;
                      // Never dot the conversation that's currently open.
                      const showUnread = c.unread && !selected;
                      return (
                        <li key={c.id} className="px-2 pt-1.5">
                          <button
                            onClick={() => selectConversation(c.id)}
                            className={`w-full text-left px-3 py-2.5 rounded-xl border transition ${
                              selected
                                ? 'card-selected border-transparent'
                                : 'bg-surface border-border hover:border-gold-border'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {showUnread && (
                                  <span
                                    className="shrink-0 w-2 h-2 rounded-full bg-accent"
                                    aria-label={t('care.unread')}
                                  />
                                )}
                                <span className="text-accent" title={ch.label}>{ch.icon}</span>
                                <span
                                  className={`truncate text-[13.5px] text-ink ${
                                    showUnread ? 'font-bold' : 'font-semibold'
                                  }`}
                                >
                                  {c.contactName}
                                </span>
                              </div>
                              <span className="shrink-0 text-[11.5px] text-label">{formatTime(c.lastMessageAt)}</span>
                            </div>
                            <p className="mt-1 text-sm text-ink-body line-clamp-2 break-words">
                              {c.lastMessagePreview || t('care.noMessage')}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10.5px] ${statusStyle(c.status)}`}>
                                {statusLabel(t, c.status)}
                              </span>
                              {c.crisisFlag && <CrisisTag />}
                              {c.category && <CategoryTag category={c.category} />}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </Fragment>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* CENTER — thread header · message thread · composer */}
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-ink-muted">{t('care.selectConversation')}</p>
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-ink-muted">{t('care.loading')}</p>
            </div>
          ) : !detail ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-ink-muted">{t('care.loadFailed')}</p>
            </div>
          ) : (
            <>
              {/* THREAD HEADER — handling state + takeover / handback */}
              <ThreadHeader
                detail={detail}
                isAdmin={me?.role === 'admin'}
                actionBusy={actionBusy}
                actionError={actionError}
                onTakeover={handleTakeover}
                onHandback={handleHandback}
              />

              {/* MESSAGES */}
              <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
                  {detail.messages.map((m) => (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl p-4 ${
                          m.role === 'user'
                            ? 'card-selected text-ink'
                            : 'bg-surface border border-border text-ink-body'
                        }`}
                      >
                        {m.role === 'user' ? (
                          <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        ) : m.role === 'volunteer' ? (
                          <>
                            <div className="text-xs font-medium text-accent-deep mb-1.5">
                              {t('care.volunteerLabel')} · {m.sentByName ?? t('care.volunteerLabel')}
                            </div>
                            <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                          </>
                        ) : (
                          <>
                            <MasterMarkdown>{m.content}</MasterMarkdown>
                            <MessageSources sources={m.sources ?? []} title={t('care.sourcesTitle')} />
                          </>
                        )}
                        <div
                          className={`mt-2 text-[11px] ${
                            m.role === 'user' ? 'text-ink/60 text-right' : 'text-ink-faint'
                          }`}
                        >
                          {formatDateTime(m.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {detail.messages.length === 0 && (
                    <p className="text-center text-sm text-ink-muted py-12">{t('care.threadEmpty')}</p>
                  )}
                </div>
              </div>

              {/* COMPOSER — only the assigned volunteer of a taken-over conversation */}
              {detail.conversation.status === 'volunteer_handling' &&
                detail.conversation.assignedToMe && (
                  <ReplyComposer onSend={handleSendReply} />
                )}
            </>
          )}
        </main>

        {/* RIGHT — contact profile */}
        <aside className="w-[300px] shrink-0 border-l border-border bg-surface-soft overflow-y-auto">
          {!selectedId ? (
            <p className="p-6 text-sm text-ink-muted">{t('care.contactSidebar')}</p>
          ) : !detail ? (
            <p className="p-6 text-sm text-ink-muted">{t('care.loading')}</p>
          ) : (
            <ContactPanel
              key={detail.contact?.id ?? 'none'}
              detail={detail}
              canOutreach={grantAllows(me?.grants, 'outreach', 'edit')}
              onUnauthorized={handleUnauthorized}
              onContactUpdate={applyContactUpdate}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

// ── Thread header: handling state + takeover / handback ─────────────────────
// AI-handled → gold 接手对话. volunteer_handling → 义工处理中 · <name>, plus a
// 交回 AI button for the assignee or an admin.
function ThreadHeader({
  detail,
  isAdmin,
  actionBusy,
  actionError,
  onTakeover,
  onHandback,
}: {
  detail: Detail;
  isAdmin: boolean;
  actionBusy: boolean;
  actionError: string | null;
  onTakeover: () => void;
  onHandback: () => void;
}) {
  const t = useT();
  const isVolunteerHandling = detail.conversation.status === 'volunteer_handling';
  const canHandback = Boolean(detail.conversation.assignedToMe) || isAdmin;

  return (
    <div className="shrink-0 border-b border-border bg-surface/70 backdrop-blur-sm px-4 py-2.5 flex items-center justify-between gap-3">
      <div className="min-w-0 text-sm">
        {isVolunteerHandling ? (
          <span className="text-accent-deep">
            {t('care.status.volunteerHandling')} · <span className="font-medium">{detail.conversation.assignedVolunteerName ?? t('care.volunteerLabel')}</span>
          </span>
        ) : (
          <span className="pill-gold inline-block px-2.5 py-0.5 rounded-full text-[10.5px]">{t('care.aiHandlingPill')}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actionError && <span className="text-xs text-red-600">{actionError}</span>}
        {!isVolunteerHandling ? (
          <button
            onClick={onTakeover}
            disabled={actionBusy}
            className="btn-primary px-4 py-1.5 text-sm"
          >
            {t('care.takeover')}
          </button>
        ) : canHandback ? (
          <button
            onClick={onHandback}
            disabled={actionBusy}
            className="btn-secondary px-4 py-1.5 text-sm"
          >
            {t('care.handback')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── Reply composer (shown to the assigned volunteer) ────────────────────────
// Local state only; onSend returns a tag so we can surface the 24h-window notice
// and clear on success — no effects, so the set-state-in-effect rule is moot.
function ReplyComposer({
  onSend,
}: {
  onSend: (text: string) => Promise<'ok' | 'window_expired' | 'error'>;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setNotice(null);
    const result = await onSend(trimmed);
    setSending(false);
    if (result === 'ok') {
      setText('');
    } else if (result === 'window_expired') {
      setNotice(t('care.windowExpired'));
    } else {
      setNotice(t('care.sendFailed'));
    }
  };

  return (
    <div className="shrink-0 border-t border-border bg-surface/70 backdrop-blur-sm p-3">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder={t('care.replyPlaceholder')}
            disabled={sending}
            className="flex-1 text-sm p-2.5 border border-border rounded-lg bg-surface text-ink placeholder:text-ink-faint leading-relaxed resize-y focus:outline-none focus:border-accent disabled:opacity-60"
          />
          <button
            onClick={submit}
            disabled={sending || !text.trim()}
            className="btn-primary px-5 py-2.5 text-sm"
          >
            {sending ? t('care.sending') : t('care.send')}
          </button>
        </div>
        {/* 24h-window / send-failure notice — a semantic warning, kept amber. */}
        {notice && <p className="mt-1.5 text-xs text-[#B45309]">{notice}</p>}
      </div>
    </div>
  );
}

// 修行阶段 options — E3 stage-vocab unification (brief §4): the dropdown WRITES
// canonical stage KEYS (matching ALLOWED_STAGES in the contacts PATCH route)
// and renders labels via the shared vocab. A legacy Chinese value on the row
// still displays correctly through the raw-value fallback (until migration 033).
const STAGE_OPTIONS: string[] = STAGES.map((s) => s.key);

// 本次对话 — a one-line gist of the OPEN conversation (distinct from the contact's
// evolving 有缘人档案). Muted placeholder until the nightly cron generates it.
function ConversationGistLine({ summary }: { summary: string | null | undefined }) {
  const t = useT();
  return (
    <div>
      <p className="u-label mb-1">{t('care.gistTitle')}</p>
      {summary?.trim() ? (
        <p className="text-sm text-ink leading-relaxed">{summary.trim()}</p>
      ) : (
        <p className="text-sm text-ink-faint italic">{t('care.gistPending')}</p>
      )}
    </div>
  );
}

// ── Right-panel contact profile (stage + notes editable) ────────────────────
// Volunteers edit 修行阶段 (stage) and 义工备注 (notes). Both save through the
// auth-gated /api/dashboard/contacts/[id] PATCH route, which writes via
// supabaseAdmin (service role) — the browser never writes to Supabase directly.
// This component is remounted (via `key` on the contact id) when the selected
// contact changes, so its local edit state re-initialises from props with no
// sync effect (keeps setState out of effects-with-deps).
function ContactPanel({
  detail,
  canOutreach,
  onUnauthorized,
  onContactUpdate,
}: {
  detail: Detail;
  canOutreach?: boolean;
  onUnauthorized: () => void;
  onContactUpdate: (updates: Partial<ContactProfile>) => void;
}) {
  const t = useT();
  const c = detail.contact;
  const contactId = c?.id ?? null;
  const name = c?.display_name || t('care.anonymousVisitor');
  const ch = channelMeta(t, detail.conversation.channel);
  // 联系方式 is system-managed (read-only). Show the WhatsApp phone when we have
  // one; for web visitors show a friendly label rather than the raw browser_id
  // (a system UUID, meaningless to volunteers).
  const contactPoint = c?.wa_id || (c ? t('care.webVisitor') : '—');

  // Stage (dropdown, saves on change).
  const [stage, setStage] = useState<string>(c?.stage ?? '');
  const [stageSaved, setStageSaved] = useState(false);
  const [stageSaving, setStageSaving] = useState(false);

  // Notes (textarea, saves on button click).
  const [notes, setNotes] = useState<string>(c?.notes ?? '');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [notesError, setNotesError] = useState(false);

  // Shared PATCH to the auth-gated write route. Returns a small result tag so
  // callers can revert / surface errors / handle an expired session.
  async function patchContact(
    payload: { stage?: string; notes?: string }
  ): Promise<'ok' | 'unauthorized' | 'error'> {
    if (!contactId) return 'error';
    try {
      const res = await fetch(`/api/dashboard/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) return 'unauthorized';
      return res.ok ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }

  const handleStageChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    const previous = stage;
    setStage(next); // optimistic
    setStageSaved(false);
    setStageSaving(true);
    const result = await patchContact({ stage: next });
    setStageSaving(false);
    if (result === 'unauthorized') {
      onUnauthorized();
      return;
    }
    if (result === 'error') {
      setStage(previous); // revert on failure
      return;
    }
    onContactUpdate({ stage: next });
    setStageSaved(true);
    setTimeout(() => setStageSaved(false), 1500);
  };

  const handleNotesSave = async () => {
    setNotesSaved(false);
    setNotesError(false);
    setNotesSaving(true);
    const result = await patchContact({ notes });
    setNotesSaving(false);
    if (result === 'unauthorized') {
      onUnauthorized();
      return;
    }
    if (result === 'error') {
      setNotesError(true);
      return;
    }
    const trimmed = notes.trim(); // server trims; mirror it locally
    setNotes(trimmed);
    onContactUpdate({ notes: trimmed });
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 1500);
  };

  // Orphan conversation (no contact_id): no profile can exist. Render gracefully —
  // never a blank/broken panel — while still showing this session's gist + any tags.
  if (!c) {
    return (
      <div className="p-5 space-y-5">
        <div>
          <p className="text-lg font-semibold text-ink">{t('care.unidentifiedVisitor')}</p>
          <p className="mt-0.5 text-sm text-ink-muted">
            <span className="text-accent">{ch.icon}</span> {ch.label}
          </p>
          {(detail.conversation.crisisFlag || detail.conversation.category) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {detail.conversation.crisisFlag && <CrisisTag />}
              {detail.conversation.category && <CategoryTag category={detail.conversation.category} />}
            </div>
          )}
        </div>
        <ConversationGistLine summary={detail.conversation.summary} />
        <p className="text-xs text-ink-faint leading-relaxed">{t('care.orphanNote')}</p>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5">
      <div>
        <p className="text-lg font-semibold text-ink break-words">{name}</p>
        <p className="mt-0.5 text-sm text-ink-muted">
          <span className="text-accent">{ch.icon}</span> {ch.label}
        </p>
        {(detail.conversation.crisisFlag || detail.conversation.category) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {detail.conversation.crisisFlag && <CrisisTag />}
            {detail.conversation.category && (
              <CategoryTag category={detail.conversation.category} />
            )}
          </div>
        )}
      </div>

      {canOutreach && contactId && <OutreachQuickPanel contactId={contactId} />}

      <Field label={t('care.contactMethod')} value={contactPoint} mono />

      {/* 修行阶段 — editable dropdown, saves on change */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="u-label">{t('care.practiceStage')}</p>
          {stageSaved && <span className="text-xs text-accent-deep">{t('care.saved')}</span>}
        </div>
        <select
          value={stage}
          onChange={handleStageChange}
          disabled={!contactId || stageSaving}
          className="w-full text-sm text-ink bg-surface border border-border-strong rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent disabled:opacity-60"
        >
          {!STAGE_OPTIONS.includes(stage) && (
            // legacy value (or empty): keep it visible via the raw-value
            // fallback so the row reads correctly pre-033
            <option value={stage} disabled>
              {stage ? stageLabel(stage) : t('care.none')}
            </option>
          )}
          {STAGE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {stageLabel(s)}
            </option>
          ))}
        </select>
      </div>

      {/* 本次对话 gist (this conversation) sits ABOVE the evolving contact profile */}
      <ConversationGistLine summary={detail.conversation.summary} />

      <div>
        <p className="u-label mb-1">{t('care.contactProfile')}</p>
        <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">
          {c.summary?.trim() || t('care.none')}
        </p>
        {/* Staleness always visible: when this rolling profile was last regenerated. */}
        {c.profile_updated_at && (
          <p className="mt-1 text-xs text-ink-faint">
            {t('care.profileUpdated', { time: formatDateTime(c.profile_updated_at) })}
          </p>
        )}
      </div>

      {/* 义工备注 — editable textarea, saves on button click */}
      <div>
        <p className="u-label mb-1">{t('care.volunteerNotes')}</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={!contactId}
          rows={4}
          placeholder={t('care.notesPlaceholder')}
          className="w-full text-sm text-ink bg-surface border border-border-strong rounded-lg px-2.5 py-2 leading-relaxed resize-y focus:outline-none focus:border-accent disabled:opacity-60 placeholder:text-ink-faint"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button
            onClick={handleNotesSave}
            disabled={!contactId || notesSaving}
            className="btn-primary px-3 py-1 text-xs"
          >
            {notesSaving ? t('care.saving') : t('care.save')}
          </button>
          {notesSaved && <span className="text-xs text-accent-deep">{t('care.saved')}</span>}
          {notesError && <span className="text-xs text-red-600">{t('care.saveFailed')}</span>}
        </div>
      </div>

      {c && (
        <div className="pt-3 border-t border-border space-y-1 text-xs text-ink-faint">
          <p>{t('care.firstContact', { time: formatDateTime(c.first_seen) })}</p>
          <p>{t('care.lastActive', { time: formatDateTime(c.last_seen) })}</p>
        </div>
      )}
    </div>
  );
}

// Category / crisis tags — display-only (categorisation is automatic; not yet
// volunteer-editable). Warm palette for the topic chip; a clear red for crisis.
function CategoryTag({ category }: { category: string }) {
  return (
    <span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[10.5px]">
      {category}
    </span>
  );
}

function CrisisTag() {
  const t = useT();
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#FEF2F2] text-red-700">
      {t('care.crisis')}
    </span>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="u-label mb-1">{label}</p>
      <p className={`text-sm text-ink break-words ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}
