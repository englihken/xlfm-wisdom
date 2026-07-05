// src/app/dashboard/home/page.tsx
// The platform hub — a "My Day" (今日概览页), NOT a module launcher (the rail is the
// launcher now, so there is deliberately no grid of module tiles). Renders ONLY for
// multi-door accounts; single-door accounts are bounced into their module. View-only
// glue — no mutations. Every block is strictly grant-gated: a block appears only when
// its data is present in the response, which the server returns only for held grants
// (an absent grant means the block is never rendered — never greyed).

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { PasswordChangeGate } from '@/components/password-change-gate';
import { DashboardNav } from '@/components/dashboard-nav';
import { visibleModules, grantAllows, type Grants } from '@/lib/access';
import { PLATFORM_NAME } from '@/lib/platform';

type Me = {
  email: string;
  displayName: string | null;
  role: 'admin' | 'volunteer' | 'erp_admin' | 'committee';
  grants: Grants;
};
type HomeData = {
  stats: { care?: { unread: number; myAssignedUnread: number }; members?: { activeCount: number } };
  myConversations?: { id: string; contactName: string; preview: string; lastMessageAt: string; unread: boolean }[];
  recentMembers?: { id: string; name: string; centreCode: string | null; updatedAt: string }[];
  recentAudit?: { id: number; line: string; at: string }[];
};

function todayMYT(): string {
  return new Date().toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}
function relTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前`;
  return new Date(iso).toLocaleDateString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', month: '2-digit', day: '2-digit' });
}

export default function HubPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [gate, setGate] = useState<'checking' | 'ok'>('checking');
  const [data, setData] = useState<HomeData | null>(null);

  const forceSignOut = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
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
        const grants: Grants = json.grants ?? {};
        const mods = visibleModules({ role: json.role, grants });
        // The hub never renders for single-door accounts — bounce into the module.
        if (mods.length <= 1) {
          router.replace(mods[0] === 'members' ? '/dashboard/members' : '/dashboard');
          return;
        }
        setMe({ email: json.email, displayName: json.displayName ?? null, role: json.role, grants });
        if (json.mustChangePassword) setMustChangePassword(true);
        setGate('ok');
      } catch {
        /* neutral loader covers a failure */
      }
    })();
    return () => {
      active = false;
    };
  }, [checking, router, forceSignOut]);

  useEffect(() => {
    if (gate !== 'ok') return;
    let active = true;
    fetch('/api/dashboard/home/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) setData(j as HomeData);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [gate]);

  const handleLogout = async () => {
    await forceSignOut();
    router.refresh();
  };

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
  if (!me) return null;

  const care = data?.stats.care;
  const members = data?.stats.members;

  return (
    <div className="min-h-screen flex flex-col bg-[#FFF3DA] md:ml-[72px]">
      {/* TOP BAR — platform brand only (hub has no module title) */}
      <header className="shrink-0 border-b border-[#EFE3BF] bg-white/60 backdrop-blur-sm">
        <div className="px-5 py-3 flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-[#583A0F]">🪷 {PLATFORM_NAME}</h1>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-sm text-[#8B6F47]">{me.displayName || me.email}</span>
            <button
              onClick={handleLogout}
              className="px-4 py-1.5 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      <DashboardNav role={me.role} active="home" grants={me.grants} />

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
          {/* 1. greeting */}
          <div>
            <h2 className="text-2xl font-bold text-[#583A0F]">吉祥，{me.displayName || '师兄'} 🙏</h2>
            <p className="mt-1 text-sm text-[#8B6F47]">{todayMYT()}</p>
          </div>

          {/* 2. 今日概览 stat strip */}
          {(care || members) && (
            <div>
              <p className="text-xs font-medium text-[#B89968] mb-2">今日概览</p>
              <div className="flex flex-wrap gap-3">
                {care && <Stat label="未读对话" value={care.unread} />}
                {care && <Stat label="我接手的未读" value={care.myAssignedUnread} accent />}
                {members && <Stat label="会员总数" value={members.activeCount} />}
              </div>
            </div>
          )}

          {/* 3. 我的事项 (care ≥ view) */}
          {data?.myConversations !== undefined && (
            <Card title="我的事项" en="My conversations">
              {data.myConversations.length === 0 ? (
                <p className="text-sm text-[#8B6F47]">今日无待办 🙏</p>
              ) : (
                <ul className="divide-y divide-[#EFE3BF]">
                  {data.myConversations.map((c) => (
                    <li key={c.id}>
                      <Link href="/dashboard" className="block py-2.5 hover:bg-[#FAEFD0]/40 -mx-2 px-2 rounded-lg transition">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {c.unread && <span className="shrink-0 w-2 h-2 rounded-full bg-[#D89938]" aria-label="未读" />}
                            <span className={`truncate text-[#583A0F] ${c.unread ? 'font-semibold' : 'font-medium'}`}>{c.contactName}</span>
                          </div>
                          <span className="shrink-0 text-xs text-[#B89968]">{relTime(c.lastMessageAt)}</span>
                        </div>
                        <p className="mt-0.5 text-sm text-[#8B6F47] line-clamp-1">{c.preview || '（无消息）'}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {/* 4. 最近会员动态 (members ≥ view) */}
          {data?.recentMembers !== undefined && (
            <Card title="最近会员动态" en="Recent members">
              {data.recentMembers.length === 0 ? (
                <p className="text-sm text-[#8B6F47]">暂无会员</p>
              ) : (
                <ul className="divide-y divide-[#EFE3BF]">
                  {data.recentMembers.map((m) => (
                    <li key={m.id}>
                      <Link href={`/dashboard/members/${m.id}`} className="flex items-center justify-between gap-2 py-2.5 hover:bg-[#FAEFD0]/40 -mx-2 px-2 rounded-lg transition">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-[#583A0F] truncate">{m.name}</span>
                          {m.centreCode && (
                            <span className="shrink-0 inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#FAEFD0] text-[#8A5A1E]">{m.centreCode}</span>
                          )}
                        </div>
                        <span className="shrink-0 text-xs text-[#B89968]">{relTime(m.updatedAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {/* 5. 系统动态 (audit ≥ view — admin only today) */}
          {data?.recentAudit !== undefined && (
            <Card title="系统动态" en="Activity">
              {data.recentAudit.length === 0 ? (
                <p className="text-sm text-[#8B6F47]">暂无记录</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.recentAudit.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-[#583A0F] truncate">{a.line}</span>
                      <span className="shrink-0 text-xs text-[#B89968]">{relTime(a.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {/* 6. 快捷操作 — grant-gated buttons only */}
          <div className="flex flex-wrap gap-2">
            {grantAllows(me.grants, 'care', 'view') && (
              <QuickLink href="/dashboard" label="去收件箱" />
            )}
            {grantAllows(me.grants, 'members', 'view') && (
              <QuickLink href="/dashboard/members" label="会员列表" />
            )}
            {grantAllows(me.grants, 'members', 'edit') && (
              <QuickLink href="/dashboard/members/new" label="＋新增会员" primary />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-xl px-4 py-3 min-w-[120px]">
      <div className={`text-2xl font-bold ${accent ? 'text-[#A87929]' : 'text-[#583A0F]'}`}>{value}</div>
      <div className="text-xs text-[#8B6F47]">{label}</div>
    </div>
  );
}
function Card({ title, en, children }: { title: string; en: string; children: React.ReactNode }) {
  return (
    <section className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl p-5">
      <h3 className="text-base font-semibold text-[#583A0F] mb-3">
        {title} <span className="text-xs font-normal text-[#B89968]">{en}</span>
      </h3>
      {children}
    </section>
  );
}
function QuickLink({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`px-4 py-2 text-sm rounded-full transition ${
        primary
          ? 'text-white bg-[#D89938] hover:bg-[#A87929]'
          : 'text-[#583A0F] border border-[#EFE3BF] hover:bg-[#FAEFD0]'
      }`}
    >
      {label}
    </Link>
  );
}
