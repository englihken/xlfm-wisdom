// src/app/dashboard/page.tsx
// 心灵法门人文关怀系统 — volunteer inbox (Phase 3 Session 2).
// Three-panel read-only dashboard: conversation list · message thread · contact
// profile. Auth-gated client-side (redirects to login); all conversation data is
// read through server-side, auth-protected API routes (never directly from the
// browser). Human takeover comes in a later session.

'use client';

import { useEffect, useState, useCallback, useRef, Fragment, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { MasterMarkdown, MessageSources, type Source } from '@/components/assistant-message';
import { PasswordChangeGate } from '@/components/password-change-gate';
import { DashboardNav } from '@/components/dashboard-nav';

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
};

type ThreadMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[] | null;
  created_at: string;
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
};

type Detail = {
  conversation: {
    id: string;
    channel: string;
    status: string;
    category: string | null;
    crisisFlag: boolean;
  };
  contact: ContactProfile | null;
  messages: ThreadMessage[];
};

// ── Display helpers ──────────────────────────────────────────────────────────
const CHANNELS: Record<string, { icon: string; label: string }> = {
  web: { icon: '◍', label: '网页' },
  whatsapp: { icon: '✆', label: 'WhatsApp' },
};
function channelMeta(channel: string) {
  return CHANNELS[channel] ?? { icon: '◍', label: channel };
}

