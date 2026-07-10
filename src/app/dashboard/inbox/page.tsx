// src/app/dashboard/inbox/page.tsx
// 收件箱 — 共修会事务信箱 (E2). Outlook-style 3-pane (rail · list · reading) for content
// roles (owner / centre_head / admin); an HQ health board for summary roles (erp_admin /
// committee). Admin opens non-owned mailboxes only via an audited break-glass confirm.
// All wall logic is server-side (inbox-scope); this page only renders what the APIs return.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { TopBar } from '@/components/top-bar';
import { DashboardNav } from '@/components/dashboard-nav';
import type { Grants } from '@/lib/access';
import { STATUS_META, statusLabel, kindLabel, type ThreadStatus } from '@/lib/inbox';

type Me = { role: string; displayName: string | null; email: string; grants?: Grants };
type Owner = { id: string; name: string };
type Mailbox = {
  id: string; centre_id: string; centre_name: string; centre_code: string; is_enabled: boolean;
  auto_reply_enabled: boolean; auto_reply_text: string | null; owners: Owner[]; owned: boolean; locked: boolean;
  counts: { new_n: number; in_progress_n: number; crisis_n: number }; oldest_unhandled_days: number;
};
type Meta = {
  level: 'admin' | 'summary' | 'edit' | 'owner-only' | 'none';
  escalation: { remind_centre_days: number; surface_hq_days: number };
  mailboxes: Mailbox[];
  internal: { new_n: number };
  can_compose_internal: boolean;
};
type ListRow = {
  id: string; mailbox_id: string; kind: string; subject: string; sender_name: string | null;
  from_centre_name: string | null; status: string; crisis_flag: boolean; assigned_name: string | null;
  contact_id: string | null; linked_label: string | null; last_message_at: string; snippet: string;
  age_days: number; overdue: 'remind' | 'surface' | null;
};
type Msg = { id: string; direction: string; body: string; author_name: string | null; created_at: string };
type Detail = {
  thread: {
    id: string; mailbox_id: string; kind: string; subject: string; sender_name: string | null;
    sender_phone: string | null; status: string; status_label: string; assigned_to: string | null;
    assigned_name: string | null; from_centre_name: string | null; mailbox_centre_name: string | null;
    contact_id: string | null; linked_label: string | null; linked_href: string | null;
    age_days: number; overdue: string | null; crisis_flag: boolean; broke_glass?: boolean;
  };
  messages: Msg[];
  mailbox_owners: Owner[];
  can_act: boolean;
};
type Crisis = { id: string; mailbox_id: string; subject: string; centre_name: string; age_days: number };
type Health = {
  board: { mailbox_id: string; centre_name: string; owners: Owner[]; new_n: number; oldest_unhandled_days: number; crisis_n: number; surfaced: { id: string; subject: string; age_days: number }[] }[];
};
type Tpl = { id: string; title: string; body: string };

const fmtTime = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
};

