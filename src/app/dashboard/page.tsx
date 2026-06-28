// src/app/dashboard/page.tsx
// 心灵法门人文关怀系统 — volunteer inbox (Phase 3 Session 2).
// Three-panel read-only dashboard: conversation list · message thread · contact
// profile. Auth-gated client-side (redirects to login); all conversation data is
// read through server-side, auth-protected API routes (never directly from the
// browser). Human takeover comes in a later session.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { MasterMarkdown, MessageSources, type Source } from '@/components/assistant-message';

// ── Types (mirror the API route shapes) ──────────────────────────────────────
type ListItem = {
  id: string;
  contactName: string;
  channel: string;
  stage: string | null;
  status: string;
  lastMessagePreview: string;
  lastMessageAt: string;
};

type ThreadMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[] | null;
  created_at: string;
};

type ContactProfile = {
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
  conversation: { id: string; channel: string; status: string };
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

export default function DashboardPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const [conversations, setConversations] = useState<ListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // If any dashboard API returns 401, the session is gone — back to login.
  const handleUnauthorized = useCallback(() => {
    router.replace('/dashboard/login');
  }, [router]);

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

  // Select a conversation. Reset the detail panels here (in the event handler,
  // not the effect) so the fetch effect stays free of synchronous setState.
  const selectConversation = (id: string) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
  };

  // Load the conversation list once authenticated. listLoading starts true, so
  // we only flip it off in the async callback (no synchronous setState here).
  useEffect(() => {
    if (checking) return;
    let active = true;
    fetch('/api/dashboard/conversations')
      .then((res) => {
        if (res.status === 401) {
          handleUnauthorized();
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((json) => {
        if (active && json) setConversations(json.conversations ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [checking, handleUnauthorized]);

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
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace('/dashboard/login');
    router.refresh();
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-[#FFF3DA] flex items-center justify-center">
        <p className="text-sm text-[#8B6F47]">加载中…</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#FFF3DA]">
      {/* TOP BAR */}
      <header className="shrink-0 border-b border-[#EFE3BF] bg-white/60 backdrop-blur-sm">
        <div className="px-5 py-3 flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-[#583A0F]">心灵法门人文关怀系统</h1>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-sm text-[#8B6F47]">{email}</span>
            <button
              onClick={handleLogout}
              className="px-4 py-1.5 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      {/* THREE PANELS */}
      <div className="flex-1 flex min-h-0">
        {/* LEFT — conversation list */}
        <aside className="w-[340px] shrink-0 border-r border-[#EFE3BF] bg-[#FFFEF6] overflow-y-auto">
          {listLoading ? (
            <p className="p-6 text-sm text-[#8B6F47]">加载中…</p>
          ) : conversations.length === 0 ? (
            <p className="p-6 text-sm text-[#8B6F47]">暂无对话</p>
          ) : (
            <ul>
              {conversations.map((c) => {
                const ch = channelMeta(c.channel);
                const selected = c.id === selectedId;
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
                          <span className="text-[#D89938]" title={ch.label}>{ch.icon}</span>
                          <span className="font-medium text-[#583A0F] truncate">{c.contactName}</span>
                        </div>
                        <span className="shrink-0 text-xs text-[#B89968]">{formatTime(c.lastMessageAt)}</span>
                      </div>
                      <p className="mt-1 text-sm text-[#8B6F47] line-clamp-2 break-words">
                        {c.lastMessagePreview || '（无消息）'}
                      </p>
                      <div className="mt-1.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${statusStyle(c.status)}`}>
                          {statusLabel(c.status)}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
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
            <ContactPanel detail={detail} />
          )}
        </aside>
      </div>
    </div>
  );
}

// ── Right-panel contact profile (read-only) ─────────────────────────────────
function ContactPanel({ detail }: { detail: Detail }) {
  const c = detail.contact;
  const name = c?.display_name || '匿名访客';
  const ch = channelMeta(detail.conversation.channel);
  const contactPoint = c?.wa_id || c?.browser_id || '—';

  return (
    <div className="p-5 space-y-5">
      <div>
        <p className="text-lg font-semibold text-[#583A0F] break-words">{name}</p>
        <p className="mt-0.5 text-sm text-[#8B6F47]">
          <span className="text-[#D89938]">{ch.icon}</span> {ch.label}
        </p>
      </div>

      <Field label="联系方式" value={contactPoint} mono />
      <Field label="修行阶段" value={c?.stage || '暂无'} />

      <div>
        <p className="text-xs font-medium text-[#B89968] mb-1">AI 摘要</p>
        <p className="text-sm text-[#583A0F] whitespace-pre-wrap leading-relaxed">
          {c?.summary?.trim() || '暂无'}
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-[#B89968] mb-1">义工备注</p>
        <p className="text-sm text-[#583A0F] whitespace-pre-wrap leading-relaxed">
          {c?.notes?.trim() || '暂无'}
        </p>
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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-[#B89968] mb-1">{label}</p>
      <p className={`text-sm text-[#583A0F] break-words ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}