const STATUS_LABELS: Record<string, string> = {
  ai_handling: 'AI处理中',
  needs_human: '需人工',
  human_handling: '义工处理中',
  resolved: '已完成',
  closed: '已关闭',
};
const STATUS_STYLES: Record<string, string> = {
  ai_handling: 'bg-[#FAEFD0] text-[#8B6F47]',
  needs_human: 'bg-[#FEF2F2] text-red-700',
  human_handling: 'bg-[#FAEFD0] text-[#A87929]',
  resolved: 'bg-[#FAEFD0] text-[#8B6F47]',
  closed: 'bg-[#FAEFD0] text-[#B89968]',
};
function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}
function statusStyle(status: string) {
  return STATUS_STYLES[status] ?? 'bg-[#FAEFD0] text-[#8B6F47]';
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
function dayLabelFromKey(key: string, todayKey: string, yesterdayKey: string): string {
  if (key === todayKey) return '今天';
  if (key === yesterdayKey) return '昨天';
  const [, m, d] = key.split('-');
  return `${m}/${d}`;
}
// Group an already-newest-first list under consecutive MYT day headers.
function buildDayGroups(
  items: ListItem[],
  todayKey: string,
  yesterdayKey: string
): { key: string; label: string; items: ListItem[] }[] {
  const groups: { key: string; label: string; items: ListItem[] }[] = [];
  for (const c of items) {
    const key = mytDayKey(c.lastMessageAt);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: dayLabelFromKey(key, todayKey, yesterdayKey), items: [] };
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
  role: 'admin' | 'volunteer';
  mustChangePassword?: boolean;
};

export default function DashboardPage() {
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
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
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
          setMe({ displayName: json.displayName ?? null, role: json.role });
          // Fail open: only gate when the flag is explicitly true.
          if (json.mustChangePassword) setMustChangePassword(true);
          setProfileReady(true);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [checking, handleUnauthorized, forceSignOut]);

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

  const handleLogout = async () => {
    await forceSignOut();
    router.refresh();
  };

  // Neutral loader while EITHER the session check or the profile fetch is in flight,
  // so the inbox chrome never flashes before the password gate resolves.
  if (checking || !profileReady) {
    return (
      <div className="min-h-screen bg-[#FFF3DA] flex items-center justify-center">
        <p className="text-sm text-[#8B6F47]">加载中…</p>
      </div>
    );
  }

  // First-login: force a password change before showing the inbox. On success the
  // gate clears and we continue in the same session.
  if (mustChangePassword) {
    return <PasswordChangeGate onDone={() => setMustChangePassword(false)} />;
  }

  // Day-group the (already newest-first) list under MYT date headers.
  const nowMs = Date.now();
  const todayKey = mytDayKey(new Date(nowMs).toISOString());
  const yesterdayKey = mytDayKey(new Date(nowMs - 86_400_000).toISOString());
  const dayGroups = buildDayGroups(conversations, todayKey, yesterdayKey);

  return (
    <div className="h-screen flex flex-col bg-[#FFF3DA] md:ml-[72px]">
      {/* TOP BAR — navigation lives in the rail now; keep title, name, 登出. */}
      <header className="shrink-0 border-b border-[#EFE3BF] bg-white/60 backdrop-blur-sm">
        <div className="px-5 py-3 flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-[#583A0F]">心灵法门人文关怀系统</h1>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-sm text-[#8B6F47]">{me?.displayName || email}</span>
            <button
              onClick={handleLogout}
              className="px-4 py-1.5 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      <DashboardNav role={me?.role ?? 'volunteer'} active="inbox" />

      {/* THREE PANELS */}
      <div className="flex-1 flex min-h-0">
        {/* LEFT — search + conversation list */}
        <aside className="w-[340px] shrink-0 border-r border-[#EFE3BF] bg-[#FFFEF6] flex flex-col min-h-0">
          {/* SEARCH */}
          <div className="shrink-0 p-3 border-b border-[#EFE3BF]">
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="搜索姓名 / 号码 / 内容…"
              className="w-full text-sm px-3 py-2 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] placeholder:text-[#B89968] focus:outline-none focus:border-[#D89938]"
            />
          </div>

          {/* LIST (scrolls; day headers stick within this container) */}
          <div className="flex-1 overflow-y-auto">
            {listLoading ? (
              <p className="p-6 text-sm text-[#8B6F47]">加载中…</p>
            ) : conversations.length === 0 ? (
              <p className="p-6 text-sm text-[#8B6F47]">{query ? '未找到相关对话' : '暂无对话'}</p>
            ) : (
              <ul>
                {dayGroups.map((group) => (
                  <Fragment key={group.key}>
                    <li className="sticky top-0 z-[1] px-4 py-1.5 text-[11px] font-medium text-[#B89968] bg-[#FFFEF6]/95 backdrop-blur-sm border-b border-[#EFE3BF]">
                      {group.label}
                    </li>
                    {group.items.map((c) => {
                      const ch = channelMeta(c.channel);
                      const selected = c.id === selectedId;
                      // Never dot the conversation that's currently open.
                      const showUnread = c.unread && !selected;
                      return (
                        <li key={c.id}>
                          <button
                            onClick={() => selectConversation(c.id)}
                            className={`w-full text-left px-4 py-3 border-b border-[#EFE3BF] transition ${
                              selected ? 'bg-[#FAEFD0]' : 'hover:bg-[#FAEFD0]/60'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {showUnread && (
                                  <span
                                    className="shrink-0 w-2 h-2 rounded-full bg-[#D89938]"
                                    aria-label="未读"
                                  />
                                )}
                                <span className="text-[#D89938]" title={ch.label}>{ch.icon}</span>
                                <span
                                  className={`truncate text-[#583A0F] ${
                                    showUnread ? 'font-semibold' : 'font-medium'
                                  }`}
                                >
                                  {c.contactName}
                                </span>
                              </div>
                              <span className="shrink-0 text-xs text-[#B89968]">{formatTime(c.lastMessageAt)}</span>
                            </div>
                            <p className="mt-1 text-sm text-[#8B6F47] line-clamp-2 break-words">
                              {c.lastMessagePreview || '（无消息）'}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${statusStyle(c.status)}`}>
                                {statusLabel(c.status)}
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

        {/* CENTER — message thread */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {!selectedId ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-[#8B6F47]">选择一个对话查看</p>
            </div>
          ) : detailLoading ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-[#8B6F47]">加载中…</p>
            </div>
          ) : !detail ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-[#8B6F47]">无法加载对话</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
              {detail.messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl p-4 ${
                      m.role === 'user'
                        ? 'bg-[#D89938] text-white'
                        : 'bg-white border border-[#EFE3BF] text-[#583A0F]'
                    }`}
                  >
                    {m.role === 'user' ? (
                      <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                    ) : (
                      <>
                        <MasterMarkdown>{m.content}</MasterMarkdown>
                        <MessageSources sources={m.sources ?? []} title="参考开示：" />
                      </>
                    )}
                    <div
                      className={`mt-2 text-[11px] ${
                        m.role === 'user' ? 'text-white/70 text-right' : 'text-[#B89968]'
                      }`}
                    >
                      {formatDateTime(m.created_at)}
                    </div>
                  </div>
                </div>
              ))}
              {detail.messages.length === 0 && (
                <p className="text-center text-sm text-[#8B6F47] py-12">此对话暂无消息</p>
              )}
            </div>
          )}
        </main>

        {/* RIGHT — contact profile */}
        <aside className="w-[300px] shrink-0 border-l border-[#EFE3BF] bg-[#FFFEF6] overflow-y-auto">
          {!selectedId ? (
            <p className="p-6 text-sm text-[#8B6F47]">联系人资料</p>
          ) : !detail ? (
            <p className="p-6 text-sm text-[#8B6F47]">加载中…</p>
          ) : (
            <ContactPanel
              key={detail.contact?.id ?? 'none'}
              detail={detail}
              onUnauthorized={handleUnauthorized}
              onContactUpdate={applyContactUpdate}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

// 修行阶段 options — must match ALLOWED_STAGES in the contacts PATCH route.
const STAGE_OPTIONS = ['初次接触', '学习中', '共修者', '义工'] as const;

// ── Right-panel contact profile (stage + notes editable) ────────────────────
// Volunteers edit 修行阶段 (stage) and 义工备注 (notes). Both save through the
// auth-gated /api/dashboard/contacts/[id] PATCH route, which writes via
// supabaseAdmin (service role) — the browser never writes to Supabase directly.
// This component is remounted (via `key` on the contact id) when the selected
// contact changes, so its local edit state re-initialises from props with no
// sync effect (keeps setState out of effects-with-deps).
function ContactPanel({
  detail,
  onUnauthorized,
  onContactUpdate,
}: {
  detail: Detail;
  onUnauthorized: () => void;
  onContactUpdate: (updates: Partial<ContactProfile>) => void;
}) {
  const c = detail.contact;
  const contactId = c?.id ?? null;
  const name = c?.display_name || '匿名访客';
  const ch = channelMeta(detail.conversation.channel);
  // 联系方式 is system-managed (read-only). Show the WhatsApp phone when we have
  // one; for web visitors show a friendly label rather than the raw browser_id
  // (a system UUID, meaningless to volunteers).
  const contactPoint = c?.wa_id || (c ? '网页访客' : '—');

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

  return (
    <div className="p-5 space-y-5">
      <div>
        <p className="text-lg font-semibold text-[#583A0F] break-words">{name}</p>
        <p className="mt-0.5 text-sm text-[#8B6F47]">
          <span className="text-[#D89938]">{ch.icon}</span> {ch.label}
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

      <Field label="联系方式" value={contactPoint} mono />

      {/* 修行阶段 — editable dropdown, saves on change */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-medium text-[#B89968]">修行阶段</p>
          {stageSaved && <span className="text-xs text-[#A87929]">已保存 ✓</span>}
        </div>
        <select
          value={stage}
          onChange={handleStageChange}
          disabled={!contactId || stageSaving}
          className="w-full text-sm text-[#583A0F] bg-white border border-[#EFE3BF] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#D89938] disabled:opacity-60"
        >
          {!STAGE_OPTIONS.includes(stage as (typeof STAGE_OPTIONS)[number]) && (
            <option value="" disabled>
              暂无
            </option>
          )}
          {STAGE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-xs font-medium text-[#B89968] mb-1">AI 摘要</p>
        <p className="text-sm text-[#583A0F] whitespace-pre-wrap leading-relaxed">
          {c?.summary?.trim() || '暂无'}
        </p>
      </div>

      {/* 义工备注 — editable textarea, saves on button click */}
      <div>
        <p className="text-xs font-medium text-[#B89968] mb-1">义工备注</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={!contactId}
          rows={4}
          placeholder="为这位联系人添加备注…"
          className="w-full text-sm text-[#583A0F] bg-white border border-[#EFE3BF] rounded-lg px-2.5 py-2 leading-relaxed resize-y focus:outline-none focus:border-[#D89938] disabled:opacity-60 placeholder:text-[#B89968]"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button
            onClick={handleNotesSave}
            disabled={!contactId || notesSaving}
            className="px-3 py-1 text-xs text-white bg-[#D89938] rounded-full hover:bg-[#C5862C] transition disabled:opacity-60"
          >
            {notesSaving ? '保存中…' : '保存'}
          </button>
          {notesSaved && <span className="text-xs text-[#A87929]">已保存 ✓</span>}
          {notesError && <span className="text-xs text-red-600">保存失败，请重试</span>}
        </div>
      </div>

      {c && (
        <div className="pt-3 border-t border-[#EFE3BF] space-y-1 text-xs text-[#B89968]">
          <p>首次联系：{formatDateTime(c.first_seen)}</p>
          <p>最近活跃：{formatDateTime(c.last_seen)}</p>
        </div>
      )}
    </div>
  );
}

// Category / crisis tags — display-only (categorisation is automatic; not yet
// volunteer-editable). Warm palette for the topic chip; a clear red for crisis.
function CategoryTag({ category }: { category: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#FAEFD0] text-[#8B6F47]">
      {category}
    </span>
  );
}

function CrisisTag() {
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#FEF2F2] text-red-700">
      危机
    </span>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-[#B89968] mb-1">{label}</p>
      <p className={`text-sm text-[#583A0F] break-words ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}
