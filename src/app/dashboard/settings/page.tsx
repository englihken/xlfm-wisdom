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
import { createSupabaseBrowserClient, signOutEverywhere } from '@/lib/supabase-browser';
import { PasswordChangeGate } from '@/components/password-change-gate';
import { DashboardNav } from '@/components/dashboard-nav';
import { TopBar } from '@/components/top-bar';
import { grantAllows, type Grants } from '@/lib/access';
import { XLFM_CENTERS, isValidCenter } from '@/lib/xlfm-centers';
import { useT } from '@/lib/i18n-react';
import {
  PermMatrixSection,
  AuditViewerSection,
  CareCfgSection,
  StagesSection,
  PublicPagesSection,
} from './e3-sections';

type Role = 'admin' | 'volunteer' | 'erp_admin' | 'committee' | 'centre_head';

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

// Role display labels — i18n keys resolved at render (core shell.role.* vocab).
const ROLE_LABEL_KEYS: Record<string, string> = {
  admin: 'shell.role.admin',
  volunteer: 'shell.role.volunteer',
  erp_admin: 'shell.role.erpAdmin',
  committee: 'shell.role.committee',
  centre_head: 'shell.role.centreHead',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

// Settings sections. Data-driven so future sections are a one-line addition here
// + a matching block in the content area. E3 (brief §3): the page itself opens to
// settings≥edit (admin + erp_admin); 义工与账号 stays ADMIN-ONLY (section-gated,
// not a forked page); 审计查看器 additionally needs the 'audit' grant.
type SectionId =
  | 'volunteers'
  | 'inbox'
  | 'centres'
  | 'notify'
  | 'matrix'
  | 'audit'
  | 'careCfg'
  | 'stages'
  | 'publicPages';
const SECTIONS: { id: SectionId; labelKey: string; adminOnly?: boolean; needsAudit?: boolean }[] = [
  { id: 'volunteers', labelKey: 'settings.section.volunteers', adminOnly: true },
  { id: 'inbox', labelKey: 'settings.section.inbox' },
  { id: 'centres', labelKey: 'settings.section.centres' },
  { id: 'notify', labelKey: 'settings.section.notify' },
  { id: 'matrix', labelKey: 'settings.section.matrix' },
  { id: 'audit', labelKey: 'settings.section.audit', needsAudit: true },
  { id: 'careCfg', labelKey: 'settings.section.careCfg' },
  { id: 'stages', labelKey: 'settings.section.stages' },
  { id: 'publicPages', labelKey: 'settings.section.publicPages' },
];

export default function SettingsPage() {
  const t = useT();
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
    await signOutEverywhere();
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
        // E3 gate change (Ken 2026-07-11): the page opens at settings≥edit
        // (admin + erp_admin); 义工与账号 below is section-gated to admin only.
        if (!grantAllows(meJson.grants ?? {}, 'settings', 'edit')) {
          setGate('denied');
          return;
        }
        // Non-admins land on a section they can actually see.
        if (meJson.role !== 'admin') setActiveSection('inbox');
        // Gate passed — reveal the page, THEN load the team (admin only; the
        // volunteers API would 403 anyone else anyway).
        setGate('ok');
        if (meJson.role === 'admin') await reloadVolunteers();
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
        setActionError(json?.error ?? t('settings.vol.actionFailed'));
        return;
      }
      await reloadVolunteers();
    } catch {
      setActionError(t('settings.vol.actionFailed'));
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
    if (formRole === 'centre_head' && !formCentreId) {
      setAddError(t('settings.vol.centreHeadRequired'));
      return;
    }
    try {
      const res = await fetch('/api/dashboard/volunteers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formEmail,
          password: formPassword,
          displayName: formName,
          // Centre fields apply to 关怀义工 AND 分会负责人; scope is derived server-side.
          center: formRole === 'volunteer' || formRole === 'centre_head' ? formCenter : '',
          centre_id: formRole === 'volunteer' || formRole === 'centre_head' ? formCentreId : null,
          occupation: formOccupation,
          skills: formSkills,
          role: formRole,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setAddError(json?.error ?? t('settings.vol.addFailed'));
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
      setAddError(t('settings.vol.addFailed'));
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
    payload: { displayName: string; email: string; center: string; occupation: string; skills: string; role: string }
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
        return json?.error ?? t('common.saveFailed');
      }
      setVolunteers((prev) => prev.map((v) => (v.id === id ? json.volunteer : v)));
      setEditingId(null);
      setSavedId(id);
      setTimeout(() => setSavedId((s) => (s === id ? null : s)), 2000);
      return null;
    } catch {
      return t('common.saveFailed');
    }
  };

  const visibleVolunteers = filter === 'active' ? volunteers.filter((v) => v.active) : volunteers;

  // Neutral loader while EITHER the session check or the role check is in flight.
  // Nothing here reveals what the page is (no title, rail, top bar, or controls).
  if (checking || gate === 'checking') {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-sm text-ink-muted">{t('common.loading')}</p>
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
      <div className="min-h-screen bg-bg flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-ink">{t('settings.adminOnly')}</p>
          <p className="mt-2 text-sm text-ink-muted">{t('common.deniedHint')}</p>
          <Link
            href="/dashboard"
            className="btn-secondary inline-block mt-5 px-4 py-2 text-sm"
          >
            {t('settings.backToCare')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg md:ml-[72px]">
      <TopBar moduleTitle={t('settings.moduleTitle')} userLabel={me?.displayName || me?.email || undefined} onLogout={forceSignOut} />

      <DashboardNav role={me?.role ?? 'volunteer'} active="settings" grants={me?.grants} />

      {/* SECTION NAV + CONTENT — vertical sidebar on desktop, horizontal tab row
          on mobile (the same <ul> switches direction via md: breakpoints). */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <nav className="shrink-0 md:w-[220px] border-b md:border-b-0 md:border-r border-border bg-surface-soft p-3 md:p-4">
          <ul className="flex flex-wrap md:flex-col gap-1">
            {SECTIONS.filter(
              (s) =>
                (!s.adminOnly || me?.role === 'admin') &&
                (!s.needsAudit || grantAllows(me?.grants, 'audit', 'view'))
            ).map((s) => {
              const selected = s.id === activeSection;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => setActiveSection(s.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                      selected
                        ? 'bg-accent/10 text-accent-deep font-medium'
                        : 'text-ink-muted hover:bg-accent/5'
                    }`}
                  >
                    {t(s.labelKey)}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="flex-1 min-w-0 overflow-y-auto">
          {activeSection === 'volunteers' && me?.role === 'admin' && (
            <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
              {/* ADD VOLUNTEER */}
              <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
                <h2 className="font-serif text-base font-semibold text-ink">{t('settings.vol.addTitle')}</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  {t('settings.vol.addHint')}
                </p>
                {/* autoComplete=off (+ non-suggestive field names & new-password on
                    the password) so Chrome doesn't autofill the admin's own
                    credentials into a form that creates *another* account. */}
                <form onSubmit={handleAdd} autoComplete="off" className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="name" className="u-label block mb-1">
                      {t('settings.vol.displayName')}
                    </label>
                    <input
                      id="name"
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      disabled={submitting}
                      placeholder={t('settings.vol.namePlaceholder')}
                      className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label htmlFor="add-email" className="u-label block mb-1">
                      {t('settings.vol.email')}
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
                      className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                  {/* Centre fields apply to 关怀义工 AND 分会负责人 (own_center scope); hidden
                      for ERP/committee roles (all_centers). 分会负责人 REQUIRES a centre. */}
                  {(formRole === 'volunteer' || formRole === 'centre_head') && (
                    <>
                      {formRole === 'centre_head' && (
                        <p className="text-xs text-ink-muted">{t('settings.vol.centreHeadNote')}</p>
                      )}
                      <div>
                        <label htmlFor="add-center" className="u-label block mb-1">
                          {t('settings.vol.centerTextLabel')}
                        </label>
                        <CenterSelect
                          id="add-center"
                          value={formCenter}
                          onChange={setFormCenter}
                          disabled={submitting}
                        />
                      </div>
                      <div>
                        <label htmlFor="add-centre-id" className="u-label block mb-1">
                          {t('settings.vol.centreStructuredLabel')}
                        </label>
                        <select
                          id="add-centre-id"
                          value={formCentreId}
                          onChange={(e) => setFormCentreId(e.target.value)}
                          disabled={submitting}
                          className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent disabled:opacity-50"
                        >
                          <option value="">{t('settings.vol.unspecified')}</option>
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
                    <label htmlFor="add-occupation" className="u-label block mb-1">
                      {t('settings.vol.occupationOptional')}
                    </label>
                    <input
                      id="add-occupation"
                      type="text"
                      value={formOccupation}
                      onChange={(e) => setFormOccupation(e.target.value)}
                      disabled={submitting}
                      placeholder={t('settings.vol.occupationPlaceholder')}
                      className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label htmlFor="add-password" className="u-label block mb-1">
                      {t('settings.vol.initialPassword')}
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
                      placeholder={t('settings.vol.passwordPlaceholder')}
                      className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label htmlFor="add-role" className="u-label block mb-1">
                      {t('settings.vol.role')}
                    </label>
                    <select
                      id="add-role"
                      value={formRole}
                      onChange={(e) => setFormRole(e.target.value as Role)}
                      disabled={submitting}
                      className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent disabled:opacity-50"
                    >
                      <option value="volunteer">{t('shell.role.volunteer')}</option>
                      <option value="centre_head">{t('shell.role.centreHead')}</option>
                      <option value="admin">{t('shell.role.admin')}</option>
                      <option value="erp_admin">{t('shell.role.erpAdmin')}</option>
                      <option value="committee">{t('shell.role.committee')}</option>
                    </select>
                    {formRole === 'erp_admin' && (
                      <p className="mt-1 text-xs text-ink-muted">
                        {t('settings.vol.erpAdminNote')}
                      </p>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="add-skills" className="u-label block mb-1">
                      {t('settings.vol.skillsOptional')}
                    </label>
                    <textarea
                      id="add-skills"
                      value={formSkills}
                      onChange={(e) => setFormSkills(e.target.value)}
                      disabled={submitting}
                      rows={2}
                      placeholder={t('settings.vol.skillsPlaceholder')}
                      className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint leading-relaxed resize-y focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                  <div className="sm:col-span-2 flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={submitting || !formEmail.trim() || formPassword.length < 8}
                      className="btn-primary px-5 py-2 text-sm disabled:cursor-not-allowed"
                    >
                      {submitting ? t('settings.vol.adding') : t('settings.vol.add')}
                    </button>
                    {addSuccess && <span className="text-sm text-accent-deep">{t('settings.vol.added')}</span>}
                    {addError && <span className="text-sm text-red-600">{addError}</span>}
                  </div>
                </form>
              </section>

              {/* VOLUNTEER LIST.
                  There is deliberately NO delete action: a volunteer's history and
                  notes must stay attributable for safeguarding. Leaving the team is
                  modelled as 停用 (disable); the 仅启用/全部 filter below keeps
                  disabled accounts out of the everyday view but one click away. */}
              <section className="bg-surface border border-border rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="font-serif text-base font-semibold text-ink">{t('settings.vol.teamTitle')}</h2>
                    <span className="text-xs text-ink-faint">{t('settings.vol.peopleCount', { count: volunteers.length })}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    {(['active', 'all'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-3 py-1 rounded-full transition ${
                          filter === f
                            ? 'bg-accent/10 text-accent-deep'
                            : 'text-ink-muted hover:bg-accent/5'
                        }`}
                      >
                        {f === 'active' ? t('settings.vol.filterActive') : t('settings.vol.filterAll')}
                      </button>
                    ))}
                  </div>
                </div>

                {actionError && (
                  <div className="px-5 py-3 bg-[#FEF2F2] text-sm text-red-700 border-b border-border">
                    {actionError}
                  </div>
                )}

                {listLoading ? (
                  <p className="p-6 text-sm text-ink-muted">{t('common.loading')}</p>
                ) : visibleVolunteers.length === 0 ? (
                  <p className="p-6 text-sm text-ink-muted">
                    {filter === 'active' ? t('settings.vol.emptyActive') : t('settings.vol.emptyAll')}
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
                            className="px-5 py-4 border-b border-border last:border-b-0"
                          >
                            <VolunteerEditForm
                              volunteer={v}
                              isSelf={isSelf}
                              onSave={(payload) => saveEdit(v.id, payload)}
                              onCancel={() => setEditingId(null)}
                            />
                          </li>
                        );
                      }

                      return (
                        <li
                          key={v.id}
                          className={`px-5 py-4 border-b border-border last:border-b-0 flex flex-wrap items-center justify-between gap-3 ${
                            v.active ? '' : 'opacity-60'
                          }`}
                        >
                          <div className="min-w-0">
                            <p
                              className={`font-medium truncate ${
                                v.active ? 'text-ink' : 'text-ink-muted'
                              }`}
                            >
                              {v.display_name || v.email}
                              {isSelf && <span className="ml-1 text-xs text-ink-faint">{t('settings.vol.you')}</span>}
                            </p>
                            <p className="text-xs text-ink-muted truncate">{v.email}</p>
                            {v.center && (
                              <p className="text-xs text-ink-faint truncate">{t('settings.vol.centerLine', { center: v.center })}</p>
                            )}
                            {v.occupation && (
                              <p className="text-xs text-ink-faint truncate">{t('settings.vol.occupationLine', { occupation: v.occupation })}</p>
                            )}
                            {v.skills && (
                              <p className="text-xs text-ink-faint truncate">{t('settings.vol.skillsLine', { skills: v.skills })}</p>
                            )}
                            <p className="mt-0.5 text-xs text-ink-faint">{t('settings.vol.joinedOn', { date: formatDate(v.created_at) })}</p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <RoleBadge role={v.role} />
                            <ScopeBadge scope={v.scope} />
                            <StatusBadge active={v.active} />
                            {savedId === v.id && (
                              <span className="text-xs text-accent-deep">{t('common.saved')}</span>
                            )}

                            <button
                              onClick={() => setEditingId(v.id)}
                              disabled={busy}
                              className="btn-secondary px-3 py-1 text-xs disabled:cursor-not-allowed"
                            >
                              {t('settings.vol.edit')}
                            </button>

                            <button
                              onClick={() =>
                                patchVolunteer(v.id, {
                                  role: v.role === 'admin' ? 'volunteer' : 'admin',
                                })
                              }
                              disabled={isSelf || busy}
                              className="btn-secondary px-3 py-1 text-xs disabled:cursor-not-allowed"
                            >
                              {v.role === 'admin' ? t('settings.vol.demote') : t('settings.vol.promote')}
                            </button>

                            <button
                              onClick={() => patchVolunteer(v.id, { active: !v.active })}
                              disabled={isSelf || busy}
                              className={`px-3 py-1 text-xs rounded-full border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                                v.active
                                  ? 'text-red-700 border-[#FCA5A5] hover:bg-[#FEF2F2]'
                                  : 'text-accent-deep border-border hover:bg-accent/5'
                              }`}
                            >
                              {v.active ? t('settings.vol.disable') : t('settings.vol.enable')}
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
          {activeSection === 'inbox' && <InboxConfigSection />}
          {activeSection === 'centres' && <CentresSection />}
          {activeSection === 'notify' && <NotifyTemplatesSection />}
          {activeSection === 'matrix' && <PermMatrixSection />}
          {activeSection === 'audit' && grantAllows(me?.grants, 'audit', 'view') && <AuditViewerSection />}
          {activeSection === 'careCfg' && <CareCfgSection />}
          {activeSection === 'stages' && <StagesSection />}
          {activeSection === 'publicPages' && <PublicPagesSection />}
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
  isSelf,
  onSave,
  onCancel,
}: {
  volunteer: Volunteer;
  isSelf: boolean;
  onSave: (payload: {
    displayName: string;
    email: string;
    center: string;
    occupation: string;
    skills: string;
    role: string;
  }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(volunteer.display_name ?? '');
  const [email, setEmail] = useState(volunteer.email);
  // Only preselect the center if it's a known value; legacy free-text values show
  // as 未指定 (and would be replaced by whatever is chosen on save).
  const [center, setCenter] = useState(
    volunteer.center && isValidCenter(volunteer.center) ? volunteer.center : ''
  );
  const [occupation, setOccupation] = useState(volunteer.occupation ?? '');
  const [skills, setSkills] = useState(volunteer.skills ?? '');
  const [role, setRole] = useState<Role>(volunteer.role);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const err = await onSave({ displayName: name, email, center, occupation, skills, role });
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
          <label htmlFor="edit-name" className="u-label block mb-1">
            {t('settings.vol.displayName')}
          </label>
          <input
            id="edit-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            placeholder={t('settings.vol.namePlaceholder')}
            className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent disabled:opacity-50"
          />
        </div>
        <div>
          <label htmlFor="edit-email" className="u-label block mb-1">
            {t('settings.vol.email')}
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
            className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent disabled:opacity-50"
          />
        </div>
        <div>
          <label htmlFor="edit-center" className="u-label block mb-1">
            {t('settings.vol.centerLabel')}
          </label>
          <CenterSelect id="edit-center" value={center} onChange={setCenter} disabled={saving} />
        </div>
        <div>
          <label htmlFor="edit-role" className="u-label block mb-1">
            {t('settings.vol.role')}
          </label>
          <select
            id="edit-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={saving || isSelf}
            className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="admin">{t('shell.role.admin')}</option>
            <option value="volunteer">{t('shell.role.volunteer')}</option>
            <option value="centre_head">{t('shell.role.centreHead')}</option>
            <option value="erp_admin">{t('shell.role.erpAdmin')}</option>
            <option value="committee">{t('shell.role.committee')}</option>
          </select>
          {isSelf && <p className="mt-1 text-[11px] text-ink-faint">{t('settings.vol.cannotEditOwnRole')}</p>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="edit-occupation" className="u-label block mb-1">
            {t('settings.vol.occupation')}
          </label>
          <input
            id="edit-occupation"
            type="text"
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
            disabled={saving}
            placeholder={t('settings.vol.occupationPlaceholder')}
            className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent disabled:opacity-50"
          />
        </div>
        <div>
          <label htmlFor="edit-skills" className="u-label block mb-1">
            {t('settings.vol.skills')}
          </label>
          <textarea
            id="edit-skills"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            disabled={saving}
            rows={2}
            placeholder={t('settings.vol.skillsPlaceholder')}
            className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint leading-relaxed resize-y focus:outline-none focus:border-accent disabled:opacity-50"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !email.trim()}
          className="btn-primary px-4 py-1.5 text-xs disabled:cursor-not-allowed"
        >
          {saving ? t('settings.vol.saving') : t('common.save')}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="btn-secondary px-4 py-1.5 text-xs"
        >
          {t('settings.vol.cancel')}
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
  const t = useT();
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent disabled:opacity-50"
    >
      <option value="">{t('settings.vol.unspecified')}</option>
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
  const t = useT();
  const label = ROLE_LABEL_KEYS[role] ? t(ROLE_LABEL_KEYS[role]) : role;
  // Admin-tier roles get the filled gold chip; care volunteer stays the plain chip.
  const filled = role === 'admin' || role === 'erp_admin';
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${
        filled ? 'pill-gold' : 'pill-muted'
      }`}
    >
      {label}
    </span>
  );
}

function ScopeBadge({ scope }: { scope: 'all_centers' | 'own_center' | null }) {
  const t = useT();
  return scope === 'all_centers' ? (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#F5E1B0] text-[#8A5A1E]">
      {t('settings.vol.scopeAll')}
    </span>
  ) : (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] pill-muted">
      {t('settings.vol.scopeOwn')}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  const t = useT();
  return active ? (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] pill-muted">
      {t('settings.vol.statusActive')}
    </span>
  ) : (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#FEF2F2] text-red-700">
      {t('settings.vol.statusDisabled')}
    </span>
  );
}

// ─────────────────────────── E2: 收件箱配置 ───────────────────────────
type MailboxCfg = {
  id: string; centre_name: string; centre_code: string; centre_active: boolean;
  is_enabled: boolean; auto_reply_enabled: boolean; auto_reply_text: string | null;
  owners: { id: string; name: string }[];
};
type VolLite = { id: string; display_name: string | null; email: string; active: boolean };

function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 2500); };
  const node = toast ? <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-full bg-ink text-white text-sm shadow-lg">{toast}</div> : null;
  return { flash, node };
}

function InboxConfigSection() {
  const t = useT();
  const [mailboxes, setMailboxes] = useState<MailboxCfg[]>([]);
  const [vols, setVols] = useState<VolLite[]>([]);
  const [remind, setRemind] = useState(7);
  const [surface, setSurface] = useState(14);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKw, setNewKw] = useState('');
  const [ownerEdit, setOwnerEdit] = useState<MailboxCfg | null>(null);
  const { flash, node } = useToast();

  const load = useCallback(async () => {
    const [mb, cfg, vl] = await Promise.all([
      fetch('/api/inbox/mailboxes').then((r) => (r.ok ? r.json() : { mailboxes: [] })),
      fetch('/api/inbox/config').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/dashboard/volunteers').then((r) => (r.ok ? r.json() : { volunteers: [] })),
    ]);
    setMailboxes(mb.mailboxes ?? []);
    setVols((vl.volunteers ?? []).filter((v: VolLite) => v.active));
    if (cfg) { setRemind(cfg.escalation.remind_centre_days); setSurface(cfg.escalation.surface_hq_days); setKeywords(cfg.crisis_keywords ?? []); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const patchMailbox = async (id: string, payload: Record<string, unknown>) => {
    await fetch(`/api/inbox/mailboxes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    load();
  };
  const saveEscalation = async () => {
    await fetch('/api/inbox/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ escalation: { remind_centre_days: remind, surface_hq_days: surface } }) });
    flash(t('settings.inboxCfg.escalationSaved'));
  };
  const saveKeywords = async (list: string[]) => {
    setKeywords(list);
    await fetch('/api/inbox/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ crisis_keywords: list }) });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
        <h2 className="font-serif text-base font-semibold text-ink">{t('settings.section.inbox')}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t('settings.inboxCfg.hint')}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                <th className="px-2 py-2 font-normal">{t('settings.inboxCfg.colCentre')}</th>
                <th className="px-2 py-2 font-normal">{t('settings.inboxCfg.colOwner')}</th>
                <th className="px-2 py-2 font-normal">{t('settings.inboxCfg.colAutoReply')}</th>
                <th className="px-2 py-2 font-normal">{t('settings.inboxCfg.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {mailboxes.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-b-0 align-top">
                  <td className="px-2 py-2 text-ink">{m.centre_name} <span className="text-ink-faint text-[11px]">{m.centre_code}</span></td>
                  <td className="px-2 py-2">
                    <div className="text-[12px] text-ink-muted">{m.owners.length ? m.owners.map((o) => o.name).join('、') : <span className="text-[#B4402E]">{t('settings.inboxCfg.unassigned')}</span>}</div>
                    <button onClick={() => setOwnerEdit(m)} className="text-[11px] text-accent-deep hover:underline">{t('settings.inboxCfg.edit')}</button>
                  </td>
                  <td className="px-2 py-2">
                    <label className="flex items-center gap-1 text-[12px]">
                      <input type="checkbox" checked={m.auto_reply_enabled} onChange={(e) => patchMailbox(m.id, { auto_reply_enabled: e.target.checked })} /> {t('settings.inboxCfg.on')}
                    </label>
                    {m.auto_reply_enabled && (
                      <textarea
                        defaultValue={m.auto_reply_text ?? ''}
                        onBlur={(e) => { if (e.target.value !== (m.auto_reply_text ?? '')) patchMailbox(m.id, { auto_reply_text: e.target.value }); }}
                        rows={2}
                        placeholder={t('settings.inboxCfg.autoReplyPlaceholder')}
                        className="mt-1 w-44 text-[12px] px-2 py-1 border border-border-strong rounded bg-surface-soft"
                      />
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      onClick={() => patchMailbox(m.id, { is_enabled: !m.is_enabled })}
                      className={`px-2.5 py-1 text-xs rounded-full border ${m.is_enabled ? 'bg-[#E7F0E0] text-[#3F6B2E] border-[#CFE3C0]' : 'pill-muted'}`}
                    >
                      {m.is_enabled ? t('settings.inboxCfg.enabled') : t('settings.inboxCfg.disabled')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
        <h2 className="font-serif text-base font-semibold text-ink">{t('settings.inboxCfg.escalationTitle')}</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">{t('settings.inboxCfg.remindCentreDays')}<input type="number" min={1} value={remind} onChange={(e) => setRemind(Number(e.target.value))} className="ml-2 w-16 px-2 py-1 border border-border-strong rounded bg-surface" /></label>
          <label className="text-sm">{t('settings.inboxCfg.surfaceHqDays')}<input type="number" min={1} value={surface} onChange={(e) => setSurface(Number(e.target.value))} className="ml-2 w-16 px-2 py-1 border border-border-strong rounded bg-surface" /></label>
          <button onClick={saveEscalation} className="btn-secondary px-3 py-1.5 text-xs">{t('settings.inboxCfg.saveDays')}</button>
        </div>
        <div className="mt-4">
          <p className="text-sm text-ink mb-1">{t('settings.inboxCfg.crisisKeywords')}</p>
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((k) => (
              <span key={k} className="pill-gold inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]">
                {k}<button onClick={() => saveKeywords(keywords.filter((x) => x !== k))} className="text-ink-faint hover:text-[#B4402E]">×</button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input value={newKw} onChange={(e) => setNewKw(e.target.value)} placeholder={t('settings.inboxCfg.newKeyword')} className="text-sm px-2 py-1 border border-border-strong rounded bg-surface" />
            <button onClick={() => { const k = newKw.trim(); if (k && !keywords.includes(k)) saveKeywords([...keywords, k]); setNewKw(''); }} className="btn-secondary px-3 py-1 text-xs">{t('common.add')}</button>
          </div>
        </div>
      </section>

      {ownerEdit && (
        <OwnerEditModal mailbox={ownerEdit} vols={vols} onClose={() => setOwnerEdit(null)} onSaved={() => { setOwnerEdit(null); flash(t('settings.inboxCfg.ownersUpdated')); load(); }} />
      )}
      {node}
    </div>
  );
}

function OwnerEditModal({ mailbox, vols, onClose, onSaved }: { mailbox: MailboxCfg; vols: VolLite[]; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [sel, setSel] = useState<Set<string>>(new Set(mailbox.owners.map((o) => o.id)));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => {
    setBusy(true);
    await fetch(`/api/inbox/mailboxes/${mailbox.id}/owners`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ volunteer_ids: [...sel] }) });
    setBusy(false);
    onSaved();
  };
  return (
    <div className="fixed inset-0 z-[80] bg-ink/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl max-w-md w-full p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-ink mb-3">{t('settings.inboxCfg.ownerModalTitle', { centre: mailbox.centre_name })}</h3>
        <ul className="space-y-1 mb-4">
          {vols.map((v) => (
            <li key={v.id}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sel.has(v.id)} onChange={() => toggle(v.id)} />
                {v.display_name || v.email}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('settings.inboxCfg.cancel')}</button>
          <button disabled={busy} onClick={save} className="px-5 py-1.5 text-sm btn-primary">{busy ? t('settings.inboxCfg.saving') : t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── E2: 共修会管理 ───────────────────────────
type CentreRow = { id: string; code: string; name_cn: string; name_en: string; state: string; aliases: string[]; is_active: boolean; sort: number };

function CentresSection() {
  const t = useT();
  const [centres, setCentres] = useState<CentreRow[]>([]);
  const [editing, setEditing] = useState<CentreRow | 'new' | null>(null);
  const { flash, node } = useToast();
  const load = useCallback(async () => {
    const j = await fetch('/api/dashboard/centres').then((r) => (r.ok ? r.json() : { centres: [] }));
    setCentres(j.centres ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleActive = async (c: CentreRow) => {
    await fetch(`/api/dashboard/centres/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !c.is_active }) });
    load();
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-base font-semibold text-ink">{t('settings.section.centres')}</h2>
          <button onClick={() => setEditing('new')} className="btn-primary px-4 py-1.5 text-sm">{t('settings.centres.addBtn')}</button>
        </div>
        <p className="mt-1 text-sm text-ink-muted">{t('settings.centres.hint')}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                <th className="px-2 py-2 font-normal">{t('settings.centres.colCode')}</th><th className="px-2 py-2 font-normal">{t('settings.centres.colCn')}</th><th className="px-2 py-2 font-normal">{t('settings.centres.colEn')}</th><th className="px-2 py-2 font-normal">{t('settings.centres.colState')}</th><th className="px-2 py-2 font-normal">{t('settings.centres.colSort')}</th><th className="px-2 py-2 font-normal">{t('settings.centres.colStatus')}</th><th className="px-2 py-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {centres.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-b-0 hover:bg-accent/5">
                  <td className="px-2 py-2 text-ink font-mono text-[12px]">{c.code}</td>
                  <td className="px-2 py-2 text-ink">{c.name_cn}</td>
                  <td className="px-2 py-2 text-ink-muted">{c.name_en}</td>
                  <td className="px-2 py-2 text-ink-muted">{c.state}</td>
                  <td className="px-2 py-2 text-ink-muted">{c.sort}</td>
                  <td className="px-2 py-2">{c.is_active ? <span className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-[#E7F0E0] text-[#3F6B2E]">{t('settings.centres.active')}</span> : <span className="pill-muted inline-block px-2 py-0.5 rounded-full text-[10px]">{t('settings.centres.inactive')}</span>}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(c)} className="text-[11px] text-accent-deep hover:underline mr-2">{t('settings.centres.edit')}</button>
                    <button onClick={() => toggleActive(c)} className="text-[11px] text-ink-muted hover:underline">{c.is_active ? t('settings.centres.disable') : t('settings.centres.enable')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && (
        <CentreModal
          centre={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(created) => { setEditing(null); flash(created ? t('settings.centres.created') : t('common.saved')); load(); }}
        />
      )}
      {node}
    </div>
  );
}

function CentreModal({ centre, onClose, onSaved }: { centre: CentreRow | null; onClose: () => void; onSaved: (created: boolean) => void }) {
  const t = useT();
  const [code, setCode] = useState(centre?.code ?? '');
  const [nameCn, setNameCn] = useState(centre?.name_cn ?? '');
  const [nameEn, setNameEn] = useState(centre?.name_en ?? '');
  const [state, setState] = useState(centre?.state ?? '');
  const [sort, setSort] = useState(centre?.sort ?? 0);
  const [aliases, setAliases] = useState((centre?.aliases ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputCls = 'w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink mb-3';
  const submit = async () => {
    setErr(null);
    const aliasArr = aliases.split(',').map((a) => a.trim()).filter(Boolean);
    const payload = { code, name_cn: nameCn, name_en: nameEn, state, sort, aliases: aliasArr };
    setBusy(true);
    const res = centre
      ? await fetch(`/api/dashboard/centres/${centre.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/dashboard/centres', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setBusy(false);
    if (res.ok) onSaved(!centre); else { const j = await res.json().catch(() => ({})); setErr(j.error ?? t('settings.centres.saveFailed')); }
  };
  return (
    <div className="fixed inset-0 z-[80] bg-ink/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-ink mb-3">{centre ? t('settings.centres.editTitle') : t('settings.centres.newTitle')}</h3>
        {err && <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2 mb-2">{err}</p>}
        <label className="block text-xs text-label mb-1">{t('settings.centres.codeLabel')}</label>
        <input value={code} disabled={!!centre} onChange={(e) => setCode(e.target.value.toUpperCase())} className={`${inputCls} ${centre ? 'opacity-60' : ''}`} />
        <label className="block text-xs text-label mb-1">{t('settings.centres.nameCnLabel')}</label>
        <input value={nameCn} onChange={(e) => setNameCn(e.target.value)} className={inputCls} />
        <label className="block text-xs text-label mb-1">{t('settings.centres.nameEnLabel')}</label>
        <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={inputCls} />
        <label className="block text-xs text-label mb-1">{t('settings.centres.stateLabel')}</label>
        <input value={state} onChange={(e) => setState(e.target.value)} className={inputCls} />
        <label className="block text-xs text-label mb-1">{t('settings.centres.sortLabel')}</label>
        <input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value))} className={inputCls} />
        <label className="block text-xs text-label mb-1">{t('settings.centres.aliasesLabel')}</label>
        <input value={aliases} onChange={(e) => setAliases(e.target.value)} className={inputCls} />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('settings.centres.cancel')}</button>
          <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? t('settings.centres.saving') : t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── E2: 通知与模板 ───────────────────────────
type TemplateRow = { id: string; title: string; body: string; is_active: boolean };
type NotifyRow = { id: string; display_name: string; phone: string | null; centre_name: string | null; opted_at: string | null; note: string | null };

function NotifyTemplatesSection() {
  const t = useT();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [notify, setNotify] = useState<NotifyRow[]>([]);
  const [editing, setEditing] = useState<TemplateRow | 'new' | null>(null);
  const { flash, node } = useToast();
  const load = useCallback(async () => {
    const [tplRes, n] = await Promise.all([
      fetch('/api/inbox/templates?all=1').then((r) => (r.ok ? r.json() : { templates: [] })),
      fetch('/api/inbox/notify').then((r) => (r.ok ? r.json() : { contacts: [] })),
    ]);
    setTemplates(tplRes.templates ?? []);
    setNotify(n.contacts ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleTpl = async (tpl: TemplateRow) => { await fetch(`/api/inbox/templates/${tpl.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !tpl.is_active }) }); load(); };
  const delTpl = async (tpl: TemplateRow) => { await fetch(`/api/inbox/templates/${tpl.id}`, { method: 'DELETE' }); load(); };
  const toggleNotify = async (c: NotifyRow) => { await fetch(`/api/inbox/notify/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notify_opt_in: false }) }); flash(t('settings.notify.removedFromList')); load(); };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-base font-semibold text-ink">{t('settings.notify.templatesTitle')}</h2>
          <button onClick={() => setEditing('new')} className="btn-primary px-4 py-1.5 text-sm">{t('settings.notify.newTemplate')}</button>
        </div>
        <ul className="mt-4 space-y-2">
          {templates.map((tpl) => (
            <li key={tpl.id} className="border border-border rounded-xl p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink">{tpl.title}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleTpl(tpl)} className={`text-[11px] px-2 py-0.5 rounded-full border ${tpl.is_active ? 'bg-[#E7F0E0] text-[#3F6B2E] border-[#CFE3C0]' : 'pill-muted'}`}>{tpl.is_active ? t('settings.notify.tplEnabled') : t('settings.notify.tplDisabled')}</button>
                  <button onClick={() => setEditing(tpl)} className="text-[11px] text-accent-deep hover:underline">{t('settings.notify.edit')}</button>
                  <button onClick={() => delTpl(tpl)} className="text-[11px] text-[#B4402E] hover:underline">{t('settings.notify.delete')}</button>
                </div>
              </div>
              <p className="mt-1 text-[12px] text-ink-muted whitespace-pre-wrap">{tpl.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
        <h2 className="font-serif text-base font-semibold text-ink">{t('settings.notify.listTitle')}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t('settings.notify.listHint')}</p>
        {notify.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">{t('settings.notify.emptyList')}</p>
        ) : (
          <table className="w-full text-sm mt-3">
            <thead><tr className="text-left text-[11px] text-ink-faint border-b border-border"><th className="px-2 py-2 font-normal">{t('settings.notify.colName')}</th><th className="px-2 py-2 font-normal">{t('settings.notify.colPhone')}</th><th className="px-2 py-2 font-normal">{t('settings.notify.colCentre')}</th><th className="px-2 py-2 font-normal">{t('settings.notify.colNote')}</th><th className="px-2 py-2 font-normal"></th></tr></thead>
            <tbody>
              {notify.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-b-0">
                  <td className="px-2 py-2 text-ink">{c.display_name}</td>
                  <td className="px-2 py-2 text-ink-muted">{c.phone ?? '—'}</td>
                  <td className="px-2 py-2 text-ink-muted">{c.centre_name ?? '—'}</td>
                  <td className="px-2 py-2 text-ink-muted">{c.note ?? '—'}</td>
                  <td className="px-2 py-2 text-right"><button onClick={() => toggleNotify(c)} className="text-[11px] text-[#B4402E] hover:underline">{t('settings.notify.removeBtn')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {editing && (
        <TemplateModal template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); flash(t('common.saved')); load(); }} />
      )}
      {node}
    </div>
  );
}

function TemplateModal({ template, onClose, onSaved }: { template: TemplateRow | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(template?.title ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!title.trim() || !body.trim()) { setErr(t('settings.notify.titleBodyRequired')); return; }
    setBusy(true);
    const res = template
      ? await fetch(`/api/inbox/templates/${template.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body }) })
      : await fetch('/api/inbox/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body }) });
    setBusy(false);
    if (res.ok) onSaved(); else { const j = await res.json().catch(() => ({})); setErr(j.error ?? t('settings.notify.saveFailed')); }
  };
  return (
    <div className="fixed inset-0 z-[80] bg-ink/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-ink mb-3">{template ? t('settings.notify.editTitle') : t('settings.notify.newTitle')}</h3>
        {err && <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2 mb-2">{err}</p>}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('settings.notify.titlePlaceholder')} className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink mb-3" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder={t('settings.notify.bodyPlaceholder')} className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface-soft text-ink mb-3" />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('settings.notify.cancel')}</button>
          <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? t('settings.notify.saving') : t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}
