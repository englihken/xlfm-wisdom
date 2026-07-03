// src/app/dashboard/settings/page.tsx
// 设置 — admin-only settings, organised into sections (义工管理 today; retention,
// crisis resources, categories, WhatsApp config to come). Same client-side auth
// gate as the inbox: redirect to login without a session. Admin-ness is enforced
// SERVER-SIDE on every /api/dashboard/volunteers route; this page only *reveals*
// the tools (via /me role) — a non-admin who reaches here sees a polite notice,
// and the API would 403 them anyway.

'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

type Role = 'admin' | 'volunteer';

type Me = { email: string; displayName: string | null; role: Role };

type Volunteer = {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  active: boolean;
  created_at: string;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

// Settings sections. Data-driven so future sections (retention, crisis resources,
// categories, WhatsApp config…) are a one-line addition here + a matching block in
// the content area. Only 义工管理 exists today.
const SECTIONS = [{ id: 'volunteers', label: '义工管理' }] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

export default function SettingsPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('volunteers');
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Add-volunteer form.
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<Role>('volunteer');
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);

  // Clear the session and return to login (登出 button + expired/invalid session).
  const forceSignOut = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace('/dashboard/login');
  }, [router]);

  // Auth gate — mirrors the inbox. setState only in the async callback.
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

  const reloadVolunteers = useCallback(async () => {
    const res = await fetch('/api/dashboard/volunteers');
    if (res.ok) {
      const json = await res.json();
      setVolunteers(json.volunteers ?? []);
    }
  }, []);

  // Once past the gate, load our profile and (if admin) the team. All setState is
  // inside the async IIFE, never synchronous in the effect body.
  useEffect(() => {
    if (checking) return;
    let active = true;
    (async () => {
      try {
        const meRes = await fetch('/api/dashboard/me');
        if (!active) return;
        if (meRes.status === 401) {
          router.replace('/dashboard/login');
          return;
        }
        if (meRes.status === 403) {
          await forceSignOut();
          return;
        }
        if (!meRes.ok) return;
        const meJson = await meRes.json();
        if (!active) return;
        setMe({
          email: meJson.email,
          displayName: meJson.displayName ?? null,
          role: meJson.role,
        });
        if (meJson.role !== 'admin') return;
        await reloadVolunteers();
      } catch {
        /* leave the list empty; the notice/loading state covers it */
      } finally {
        if (active) setListLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [checking, router, forceSignOut, reloadVolunteers]);

  const patchVolunteer = async (id: string, payload: Record<string, unknown>) => {
    setActingId(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/dashboard/volunteers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        router.replace('/dashboard/login');
        return;
      }
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setActionError(json?.error ?? '操作失败，请重试');
        return;
      }
      await reloadVolunteers();
    } catch {
      setActionError('操作失败，请重试');
    } finally {
      setActingId(null);
    }
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setAddError(null);
    setAddSuccess(false);
    try {
      const res = await fetch('/api/dashboard/volunteers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formEmail,
          password: formPassword,
          displayName: formName,
          role: formRole,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setAddError(json?.error ?? '添加失败，请重试');
        return;
      }
      setFormName('');
      setFormEmail('');
      setFormPassword('');
      setFormRole('volunteer');
      setAddSuccess(true);
      await reloadVolunteers();
      setTimeout(() => setAddSuccess(false), 2000);
    } catch {
      setAddError('添加失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-[#FFF3DA] flex items-center justify-center">
        <p className="text-sm text-[#8B6F47]">加载中…</p>
      </div>
    );
  }

  // Logged in but not an admin — polite notice, not a blank screen.
  if (me && me.role !== 'admin') {
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
    <div className="min-h-screen flex flex-col bg-[#FFF3DA]">
      {/* TOP BAR */}
      <header className="shrink-0 border-b border-[#EFE3BF] bg-white/60 backdrop-blur-sm">
        <div className="px-5 py-3 flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-[#583A0F]">
            心灵法门人文关怀系统 <span className="text-[#B89968] font-normal">· 设置</span>
          </h1>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-sm text-[#8B6F47]">
              {me?.displayName || me?.email}
            </span>
            <Link
              href="/dashboard"
              className="px-4 py-1.5 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition"
            >
              返回收件箱
            </Link>
            <button
              onClick={forceSignOut}
              className="px-4 py-1.5 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      {/* SECTION NAV + CONTENT — vertical sidebar on desktop, horizontal tab row
          on mobile (the same <ul> switches direction via md: breakpoints). */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <nav className="shrink-0 md:w-[220px] border-b md:border-b-0 md:border-r border-[#EFE3BF] bg-[#FFFEF6] p-3 md:p-4">
          <ul className="flex flex-wrap md:flex-col gap-1">
            {SECTIONS.map((s) => {
              const selected = s.id === activeSection;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => setActiveSection(s.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                      selected
                        ? 'bg-[#FAEFD0] text-[#583A0F] font-medium'
                        : 'text-[#8B6F47] hover:bg-[#FAEFD0]/60'
                    }`}
                  >
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="flex-1 min-w-0 overflow-y-auto">
          {activeSection === 'volunteers' && (
            <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
              {/* ADD VOLUNTEER */}
              <section className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl p-5 sm:p-6">
                <h2 className="text-base font-semibold text-[#583A0F]">添加义工</h2>
                <p className="mt-1 text-sm text-[#8B6F47]">
                  新账号创建后即可使用邮箱和密码登录。
                </p>
                {/* autoComplete=off (+ non-suggestive field names & new-password on
                    the password) so Chrome doesn't autofill the admin's own
                    credentials into a form that creates *another* account. */}
                <form onSubmit={handleAdd} autoComplete="off" className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="name" className="block text-xs font-medium text-[#B89968] mb-1">
                      显示名称
                    </label>
                    <input
                      id="name"
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      disabled={submitting}
                      placeholder="如：李师兄"
                      className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] placeholder:text-[#B89968] focus:outline-none focus:border-[#D89938] disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label htmlFor="add-email" className="block text-xs font-medium text-[#B89968] mb-1">
                      邮箱
                    </label>
                    <input
                      id="add-email"
                      name="new-volunteer-email"
                      type="email"
                      required
                      autoComplete="off"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      disabled={submitting}
                      placeholder="you@example.com"
                      className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] placeholder:text-[#B89968] focus:outline-none focus:border-[#D89938] disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label htmlFor="add-password" className="block text-xs font-medium text-[#B89968] mb-1">
                      初始密码
                    </label>
                    <input
                      id="add-password"
                      name="new-volunteer-password"
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      disabled={submitting}
                      placeholder="至少 8 位"
                      className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] placeholder:text-[#B89968] focus:outline-none focus:border-[#D89938] disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label htmlFor="add-role" className="block text-xs font-medium text-[#B89968] mb-1">
                      角色
                    </label>
                    <select
                      id="add-role"
                      value={formRole}
                      onChange={(e) => setFormRole(e.target.value as Role)}
                      disabled={submitting}
                      className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] focus:outline-none focus:border-[#D89938] disabled:opacity-50"
                    >
                      <option value="volunteer">义工</option>
                      <option value="admin">管理员</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2 flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={submitting || !formEmail.trim() || formPassword.length < 8}
                      className="px-5 py-2 text-sm text-white bg-[#D89938] rounded-full hover:bg-[#A87929] transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {submitting ? '添加中…' : '添加'}
                    </button>
                    {addSuccess && <span className="text-sm text-[#A87929]">已添加 ✓</span>}
                    {addError && <span className="text-sm text-red-600">{addError}</span>}
                  </div>
                </form>
              </section>

              {/* VOLUNTEER LIST */}
              <section className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-[#EFE3BF] flex items-center justify-between">
                  <h2 className="text-base font-semibold text-[#583A0F]">义工团队</h2>
                  <span className="text-xs text-[#B89968]">{volunteers.length} 人</span>
                </div>

                {actionError && (
                  <div className="px-5 py-3 bg-[#FEF2F2] text-sm text-red-700 border-b border-[#EFE3BF]">
                    {actionError}
                  </div>
                )}

                {listLoading ? (
                  <p className="p-6 text-sm text-[#8B6F47]">加载中…</p>
                ) : volunteers.length === 0 ? (
                  <p className="p-6 text-sm text-[#8B6F47]">暂无义工</p>
                ) : (
                  <ul>
                    {volunteers.map((v) => {
                      const isSelf = me?.email === v.email;
                      const busy = actingId === v.id;
                      return (
                        <li
                          key={v.id}
                          className="px-5 py-4 border-b border-[#EFE3BF] last:border-b-0 flex flex-wrap items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-[#583A0F] truncate">
                              {v.display_name || v.email}
                              {isSelf && <span className="ml-1 text-xs text-[#B89968]">（你）</span>}
                            </p>
                            <p className="text-xs text-[#8B6F47] truncate">{v.email}</p>
                            <p className="mt-0.5 text-xs text-[#B89968]">加入于 {formatDate(v.created_at)}</p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <RoleBadge role={v.role} />
                            <StatusBadge active={v.active} />

                            <button
                              onClick={() =>
                                patchVolunteer(v.id, {
                                  role: v.role === 'admin' ? 'volunteer' : 'admin',
                                })
                              }
                              disabled={isSelf || busy}
                              className="px-3 py-1 text-xs text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {v.role === 'admin' ? '设为义工' : '设为管理员'}
                            </button>

                            <button
                              onClick={() => patchVolunteer(v.id, { active: !v.active })}
                              disabled={isSelf || busy}
                              className={`px-3 py-1 text-xs rounded-full border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                                v.active
                                  ? 'text-red-700 border-[#FCA5A5] hover:bg-[#FEF2F2]'
                                  : 'text-[#A87929] border-[#EFE3BF] hover:bg-[#FAEFD0]'
                              }`}
                            >
                              {v.active ? '停用' : '启用'}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return role === 'admin' ? (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#FAEFD0] text-[#A87929]">
      管理员
    </span>
  ) : (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-white border border-[#EFE3BF] text-[#8B6F47]">
      义工
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#FAEFD0] text-[#8B6F47]">
      启用
    </span>
  ) : (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#FEF2F2] text-red-700">
      已停用
    </span>
  );
}