function StatusChip({ status }: { status: string }) {
  const meta = STATUS_META[status as ThreadStatus];
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10.5px] ${meta?.chip ?? 'pill-muted'}`}>{statusLabel(status)}</span>;
}

export default function InboxPage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [denied, setDenied] = useState(false);

  const [selKey, setSelKey] = useState<string | null>(null); // mailbox id or 'internal'
  const [breakGlassed, setBreakGlassed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'new' | 'in_progress' | 'replied' | 'archived'>('all');
  const [list, setList] = useState<ListRow[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [selThread, setSelThread] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const [crisis, setCrisis] = useState<Crisis[]>([]);
  const [crisisOpen, setCrisisOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [reply, setReply] = useState('');
  const [replyMode, setReplyMode] = useState<'outbound' | 'note'>('outbound');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 2500); };

  // ---- auth + meta load ----
  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) { router.replace('/dashboard/login'); return; }
      const meRes = await fetch('/api/dashboard/me');
      if (meRes.status === 401) { router.replace('/dashboard/login'); return; }
      const meJson = meRes.ok ? await meRes.json() : null;
      if (!active) return;
      if (meJson) setMe({ role: meJson.role, displayName: meJson.displayName, email: meJson.email, grants: meJson.grants });

      const metaRes = await fetch('/api/inbox/meta');
      if (!active) return;
      if (metaRes.status === 403) { setDenied(true); setChecking(false); return; }
      const metaJson = metaRes.ok ? ((await metaRes.json()) as Meta) : null;
      if (metaJson) {
        setMeta(metaJson);
        if (metaJson.level === 'summary') {
          const h = await fetch('/api/inbox/health');
          if (h.ok && active) setHealth((await h.json()) as Health);
        } else {
          // default selection: first owned mailbox, else first mailbox
          const first = metaJson.mailboxes.find((m) => m.owned) ?? metaJson.mailboxes[0];
          if (first) setSelKey(first.id);
          fetch('/api/inbox/templates').then((r) => (r.ok ? r.json() : { templates: [] })).then((j) => active && setTemplates(j.templates ?? []));
        }
      }
      // crisis strip (server decides eligibility; 403 → not allowed)
      const cr = await fetch('/api/inbox/crisis');
      if (cr.ok && active) { const cj = await cr.json(); setCrisis(cj.threads ?? []); }
      setChecking(false);
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mailboxById = (id: string | null) => meta?.mailboxes.find((m) => m.id === id) ?? null;

  // ---- load thread list for the current selection ----
  const loadList = useCallback(async (key: string, f: typeof filter) => {
    setListLoading(true);
    let url: string;
    if (key === 'internal') {
      url = `/api/inbox/threads?folder=internal${f !== 'all' ? `&status=${f}` : ''}`;
    } else {
      const bg = breakGlassed.has(key) ? '&breakglass=1' : '';
      url = `/api/inbox/threads?mailbox=${key}${f !== 'all' ? `&status=${f}` : ''}${bg}`;
    }
    const r = await fetch(url);
    const j = r.ok ? await r.json() : { threads: [] };
    setList(j.threads ?? []);
    setListLoading(false);
  }, [breakGlassed]);

  useEffect(() => {
    if (!selKey) return;
    loadList(selKey, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, filter]);

  // deep-link ?thread= (read from the URL directly to avoid a Suspense boundary)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('thread');
    if (t) setSelThread(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- open a thread ----
  useEffect(() => {
    if (!selThread) { setDetail(null); return; }
    let active = true;
    (async () => {
      const mb = detail?.thread.mailbox_id ?? null;
      const bg = (mb && breakGlassed.has(mb)) || (selKey && breakGlassed.has(selKey)) ? '?breakglass=1' : '';
      const r = await fetch(`/api/inbox/threads/${selThread}${bg}`);
      if (!active) return;
      if (r.status === 404) { setDetail(null); flash('无法打开（可能不在您的权限内）'); return; }
      if (r.ok) setDetail((await r.json()) as Detail);
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selThread]);

  // ---- selecting a mailbox (with break-glass confirm for admin locked ones) ----
  const selectMailbox = (m: Mailbox) => {
    if (m.locked && meta?.level === 'admin' && !breakGlassed.has(m.id)) {
      if (!window.confirm('代管查看会记入审计日志。确定打开这个共修会的信箱吗？')) return;
      setBreakGlassed((prev) => new Set(prev).add(m.id));
    }
    setSelThread(null);
    setDetail(null);
    setSelKey(m.id);
  };

  const refreshAll = async () => {
    const metaRes = await fetch('/api/inbox/meta');
    if (metaRes.ok) setMeta((await metaRes.json()) as Meta);
    if (selKey) loadList(selKey, filter);
    if (selThread) {
      const bg = selKey && breakGlassed.has(selKey) ? '?breakglass=1' : '';
      const r = await fetch(`/api/inbox/threads/${selThread}${bg}`);
      if (r.ok) setDetail((await r.json()) as Detail);
    }
  };

  // ---- actions ----
  const sendMessage = async () => {
    if (!selThread || !reply.trim()) return;
    setBusy(true);
    const bg = selKey && breakGlassed.has(selKey) ? '?breakglass=1' : '';
    const r = await fetch(`/api/inbox/threads/${selThread}/messages${bg}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: replyMode, body: reply.trim() }),
    });
    setBusy(false);
    if (r.ok) { setReply(''); flash(replyMode === 'outbound' ? '回复已发送' : '备注已记录'); refreshAll(); }
    else flash('发送失败');
  };

  const patchThread = async (payload: Record<string, unknown>, ok: string) => {
    if (!selThread) return;
    setBusy(true);
    const bg = selKey && breakGlassed.has(selKey) ? '?breakglass=1' : '';
    const r = await fetch(`/api/inbox/threads/${selThread}${bg}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    setBusy(false);
    if (r.ok) { flash(ok); refreshAll(); } else { const j = await r.json().catch(() => ({})); flash(j.error ?? '操作失败'); }
  };

  const addToOutreach = async () => {
    if (!selThread) return;
    setBusy(true);
    const bg = selKey && breakGlassed.has(selKey) ? '?breakglass=1' : '';
    const r = await fetch(`/api/inbox/threads/${selThread}/outreach${bg}`, { method: 'POST' });
    setBusy(false);
    if (r.ok) { flash('已加入渡人名单'); refreshAll(); }
    else { const j = await r.json().catch(() => ({})); flash(j.error ?? '操作失败'); if (r.status === 409) refreshAll(); }
  };

  const handleLogout = async () => { await createSupabaseBrowserClient().auth.signOut(); router.refresh(); };

  if (checking) {
    return <div className="min-h-screen bg-bg flex items-center justify-center"><p className="text-sm text-ink-muted">加载中…</p></div>;
  }
  if (denied || !meta) {
    return (
      <div className="min-h-screen bg-bg md:ml-[72px] flex flex-col">
        <TopBar moduleTitle="共修会事务 · Mail" userLabel={me?.displayName || me?.email} onLogout={handleLogout} />
        <DashboardNav role={(me?.role ?? 'volunteer') as 'admin' | 'volunteer' | 'erp_admin' | 'committee' | 'centre_head'} active="mail" grants={me?.grants} />
        <div className="flex-1 flex items-center justify-center">
          <div className="bg-surface border border-border rounded-2xl p-8 text-center max-w-sm">
            <p className="text-2xl mb-2">🪷</p>
            <p className="text-sm text-ink">您暂时没有可查看的信箱。</p>
            <p className="mt-1 text-xs text-ink-muted">如需管理某个共修会的来信，请联系管理员将您加为负责人。</p>
          </div>
        </div>
      </div>
    );
  }

  const crisisCount = crisis.length;

  return (
    <div className="h-screen flex flex-col bg-bg md:ml-[72px]">
      <TopBar moduleTitle="共修会事务 · Mail" userLabel={me?.displayName || me?.email} onLogout={handleLogout} />
      <DashboardNav role={(me?.role ?? 'volunteer') as 'admin' | 'volunteer' | 'erp_admin' | 'committee' | 'centre_head'} active="mail" grants={me?.grants} />

      {/* CRISIS STRIP */}
      {crisisCount > 0 && (
        <div className="shrink-0 border-b border-[#E5C4BF] bg-[#FCEBEA]">
          <button onClick={() => setCrisisOpen((v) => !v)} className="w-full text-left px-4 py-2 text-sm text-[#B4402E] font-medium flex items-center gap-2">
            ⚠ 危机来信 {crisisCount} — 即刻跟进 <span className="text-xs">{crisisOpen ? '▲' : '▼'}</span>
          </button>
          {crisisOpen && (
            <ul className="px-4 pb-2 space-y-1">
              {crisis.map((c) => (
                <li key={c.id}>
                  <button onClick={() => { setSelThread(c.id); }} className="text-xs text-[#B4402E] hover:underline">
                    {c.subject} · {c.centre_name} · {c.age_days} 天
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {meta.level === 'summary' ? (
        <HealthBoard health={health} escalation={meta.escalation} />
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* RAIL */}
          <aside className="w-[248px] shrink-0 border-r border-border bg-surface-soft flex flex-col min-h-0 overflow-y-auto">
            <div className="p-3 space-y-4">
              <div>
                <p className="u-label mb-1.5">度化 · 全国</p>
                <Link href="/dashboard" className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-ink hover:bg-accent/5">
                  🪷 <span>智慧问答</span>
                </Link>
              </div>
              <div>
                <p className="u-label mb-1.5">共修会事务信箱</p>
                <ul className="space-y-0.5">
                  {meta.mailboxes.map((m) => {
                    const selected = selKey === m.id;
                    return (
                      <li key={m.id}>
                        <button
                          onClick={() => selectMailbox(m)}
                          className={`w-full flex items-center justify-between gap-1 px-2.5 py-2 rounded-lg text-sm transition ${selected ? 'bg-accent/10 text-accent-deep font-medium' : 'text-ink hover:bg-accent/5'}`}
                        >
                          <span className="truncate flex items-center gap-1">
                            {m.locked && !m.owned && <span title="代管（break-glass）">🔒</span>}
                            {m.centre_name}
                          </span>
                          <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded-full ${m.counts.new_n > 0 ? 'bg-[#FCEBEA] text-[#B4402E]' : 'text-ink-faint'}`}>{m.counts.new_n}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div>
                <p className="u-label mb-1.5">其他</p>
                <button
                  onClick={() => { setSelThread(null); setDetail(null); setSelKey('internal'); }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm transition ${selKey === 'internal' ? 'bg-accent/10 text-accent-deep font-medium' : 'text-ink hover:bg-accent/5'}`}
                >
                  <span>🔁 内部往来</span>
                  {meta.internal.new_n > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[#FCEBEA] text-[#B4402E]">{meta.internal.new_n}</span>}
                </button>
              </div>
              <div className="pt-1 space-y-1">
                {meta.can_compose_internal && (
                  <button onClick={() => setComposeOpen(true)} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-accent-deep hover:bg-accent/5">＋ 写内部件</button>
                )}
                <Link href="/dashboard/settings" className="block px-2.5 py-1.5 rounded-lg text-xs text-ink-faint hover:bg-accent/5">＋ 新增信箱（设置）</Link>
              </div>
            </div>
          </aside>

          {/* LIST */}
          <section className="w-[380px] shrink-0 border-r border-border flex flex-col min-h-0 bg-surface">
            <ListHeader meta={meta} selKey={selKey} filter={filter} setFilter={setFilter} />
            {list.filter((r) => r.overdue).length > 0 && (
              <div className="shrink-0 px-4 py-2 bg-[#FCEBEA] border-b border-[#E5C4BF] text-xs text-[#B4402E]">
                有 {list.filter((r) => r.overdue).length} 封超过 {meta.escalation.remind_centre_days} 天未处理
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              {listLoading ? (
                <p className="p-4 text-sm text-ink-muted">加载中…</p>
              ) : list.length === 0 ? (
                <p className="p-4 text-sm text-ink-faint">暂无来信 🙏</p>
              ) : (
                <ul>
                  {list.map((t) => (
                    <li key={t.id}>
                      <button
                        onClick={() => setSelThread(t.id)}
                        className={`w-full text-left px-4 py-3 border-b border-border hover:bg-accent/5 ${selThread === t.id ? 'bg-accent/10' : ''} ${t.overdue ? 'border-l-2 border-l-[#B4402E]' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm truncate ${t.status === 'new' ? 'font-semibold text-ink' : 'text-ink-body'}`}>
                            {t.kind === 'internal' ? (t.from_centre_name ?? '内部') : (t.sender_name ?? '匿名')}
                          </span>
                          <span className="shrink-0 text-[10.5px] text-ink-faint">{fmtTime(t.last_message_at)}</span>
                        </div>
                        <p className={`text-sm truncate ${t.status === 'new' ? 'text-ink' : 'text-ink-muted'}`}>{t.subject}</p>
                        <p className="text-[11.5px] text-ink-faint truncate">{t.snippet}</p>
                        <div className="mt-1 flex items-center gap-1 flex-wrap">
                          <StatusChip status={t.status} />
                          <span className="pill-muted inline-block px-2 py-0.5 rounded-full text-[10px]">{kindLabel(t.kind)}</span>
                          {t.crisis_flag && <span className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-[#FCEBEA] text-[#B4402E]">危机</span>}
                          {t.linked_label && <span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[10px]">{t.linked_label}</span>}
                          {t.overdue && <span className="text-[10px] text-[#B4402E]">{t.age_days} 天未处理</span>}
                          {t.assigned_name && <span className="text-[10px] text-ink-faint">· {t.assigned_name}</span>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* READING PANE */}
          <section className="flex-1 min-w-0 flex flex-col min-h-0 bg-bg">
            {!detail ? (
              <div className="flex-1 flex items-center justify-center text-sm text-ink-faint">选择一封来信查看</div>
            ) : (
              <ReadingPane
                detail={detail}
                mailboxes={meta.mailboxes}
                templates={templates}
                reply={reply} setReply={setReply}
                replyMode={replyMode} setReplyMode={setReplyMode}
                busy={busy}
                onSend={sendMessage}
                onPatch={patchThread}
                onOutreach={addToOutreach}
              />
            )}
          </section>
        </div>
      )}

      {composeOpen && meta && (
        <ComposeInternal mailboxes={meta.mailboxes} onClose={() => setComposeOpen(false)} onSent={() => { setComposeOpen(false); flash('内部件已发送'); refreshAll(); }} />
      )}
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-full bg-ink text-white text-sm shadow-lg">{toast}</div>}
    </div>
  );
}

function ListHeader({ meta, selKey, filter, setFilter }: { meta: Meta; selKey: string | null; filter: string; setFilter: (f: 'all' | 'new' | 'in_progress' | 'replied' | 'archived') => void }) {
  const mb = meta.mailboxes.find((m) => m.id === selKey);
  const title = selKey === 'internal' ? '内部往来' : mb?.centre_name ?? '收件箱';
  const owners = mb?.owners.map((o) => o.name).join('、');
  const chips: { k: 'all' | 'new' | 'in_progress' | 'replied' | 'archived'; label: string }[] = [
    { k: 'all', label: '全部' }, { k: 'new', label: '未处理' }, { k: 'in_progress', label: '处理中' }, { k: 'replied', label: '已回复' }, { k: 'archived', label: '归档' },
  ];
  return (
    <div className="shrink-0 border-b border-border p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink truncate">{title}</h2>
      </div>
      {owners && <p className="text-[11px] text-ink-faint truncate">负责人：{owners}</p>}
      <div className="flex gap-1 flex-wrap">
        {chips.map((c) => (
          <button key={c.k} onClick={() => setFilter(c.k)} className={`px-2.5 py-1 text-xs rounded-full border ${filter === c.k ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border-strong'}`}>{c.label}</button>
        ))}
      </div>
    </div>
  );
}

