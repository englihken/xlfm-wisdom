// src/app/dashboard/settings/e3-sections.tsx
// The five E3 设置 sections (brief §3): 权限矩阵 (read-only), 审计查看器
// (read-only, append-only banner), 智慧问答设定 (care.categories tag list +
// AI-draft toggle), 渡人阶段 (read-only code vocab + event window), 公开页面
// (/f /m toggles + /m notice). All backed by /api/dashboard/org-settings (hard
// key allowlist) except the matrix/audit readers. Every string via t() (§0).

'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { MILESTONES, SOURCES } from '@/lib/outreach';
import { useT } from '@/lib/i18n-react';

// Local toast (mirrors the page's useToast — kept private there).
function useToast() {
  const t = useT();
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast((v) => (v === m ? null : v)), 2500);
  };
  const node = toast ? (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-full bg-ink text-white text-sm shadow-lg">{toast}</div>
  ) : null;
  return { flash, node };
}

// ─────────────────────────── 权限矩阵 (read-only) ───────────────────────────
type MatrixRow = { role: string; grants: Record<string, string>; activeCount: number; scope: string | null };

// i18n KEYS (resolved at render with useT — module scope can't call the hook).
const MATRIX_MODULES: { key: string; labelKey: string }[] = [
  { key: 'care', labelKey: 'matrix.mod.care' },
  { key: 'inbox', labelKey: 'matrix.mod.inbox' },
  { key: 'outreach', labelKey: 'matrix.mod.outreach' },
  { key: 'members', labelKey: 'matrix.mod.members' },
  { key: 'events', labelKey: 'matrix.mod.events' },
  { key: 'inventory', labelKey: 'matrix.mod.inventory' },
  { key: 'finance', labelKey: 'matrix.mod.finance' },
  { key: 'reports', labelKey: 'matrix.mod.reports' },
  { key: 'settings', labelKey: 'matrix.mod.settings' },
  { key: 'audit', labelKey: 'matrix.mod.audit' },
];

const MATRIX_ROLE_KEYS: Record<string, string> = {
  admin: 'shell.role.admin',
  volunteer: 'shell.role.volunteer',
  erp_admin: 'shell.role.erpAdmin',
  committee: 'shell.role.committee',
  centre_head: 'shell.role.centreHead',
  finance_director: 'shell.role.financeDirector',
  centre_finance: 'shell.role.centreFinance',
};

