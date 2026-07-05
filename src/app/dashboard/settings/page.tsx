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
import { PasswordChangeGate } from '@/components/password-change-gate';
import { DashboardNav } from '@/components/dashboard-nav';
import type { Grants } from '@/lib/access';
import { PLATFORM_NAME } from '@/lib/platform';
import { XLFM_CENTERS, isValidCenter } from '@/lib/xlfm-centers';

type Role = 'admin' | 'volunteer' | 'erp_admin' | 'committee';

type Me = { email: string; displayName: string | null; role: Role; mustChangePassword?: boolean; grants?: Grants };

type Volunteer = {
  id: string;
  email: string;
  display_name: string | null;
  center: string | null;
  centre_id: string | null;
  occupation: string | null;
  skills: string | null;
  role: Role;
  scope: 'all_centers' | 'own_center' | null;
  active: boolean;
  created_at: string;
};

type MetaCentre = { id: string; code: string; name_cn: string; name_en: string };

// Role display labels (bilingual-ish, care + ERP wings).
const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  volunteer: '关怀义工',
  erp_admin: 'ERP 管理员',
  committee: '理事会',
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
  const [mustChangePassword, setMustChangePassword] = useState(false);
  // Access gate driven by /me AFTER the session check. Until it resolves we show
  // ONLY a neutral loader — never the privileged chrome (title / rail / controls).
  const [gate, setGate] = useState<'checking' | 'denied' | 'ok'>('checking');
  const [activeSection, setActiveSection] = useState<SectionId>('volunteers');
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // List view: which rows to show, which row is being edited, which just saved.
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  // Structured centres (for the 关怀义工 中心 select), from /api/dashboard/erp/meta.
  const [metaCentres, setMetaCentres] = useState<MetaCentre[]>([]);

  // Add-volunteer form.
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formCenter, setFormCenter] = useState('');
  const [formCentreId, setFormCentreId] = useState('');
  const [formOccupation, setFormOccupation] = useState('');
  const [formSkills, setFormSkills] = useState('');
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

  // Structured centres for the 关怀义工 中心 select (admin holds members:view).
  useEffect(() => {
    if (gate !== 'ok') return;
    let active = true;
    fetch('/api/dashboard/erp/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) setMetaCentres(j.centres ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [gate]);

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
          grants: meJson.grants ?? {},
        });
        // Fail open: only gate when the flag is explicitly true.
        if (meJson.mustChangePassword) setMustChangePassword(true);
        if (meJson.role !== 'admin') {
          setGate('denied');
          return;
        }
        // Confirmed admin — reveal the page, THEN load the team (never in parallel
        // with the role check).
        setGate('ok');
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
          // Centre fields only apply to 关怀义工; scope is derived server-side.
          center: formRole === 'volunteer' ? formCenter : '',
          centre_id: formRole === 'volunteer' ? formCentreId : null,
          occupation: formOccupation,
          skills: formSkills,
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
      setFormCenter('');
      setFormCentreId('');
      setFormOccupation('');
      setFormSkills('');
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

  // Save an inline row edit (display name / email / center). Returns an error
  // message to show in the row, or null on success (parent closes the editor and
  // flashes 已保存 ✓). The PATCH response already carries the fresh row, so we
  // splice it into state rather than refetching the whole list.
  const saveEdit = async (
    id: string,
    payload: { displayName: string; email: string; center: string; occupation: string; skills: string }
  ): Promise<string | null> => {
    try {
      const res = await fetch(`/api/dashboard/volunteers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        router.replace('/dashboard/login');
        return null;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        return json?.error ?? '保存失败，请重试';
      }
      setVolunteers((prev) => prev.map((v) => (v.id === id ? json.volunteer : v)));
      setEditingId(null);
      setSavedId(id);
      setTimeout(() => setSavedId((s) => (s === id ? null : s)), 2000);
      return null;
    } catch {
      return '保存失败，请重试';
    }
  };

  const visibleVolunteers = filter === 'active' ? volunteers.filter((v) => v.active) : volunteers;

  // Neutral loader while EITHER the session check or the role check is in flight.
  // Nothing here reveals what the page is (no title, rail, top bar, or controls).
  if (checking || gate === 'checking') {
    return (
      <div className="min-h-screen bg-[#FFF3DA] flex items-center justify-center">
        <p className="text-sm text-[#8B6F47]">加载中…</p>
      </div>
    );
  }

  // First-login: force a password change before anything else (applies to admins
  // and volunteers alike). On success the gate clears; same session continues.
  if (mustChangePassword) {
    return <PasswordChangeGate onDone={() => setMustChangePassword(false)} />;
  }

  // Logged in but not an admin — polite notice, not a blank screen.
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
          <div>
            <p className="text-[11px] leading-none text-[#B89968]">🪷 {PLATFORM_NAME}</p>
            <h1 className="mt-0.5 text-lg font-bold text-[#583A0F] leading-tight">
              设置 <span className="text-sm font-normal text-[#B89968]">· Settings</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-sm text-[#8B6F47]">
              {me?.displayName || me?.email}
            </span>
            <button
              onClick={forceSignOut}
              className="px-4 py-1.5 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      <DashboardNav role={me?.role ?? 'volunteer'} active="settings" grants={me?.grants} />

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
                  {/* Centre fields apply only to 关怀义工 (own_center scope); hidden for
                      ERP/committee roles (all_centers). */}
                  {formRole === 'volunteer' && (
                    <>
                      <div>
                        <label htmlFor="add-center" className="block text-xs font-medium text-[#B89968] mb-1">
                          所属中心 · 文本（可选）
                        </label>
                        <CenterSelect
                          id="add-center"
                          value={formCenter}
                          onChange={setFormCenter}
                          disabled={submitting}
                        />
                      </div>
                      <div>
                        <label htmlFor="add-centre-id" className="block text-xs font-medium text-[#B89968] mb-1">
                          中心 · 结构化（可选）
                        </label>
                        <select
                          id="add-centre-id"
                          value={formCentreId}
                          onChange={(e) => setFormCentreId(e.target.value)}
                          disabled={submitting}
                          className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] focus:outline-none focus:border-[#D89938] disabled:opacity-50"
                        >
                          <option value="">未指定</option>
                          {metaCentres.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name_cn} {c.code}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                  <div>
                    <label htmlFor="add-occupation" className="block text-xs font-medium text-[#B89968] mb-1">
                      职业（可选）
                    </label>
                    <input
                      id="add-occupation"
                      type="text"
                      value={formOccupation}
                      onChange={(e) => setFormOccupation(e.target.value)}
                      disabled={submitting}
                      placeholder="如：教师"
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
                      <option value="volunteer">关怀义工</option>
                      <option value="admin">管理员</option>
                      <option value="erp_admin">ERP 管理员</option>
                      <option value="committee">理事会</option>
                    </select>
                    {formRole === 'erp_admin' && (
                      <p className="mt-1 text-xs text-[#8B6F47]">
                        ERP 管理员：可管理会员/活动/财务等模块，无法读取关怀对话。
                      </p>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="add-skills" className="block text-xs font-medium text-[#B89968] mb-1">
                      专长／技能（可选）
                    </label>
                    <textarea
                      id="add-skills"
                      value={formSkills}
                      onChange={(e) => setFormSkills(e.target.value)}
                      disabled={submitting}
                      rows={2}
                      placeholder="如：辅导、翻译、设计、医护…"
                      className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] placeholder:text-[#B89968] leading-relaxed resize-y focus:outline-none focus:border-[#D89938] disabled:opacity-50"
                    />
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

              {/* VOLUNTEER LIST.
                  There is deliberately NO delete action: a volunteer's history and
                  notes must stay attributable for safeguarding. Leaving the team is
                  modelled as 停用 (disable); the 仅启用/全部 filter below keeps
                  disabled accounts out of the everyday view but one click away. */}
              <section className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-[#EFE3BF] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-[#583A0F]">义工团队</h2>
                    <span className="text-xs text-[#B89968]">{volunteers.length} 人</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    {(['active', 'all'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-3 py-1 rounded-full border transition ${
                          filter === f
                            ? 'bg-[#FAEFD0] text-[#583A0F] border-[#EFE3BF]'
                            : 'text-[#8B6F47] border-transparent hover:bg-[#FAEFD0]/60'
                        }`}
                      >
                        {f === 'active' ? '仅启用' : '全部'}
                      </button>
                    ))}
                  </div>
                </div>

                {actionError && (
                  <div className="px-5 py-3 bg-[#FEF2F2] text-sm text-red-700 border-b border-[#EFE3BF]">
                    {actionError}
                  </div>
                )}

                {listLoading ? (
                  <p className="p-6 text-sm text-[#8B6F47]">加载中…</p>
                ) : visibleVolunteers.length === 0 ? (
                  <p className="p-6 text-sm text-[#8B6F47]">
                    {filter === 'active' ? '暂无启用的义工' : '暂无义工'}
                  </p>
                ) : (
                  <ul>
                    {visibleVolunteers.map((v) => {
                      const isSelf = me?.email === v.email;
                      const busy = actingId === v.id;

                      if (editingId === v.id) {
                        return (
                          <li
                            key={v.id}
                            className="px-5 py-4 border-b border-[#EFE3BF] last:border-b-0"
                          >
                            <VolunteerEditForm
                              volunteer={v}
                              onSave={(payload) => saveEdit(v.id, payload)}
                              onCancel={() => setEditingId(null)}
                            />
                          </li>
                        );
                      }

                      return (
                        <li
                          key={v.id}
                          className={`px-5 py-4 border-b border-[#EFE3BF] last:border-b-0 flex flex-wrap items-center justify-between gap-3 ${
                            v.active ? '' : 'opacity-60'
                          }`}
                        >
                          <div className="min-w-0">
                            <p
                              className={`font-medium truncate ${
                                v.active ? 'text-[#583A0F]' : 'text-[#8B6F47]'
                              }`}
                            >
                              {v.display_name || v.email}
                              {isSelf && <span className="ml-1 text-xs text-[#B89968]">（你）</span>}
                            </p>
                            <p className="text-xs text-[#8B6F47] truncate">{v.email}</p>
                            {v.center && (
                              <p className="text-xs text-[#B89968] truncate">所属中心：{v.center}</p>
                            )}
                            {v.occupation && (
                              <p className="text-xs text-[#B89968] truncate">职业：{v.occupation}</p>
                            )}
                            {v.skills && (
                              <p className="text-xs text-[#B89968] truncate">专长：{v.skills}</p>
                            )}
                            <p className="mt-0.5 text-xs text-[#B89968]">加入于 {formatDate(v.created_at)}</p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <RoleBadge role={v.role} />
                            <ScopeBadge scope={v.scope} />
                            <StatusBadge active={v.active} />
                            {savedId === v.id && (
                              <span className="text-xs text-[#A87929]">已保存 ✓</span>
                            )}

                            <button
                              onClick={() => setEditingId(v.id)}
                              disabled={busy}
                              className="px-3 py-1 text-xs text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              编辑
                            </button>

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

// Inline row editor for a volunteer's display name / email / center. Mounted only
// while its row is being edited, so its local state initialises from props on each
// open with no sync effect (keeps setState out of effects-with-deps). onSave
// resolves to an error string (shown here) or null on success (parent unmounts us).
function VolunteerEditForm({
  volunteer,
  onSave,
  onCancel,
}: {
  volunteer: Volunteer;
  onSave: (payload: {
    displayName: string;
    email: string;
    center: string;
    occupation: string;
    skills: string;
  }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(volunteer.display_name ?? '');
  const [email, setEmail] = useState(volunteer.email);
  // Only preselect the center if it's a known value; legacy free-text values show
  // as 未指定 (and would be replaced by whatever is chosen on save).
  const [center, setCenter] = useState(
    volunteer.center && isValidCenter(volunteer.center) ? volunteer.center : ''
  );
  const [occupation, setOccupation] = useState(volunteer.occupation ?? '');
  const [skills, setSkills] = useState(volunteer.skills ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const err = await onSave({ displayName: name, email, center, occupation, skills });
    // On success the parent clears editing and unmounts this form; only touch
    // state when we stay mounted (an error), so there's no setState-after-unmount.
    if (err) {
      setError(err);
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="edit-name" className="block text-xs font-medium text-[#B89968] mb-1">
            显示名称
          </label>
          <input
            id="edit-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            placeholder="如：李师兄"
            className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] placeholder:text-[#B89968] focus:outline-none focus:border-[#D89938] disabled:opacity-50"
          />
        </div>
        <div>
          <label htmlFor="edit-email" className="block text-xs font-medium text-[#B89968] mb-1">
            邮箱
          </label>
          <input
            id="edit-email"
            name="edit-volunteer-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={saving}
            placeholder="you@example.com"
            className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] placeholder:text-[#B89968] focus:outline-none focus:border-[#D89938] disabled:opacity-50"
          />
        </div>
        <div>
          <label htmlFor="edit-center" className="block text-xs font-medium text-[#B89968] mb-1">
            所属中心
          </label>
          <CenterSelect id="edit-center" value={center} onChange={setCenter} disabled={saving} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="edit-occupation" className="block text-xs font-medium text-[#B89968] mb-1">
            职业
          </label>
          <input
            id="edit-occupation"
            type="text"
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
            disabled={saving}
            placeholder="如：教师"
            className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] placeholder:text-[#B89968] focus:outline-none focus:border-[#D89938] disabled:opacity-50"
          />
        </div>
        <div>
          <label htmlFor="edit-skills" className="block text-xs font-medium text-[#B89968] mb-1">
            专长／技能
          </label>
          <textarea
            id="edit-skills"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            disabled={saving}
            rows={2}
            placeholder="如：辅导、翻译、设计、医护…"
            className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] placeholder:text-[#B89968] leading-relaxed resize-y focus:outline-none focus:border-[#D89938] disabled:opacity-50"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !email.trim()}
          className="px-4 py-1.5 text-xs text-white bg-[#D89938] rounded-full hover:bg-[#A87929] transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-1.5 text-xs text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition disabled:opacity-50"
        >
          取消
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}

// 所属中心 dropdown: a blank 未指定 option + one <optgroup> per state. Used by both
// the add and edit forms. A value not in the list (legacy free-text) renders as no
// selection — the caller decides how to treat that.
function CenterSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] focus:outline-none focus:border-[#D89938] disabled:opacity-50"
    >
      <option value="">未指定</option>
      {XLFM_CENTERS.map((g) => (
        <optgroup key={g.state} label={g.state}>
          {g.centers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const label = ROLE_LABELS[role] ?? role;
  // Admin-tier roles get the filled gold chip; care volunteer stays the plain chip.
  const filled = role === 'admin' || role === 'erp_admin';
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${
        filled ? 'bg-[#FAEFD0] text-[#A87929]' : 'bg-white border border-[#EFE3BF] text-[#8B6F47]'
      }`}
    >
      {label}
    </span>
  );
}

function ScopeBadge({ scope }: { scope: 'all_centers' | 'own_center' | null }) {
  return scope === 'all_centers' ? (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#F5E1B0] text-[#8A5A1E]">
      全部中心
    </span>
  ) : (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-white border border-[#EFE3BF] text-[#8B6F47]">
      本中心
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