function ReadingPane({
  detail, mailboxes, templates, reply, setReply, replyMode, setReplyMode, busy, onSend, onPatch, onOutreach,
}: {
  detail: Detail; mailboxes: Mailbox[]; templates: Tpl[];
  reply: string; setReply: (s: string) => void; replyMode: 'outbound' | 'note'; setReplyMode: (m: 'outbound' | 'note') => void;
  busy: boolean; onSend: () => void; onPatch: (p: Record<string, unknown>, ok: string) => void; onOutreach: () => void;
}) {
  const t = detail.thread;
  const [transferTo, setTransferTo] = useState('');
  return (
    <>
      <div className="shrink-0 border-b border-border p-4 bg-surface">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-semibold text-ink">{t.subject}</h2>
          <StatusChip status={t.status} />
          {t.crisis_flag && <span className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-[#FCEBEA] text-[#B4402E]">危机</span>}
          {t.broke_glass && <span className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-[#FEF2F2] text-[#B4402E]">代管查看</span>}
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          {t.kind === 'internal' ? `来自 ${t.from_centre_name ?? '内部'}` : `${t.sender_name ?? '匿名'}${t.sender_phone ? ` · ${t.sender_phone}` : ''}`} · {kindLabel(t.kind)} · {t.mailbox_centre_name} · {t.age_days} 天
          {t.linked_href && t.linked_label && (
            <> · <Link href={t.linked_href} className="pill-gold inline-block px-2 py-0.5 rounded-full text-[10px]">打开{t.linked_label}</Link></>
          )}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {detail.messages.map((m) => {
          if (m.direction === 'note') {
            return (
              <div key={m.id} className="max-w-[80%] mx-auto bg-[#E7F0E0]/60 border border-[#CFE3C0] rounded-xl px-3 py-2">
                <p className="text-[10px] text-[#3F6B2E] mb-0.5">内部备注 · {m.author_name ?? '义工'}</p>
                <p className="text-sm text-ink whitespace-pre-wrap">{m.body}</p>
              </div>
            );
          }
          const outbound = m.direction === 'outbound';
          return (
            <div key={m.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${outbound ? 'bg-[#E7F0E0] text-ink' : 'bg-surface border border-border text-ink'}`}>
                {outbound && <p className="text-[10px] text-[#3F6B2E] mb-0.5">{m.author_name ?? 'me'}</p>}
                <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                <p className="text-[10px] text-ink-faint mt-1">{fmtTime(m.created_at)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {detail.can_act && (
        <div className="shrink-0 border-t border-border p-3 bg-surface space-y-2">
          {/* outreach suggestion */}
          {t.kind === 'form' && (
            t.contact_id ? (
              <Link href={`/dashboard/outreach?open=${t.contact_id}`} className="inline-block text-xs text-accent-deep hover:underline">查看渡人卡 →</Link>
            ) : (
              <div className="flex items-center gap-2">
                <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#E7F0E0] text-[#3F6B2E]">💡 回复后可加入渡人名单（来源：表单）</span>
                <button disabled={busy} onClick={onOutreach} className="btn-secondary px-3 py-1 text-xs">加入渡人名单</button>
              </div>
            )
          )}

          <div className="flex items-center gap-2">
            <select
              value=""
              onChange={(e) => { const tpl = templates.find((x) => x.id === e.target.value); if (tpl) setReply(tpl.body); }}
              className="text-xs px-2 py-1.5 border border-border-strong rounded-lg bg-surface text-ink"
            >
              <option value="">模板…</option>
              {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.title}</option>)}
            </select>
            <select value={replyMode} onChange={(e) => setReplyMode(e.target.value as 'outbound' | 'note')} className="text-xs px-2 py-1.5 border border-border-strong rounded-lg bg-surface text-ink">
              <option value="outbound">发送回复</option>
              <option value="note">记内部备注</option>
            </select>
            {/* assign */}
            <select
              value={t.assigned_to ?? ''}
              onChange={(e) => onPatch({ assigned_to: e.target.value || null }, '已更新负责人')}
              className="text-xs px-2 py-1.5 border border-border-strong rounded-lg bg-surface text-ink"
            >
              <option value="">指派负责人…</option>
              {detail.mailbox_owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <span className="ml-auto text-[10px] text-ink-faint">🔒 每一步都记入审计日志</span>
          </div>

          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder={replyMode === 'outbound' ? '写回复…（保存在系统内）' : '写内部备注…'}
            className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface-soft text-ink focus:outline-none focus:border-accent"
          />
          <p className="text-[10px] text-ink-faint">回复保存在系统内；如需通知来信人，请按电话联系（E2b 才有邮件代发）。</p>

          <div className="flex items-center gap-2 flex-wrap">
            <button disabled={busy || !reply.trim()} onClick={onSend} className="btn-primary px-4 py-1.5 text-sm disabled:opacity-40">{replyMode === 'outbound' ? '发送回复' : '记内部备注'}</button>
            <button disabled={busy} onClick={() => onPatch({ status: 'replied' }, '已标记已回复')} className="btn-secondary px-3 py-1.5 text-xs">标记已回复</button>
            <button disabled={busy} onClick={() => onPatch({ status: 'archived' }, '已归档')} className="btn-secondary px-3 py-1.5 text-xs">归档</button>
            <div className="flex items-center gap-1">
              <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className="text-xs px-2 py-1.5 border border-border-strong rounded-lg bg-surface text-ink">
                <option value="">转给其他信箱…</option>
                {mailboxes.filter((m) => m.id !== t.mailbox_id).map((m) => <option key={m.id} value={m.id}>{m.centre_name}</option>)}
              </select>
              {transferTo && <button disabled={busy} onClick={() => { onPatch({ mailbox_id: transferTo }, '已转办'); setTransferTo(''); }} className="btn-secondary px-2 py-1.5 text-xs">转</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function HealthBoard({ health, escalation }: { health: Health | null; escalation: { remind_centre_days: number; surface_hq_days: number } }) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-[1200px] mx-auto">
        <div className="mb-4">
          <h2 className="text-xl font-bold font-serif text-ink">共修会事务 · 健康总览</h2>
          <p className="text-sm text-ink-faint">只看数量与最旧天数，不看来信内容 · 超过 {escalation.surface_hq_days} 天的会显示主题</p>
        </div>
        {!health ? (
          <p className="text-sm text-ink-muted">加载中…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {health.board.map((b) => (
              <div key={b.mailbox_id} className="bg-surface border border-border rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-ink">{b.centre_name}</h3>
                  {b.crisis_n > 0 && <span className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-[#FCEBEA] text-[#B4402E]">危机 {b.crisis_n}</span>}
                </div>
                <p className="text-[11px] mt-0.5">{b.owners.length ? `负责人：${b.owners.map((o) => o.name).join('、')}` : <span className="text-[#B4402E]">未指派</span>}</p>
                <div className="mt-3 flex items-end gap-4">
                  <div><div className="text-2xl font-bold text-ink">{b.new_n}</div><div className="text-[10px] text-ink-faint">未处理</div></div>
                  <div><div className="text-2xl font-bold text-ink">{b.oldest_unhandled_days}</div><div className="text-[10px] text-ink-faint">最旧（天）</div></div>
                </div>
                {b.surfaced.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-border">
                    <p className="text-[10px] text-[#B4402E] mb-1">超过 {escalation.surface_hq_days} 天：</p>
                    <ul className="space-y-0.5">
                      {b.surfaced.map((s) => <li key={s.id} className="text-[11px] text-ink-muted truncate">· {s.subject} — {s.age_days} 天</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ComposeInternal({ mailboxes, onClose, onSent }: { mailboxes: Mailbox[]; onClose: () => void; onSent: () => void }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!to || !subject.trim() || !body.trim()) { setErr('请填写收件信箱、主题与内容'); return; }
    setBusy(true);
    const r = await fetch('/api/inbox/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to_mailbox_id: to, subject: subject.trim(), body: body.trim() }) });
    setBusy(false);
    if (r.ok) onSent(); else { const j = await r.json().catch(() => ({})); setErr(j.error ?? '发送失败'); }
  };
  return (
    <div className="fixed inset-0 z-[80] bg-ink/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-ink mb-3">写内部件</h3>
        {err && <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2 mb-2">{err}</p>}
        <label className="block text-xs text-label mb-1">收件信箱</label>
        <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink mb-3">
          <option value="">选择共修会信箱…</option>
          {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.centre_name}</option>)}
        </select>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="主题" className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink mb-3" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="内容" className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface-soft text-ink mb-3" />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
          <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? '发送中…' : '发送'}</button>
        </div>
      </div>
    </div>
  );
}