function AccessChip({ access }: { access: string | undefined }) {
  const t = useT();
  if (!access || access === 'none') return <span className="text-ink-faint">—</span>;
  const map: Record<string, { label: string; cls: string }> = {
    admin: { label: t('matrix.access.admin'), cls: 'pill-gold' },
    edit: { label: t('matrix.access.edit'), cls: 'bg-[#E7F2EC] text-[#2F7D5E] border border-[#CDE4D8]' },
    view: { label: t('matrix.access.view'), cls: 'bg-[#E8F1F7] text-[#3A7CA5] border border-[#CFE2EE]' },
    summary: { label: t('matrix.access.summary'), cls: 'pill-muted' },
  };
  const m = map[access] ?? { label: access, cls: 'pill-muted' };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.cls}`}>{m.label}</span>;
}

export function PermMatrixSection() {
  const t = useT();
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/perm-matrix')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) setRows(j.roles ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-4">
      <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
        <h2 className="font-serif text-base font-semibold text-ink">🔐 {t('settings.section.matrix')}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t('matrix.hint')}</p>
        {loading ? (
          <p className="mt-4 text-sm text-ink-muted">{t('common.loading')}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm min-w-[780px]">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <th className="px-2 py-2 font-normal">{t('matrix.col.role')}</th>
                  {MATRIX_MODULES.map((m) => (
                    <th key={m.key} className="px-2 py-2 font-normal">
                      {t(m.labelKey)}
                    </th>
                  ))}
                  <th className="px-2 py-2 font-normal">{t('matrix.col.scope')}</th>
                  <th className="px-2 py-2 font-normal">{t('matrix.col.accounts')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.role} className="border-b border-border last:border-b-0 align-middle">
                    <td className="px-2 py-2 font-medium text-ink whitespace-nowrap">{MATRIX_ROLE_KEYS[r.role] ? t(MATRIX_ROLE_KEYS[r.role]) : r.role}</td>
                    {MATRIX_MODULES.map((m) => (
                      <td key={m.key} className="px-2 py-2">
                        <AccessChip access={r.grants[m.key]} />
                      </td>
                    ))}
                    <td className="px-2 py-2 text-ink-muted whitespace-nowrap">
                      {r.scope === 'all_centers'
                        ? t('matrix.scope.national')
                        : r.scope === 'own_center'
                          ? t('matrix.scope.ownCentre')
                          : r.scope === 'mixed'
                            ? t('matrix.scope.mixed')
                            : '—'}
                    </td>
                    <td className="px-2 py-2 text-ink-muted tabular-nums">{r.activeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-ink-faint">{t('matrix.footNote')}</p>
      </section>
    </div>
  );
}

// ─────────────────────────── 审计查看器 (read-only) ───────────────────────────
type AuditEntry = {
  id: number;
  at: string;
  actor_email: string | null;
  module: string;
  action: string;
  table_name: string;
  record_id: string;
  before: unknown;
  after: unknown;
};

const AUDIT_MODULES = ['care', 'members', 'events', 'finance', 'inventory', 'outreach', 'inbox', 'settings'];
const AUDIT_ACTIONS = [
  'create',
  'update',
  'deactivate',
  'reactivate',
  'import',
  'thread_created',
  'replied',
  'note_added',
  'status_changed',
  'assigned',
  'transferred',
  'break_glass_view',
  'mailbox_updated',
  'owner_added',
  'owner_removed',
  'template_created',
  'template_updated',
  'template_deleted',
  'settings_updated',
  'centre_created',
  'centre_updated',
  'outreach.person_create',
  'outreach.person_update',
  'outreach.milestone_record',
  'outreach.milestone_update',
  'outreach.milestone_delete',
  'outreach.notify_opt_in_changed',
];

function fmtAuditTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AuditViewerSection() {
  const t = useT();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [mod, setMod] = useState('');
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async (p: number, m: string, a: string, q: string) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set('page', String(p));
      if (m) sp.set('module', m);
      if (a) sp.set('action', a);
      if (q) sp.set('q', q);
      const res = await fetch(`/api/dashboard/audit?${sp.toString()}`);
      if (res.ok) {
        const j = await res.json();
        setEntries(j.entries ?? []);
        setTotal(j.total ?? 0);
        setTotalPages(j.totalPages ?? 1);
      }
    } catch {
      /* keep current view on failure */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1, '', '', '');
  }, [load]);

  const applyFilters = (m: string, a: string, q: string) => {
    setMod(m);
    setAction(a);
    setSearch(q);
    setPage(1);
    load(1, m, a, q);
  };
  const goPage = (p: number) => {
    setPage(p);
    load(p, mod, action, search);
  };

  const selCls = 'text-sm px-2.5 py-1.5 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent';

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-4">
      <div className="rounded-xl px-4 py-2.5 bg-[#FBF3DE] border border-gold-border text-[#4A3A14] text-sm">🧾 {t('audit.banner')}</div>
      <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap gap-2 items-center mb-4">
          <select value={mod} onChange={(e) => applyFilters(e.target.value, action, search)} className={selCls}>
            <option value="">{t('audit.allModules')}</option>
            {AUDIT_MODULES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select value={action} onChange={(e) => applyFilters(mod, e.target.value, search)} className={selCls}>
            <option value="">{t('audit.allActions')}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilters(mod, action, search);
            }}
            placeholder={t('audit.searchPlaceholder')}
            className="text-sm px-2.5 py-1.5 border border-border-strong rounded-lg bg-surface text-ink w-52 focus:outline-none focus:border-accent"
          />
          <button onClick={() => applyFilters(mod, action, search)} className="btn-secondary px-3 py-1.5 text-xs">
            {t('audit.search')}
          </button>
          <span className="pill-muted inline-block px-2.5 py-0.5 rounded-full text-[11px] ml-auto">
            {t('audit.totalPrefix')} {total} {t('audit.totalSuffix')}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-ink-muted">{t('common.loading')}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-ink-faint">{t('audit.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <th className="px-2 py-2 font-normal">{t('audit.col.time')}</th>
                  <th className="px-2 py-2 font-normal">{t('audit.col.actor')}</th>
                  <th className="px-2 py-2 font-normal">{t('audit.col.module')}</th>
                  <th className="px-2 py-2 font-normal">{t('audit.col.action')}</th>
                  <th className="px-2 py-2 font-normal">{t('audit.col.target')}</th>
                  <th className="px-2 py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <Fragment key={e.id}>
                    <tr className="border-b border-border last:border-b-0">
                      <td className="px-2 py-2 text-ink-muted whitespace-nowrap tabular-nums">{fmtAuditTime(e.at)}</td>
                      <td className="px-2 py-2 text-ink truncate max-w-[160px]">{e.actor_email ?? t('audit.systemActor')}</td>
                      <td className="px-2 py-2">
                        <span className="pill-muted inline-block px-2 py-0.5 rounded-full text-[10.5px]">{e.module}</span>
                      </td>
                      <td className="px-2 py-2 text-ink">{e.action}</td>
                      <td className="px-2 py-2 text-ink-faint font-mono text-[11.5px] whitespace-nowrap">
                        {e.table_name} · {String(e.record_id).slice(0, 8)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button onClick={() => setExpanded(expanded === e.id ? null : e.id)} className="text-[11px] text-accent-deep hover:underline">
                          {expanded === e.id ? t('audit.collapse') : t('audit.expand')}
                        </button>
                      </td>
                    </tr>
                    {expanded === e.id && (
                      <tr className="border-b border-border">
                        <td colSpan={6} className="px-2 py-3 bg-surface-soft">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <p className="u-label mb-1">before</p>
                              <pre className="text-[11px] text-ink-body bg-surface border border-border rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap">
                                {e.before == null ? '—' : JSON.stringify(e.before, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <p className="u-label mb-1">after</p>
                              <pre className="text-[11px] text-ink-body bg-surface border border-border rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap">
                                {e.after == null ? '—' : JSON.stringify(e.after, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center gap-3 text-sm">
            <button disabled={page <= 1} onClick={() => goPage(page - 1)} className="btn-secondary px-3 py-1 text-xs disabled:opacity-40">
              {t('audit.prevPage')}
            </button>
            <span className="text-ink-muted text-xs tabular-nums">
              {page} / {totalPages}
            </span>
            <button disabled={page >= totalPages} onClick={() => goPage(page + 1)} className="btn-secondary px-3 py-1 text-xs disabled:opacity-40">
              {t('audit.nextPage')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────── org-settings hook ───────────────────────────
type OrgValues = Record<string, unknown>;

function useOrgSettings() {
  const [values, setValues] = useState<OrgValues | null>(null);
  const load = useCallback(async () => {
    const res = await fetch('/api/dashboard/org-settings');
    if (res.ok) {
      const j = await res.json();
      setValues(j.values ?? {});
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const save = useCallback(
    async (patch: OrgValues): Promise<boolean> => {
      const res = await fetch('/api/dashboard/org-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: patch }),
      });
      if (res.ok) await load();
      return res.ok;
    },
    [load]
  );
  return { values, save };
}

// ─────────────────────────── 智慧问答设定 ───────────────────────────
export function CareCfgSection() {
  const t = useT();
  const { values, save } = useOrgSettings();
  const [newCat, setNewCat] = useState('');
  const { flash, node } = useToast();

  const categories: string[] = Array.isArray(values?.['care.categories']) ? (values['care.categories'] as string[]) : [];
  const aiDraft = values?.['care.ai_draft_enabled'] !== false; // missing → on (matches server fail-open)

  const saveCategories = async (list: string[]) => {
    if (list.length === 0) {
      flash(t('careCfg.needOne'));
      return;
    }
    const ok = await save({ 'care.categories': list });
    flash(ok ? t('common.saved') : t('common.saveFailed'));
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
        <h2 className="font-serif text-base font-semibold text-ink">🪷 {t('settings.section.careCfg')}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t('careCfg.hint')}</p>

        <p className="u-label mt-5 mb-2">{t('careCfg.categoriesLabel')}</p>
        {values === null ? (
          <p className="text-sm text-ink-muted">{t('common.loading')}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5 bg-surface border border-border rounded-full px-2.5 py-0.5 text-[12px] text-ink">
                  {k}
                  <button
                    onClick={() => saveCategories(categories.filter((x) => x !== k))}
                    className="text-ink-faint hover:text-[#B4402E]"
                    aria-label={`${t('common.remove')} ${k}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2.5 flex gap-2">
              <input
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                placeholder={t('careCfg.addPlaceholder')}
                className="text-sm px-2.5 py-1.5 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => {
                  const k = newCat.trim();
                  if (k && !categories.includes(k)) saveCategories([...categories, k]);
                  setNewCat('');
                }}
                className="btn-secondary px-3 py-1 text-xs"
              >
                {t('common.add')}
              </button>
            </div>
          </>
        )}

        <p className="u-label mt-6 mb-2">{t('careCfg.aiDraftLabel')}</p>
        <label className="flex items-center gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={aiDraft}
            disabled={values === null}
            onChange={async (e) => {
              const ok = await save({ 'care.ai_draft_enabled': e.target.checked });
              flash(ok ? t('common.saved') : t('common.saveFailed'));
            }}
          />
          <span className="text-ink-muted text-[13px]">{t('careCfg.aiDraftHint')}</span>
        </label>
      </section>
      {node}
    </div>
  );
}

// ─────────────────────────── 渡人阶段 (read-only vocab + window) ─────────────
export function StagesSection() {
  const t = useT();
  const { values, save } = useOrgSettings();
  const [windowDays, setWindowDays] = useState<number | null>(null);
  const { flash, node } = useToast();

  const savedWindow = typeof values?.['outreach.event_window_days'] === 'number' ? (values['outreach.event_window_days'] as number) : 90;
  const shownWindow = windowDays ?? savedWindow;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
        <h2 className="font-serif text-base font-semibold text-ink">🌱 {t('settings.section.stages')}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t('stages.hint')}</p>

        <p className="u-label mt-5 mb-2">{t('stages.stagesLabel')}</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-ink-faint border-b border-border">
              <th className="px-2 py-2 font-normal">{t('stages.col.stage')}</th>
              <th className="px-2 py-2 font-normal">{t('stages.col.key')}</th>
            </tr>
          </thead>
          <tbody>
            {MILESTONES.map((m) => (
              <tr key={m.key} className="border-b border-border last:border-b-0">
                <td className="px-2 py-2 text-ink">
                  {m.emoji} {m.label}
                </td>
                <td className="px-2 py-2 font-mono text-[12px] text-ink-muted">{m.key}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="u-label mt-6 mb-2">{t('stages.sourcesLabel')}</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-ink-faint border-b border-border">
              <th className="px-2 py-2 font-normal">{t('stages.col.source')}</th>
              <th className="px-2 py-2 font-normal">{t('stages.col.key')}</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => (
              <tr key={s.key} className="border-b border-border last:border-b-0">
                <td className="px-2 py-2 text-ink">{s.label}</td>
                <td className="px-2 py-2 font-mono text-[12px] text-ink-muted">{s.key}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
        <h2 className="font-serif text-base font-semibold text-ink">{t('stages.windowTitle')}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t('stages.windowHint')}</p>
        <div className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input
            type="number"
            min={1}
            max={3650}
            value={shownWindow}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="w-20 text-center text-sm px-2 py-1.5 border border-border-strong rounded-lg bg-surface focus:outline-none focus:border-accent"
          />
          <span>{t('stages.daysUnit')}</span>
          <button
            onClick={async () => {
              const v = Math.round(shownWindow);
              if (!Number.isFinite(v) || v < 1) {
                flash(t('common.saveFailed'));
                return;
              }
              const ok = await save({ 'outreach.event_window_days': v });
              flash(ok ? t('common.saved') : t('common.saveFailed'));
              if (ok) setWindowDays(null);
            }}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            {t('common.save')}
          </button>
        </div>
      </section>
      {node}
    </div>
  );
}

// ─────────────────────────── 公开页面 ───────────────────────────
export function PublicPagesSection() {
  const t = useT();
  const { values, save } = useOrgSettings();
  const [notice, setNotice] = useState<string | null>(null);
  const { flash, node } = useToast();

  // FAIL-OPEN reading, mirroring the server: missing key → enabled.
  const feeOn = values?.['public.fee_check_enabled'] !== false;
  const formOn = values?.['public.inbox_form_enabled'] !== false;
  const savedNotice = typeof values?.['public.inbox_form_notice'] === 'string' ? (values['public.inbox_form_notice'] as string) : '';

  const toggle = async (key: string, next: boolean) => {
    const ok = await save({ [key]: next });
    flash(ok ? t('common.saved') : t('common.saveFailed'));
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
        <h2 className="font-serif text-base font-semibold text-ink">🌐 {t('settings.section.publicPages')}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t('publicPages.hint')}</p>
        {values === null ? (
          <p className="mt-4 text-sm text-ink-muted">{t('common.loading')}</p>
        ) : (
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                <th className="px-2 py-2 font-normal">{t('publicPages.col.page')}</th>
                <th className="px-2 py-2 font-normal">{t('publicPages.col.desc')}</th>
                <th className="px-2 py-2 font-normal">{t('publicPages.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="px-2 py-2 font-mono text-[12px] text-ink">/f</td>
                <td className="px-2 py-2 text-ink-muted">{t('publicPages.feeDesc')}</td>
                <td className="px-2 py-2">
                  <button
                    onClick={() => toggle('public.fee_check_enabled', !feeOn)}
                    className={`px-2.5 py-1 text-xs rounded-full border ${feeOn ? 'bg-[#E7F2EC] text-[#2F7D5E] border-[#CDE4D8]' : 'pill-muted'}`}
                  >
                    {feeOn ? t('publicPages.on') : t('publicPages.off')}
                  </button>
                </td>
              </tr>
              <tr className="border-b border-border align-top">
                <td className="px-2 py-2 font-mono text-[12px] text-ink">/m</td>
                <td className="px-2 py-2 text-ink-muted">
                  {t('publicPages.formDesc')}
                  <textarea
                    value={notice ?? savedNotice}
                    onChange={(e) => setNotice(e.target.value)}
                    onBlur={async () => {
                      if (notice !== null && notice !== savedNotice) {
                        const ok = await save({ 'public.inbox_form_notice': notice });
                        flash(ok ? t('common.saved') : t('common.saveFailed'));
                        if (ok) setNotice(null);
                      }
                    }}
                    rows={2}
                    placeholder={t('publicPages.noticePlaceholder')}
                    className="mt-2 w-full text-[12.5px] px-2.5 py-1.5 border border-border-strong rounded-lg bg-surface-soft text-ink focus:outline-none focus:border-accent"
                  />
                </td>
                <td className="px-2 py-2">
                  <button
                    onClick={() => toggle('public.inbox_form_enabled', !formOn)}
                    className={`px-2.5 py-1 text-xs rounded-full border ${formOn ? 'bg-[#E7F2EC] text-[#2F7D5E] border-[#CDE4D8]' : 'pill-muted'}`}
                  >
                    {formOn ? t('publicPages.on') : t('publicPages.off')}
                  </button>
                </td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-2 py-2 font-mono text-[12px] text-ink">/r</td>
                <td className="px-2 py-2 text-ink-muted">{t('publicPages.rDesc')}</td>
                <td className="px-2 py-2">
                  <span className="pill-muted inline-block px-2 py-0.5 rounded-full text-[11px]">{t('publicPages.perEvent')}</span>
                </td>
              </tr>
              <tr>
                <td className="px-2 py-2 font-mono text-[12px] text-ink">/s</td>
                <td className="px-2 py-2 text-ink-muted">{t('publicPages.sDesc')}</td>
                <td className="px-2 py-2">
                  <span className="pill-muted inline-block px-2 py-0.5 rounded-full text-[11px]">{t('publicPages.perLink')}</span>
                </td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-ink-faint">{t('publicPages.failOpenNote')}</p>
      </section>
      {node}
    </div>
  );
}
