// src/app/dashboard/events/[id]/page.tsx
// 活动详情 + 报名审核. Header (badges/dates/capacity + 编辑 + status-action buttons from
// the server matrix), fee & team-need summary cards, and the registration queue with
// approve/reject/cancel + 代报名 (live client-side fee preview) + CSV export. The queue
// rows show selections chips, an expandable fee breakdown, a member-profile link, and
// the decider name+time (B2.1 added those fields to the registrations list response).

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { useT } from '@/lib/i18n-react';
import type { TFunc } from '@/lib/i18n';
import { BringToOutreachButton } from '@/components/bring-to-outreach-button';
import { computeFees, type FeeItem, type Selections } from '@/lib/event-fees';
import { addDays, mealSlotKey } from '@/lib/events';
import { qrModules } from '@/lib/qr';
import {
  eventTypeLabel, eventStatusLabel, STATUS_STYLES, regStatusLabel, REG_STATUS_STYLES,
  paymentStatusLabel, PAYMENT_STATUS_STYLES,
  feeLabel, MEAL_COLS, feeBillingLabel, mealColLabel, weekdayCn, moneyRM,
} from '@/lib/events-display';

type FeeRow = { item: string; label_cn: string | null; amount: number; billing: string; sort?: number };
type TeamNeed = { team_id: string; name_cn: string; needed: number; approved: number };
type MealSlot = { slot_date: string; meal: string; offered: boolean };
type MealCounts = { perCell: Record<string, number>; perDay: Record<string, number>; total: number } | null;
type Detail = {
  event: Record<string, unknown> & {
    id: string; code: string; title: string; event_type: string; status: string;
    starts_on: string; ends_on: string | null; location: string | null; capacity: number | null;
    reg_deadline: string | null; reg_edit_cutoff_days?: number; organizing_centre?: { name_cn: string; code: string } | null;
    public_registration_enabled?: boolean; public_token?: string | null;
  };
  fees: FeeRow[];
  teamNeeds: TeamNeed[];
  mealSlots: MealSlot[];
  mealCounts: MealCounts;
  regStats: {
    counts: { pending: number; approved: number; rejected: number; cancelled: number };
    approvedFeeSum: number;
    payment?: { paidSum: number; verifiedCount: number; waivedCount: number; proofCount: number };
  };
};
type BreakdownLine = { item: string; label: string; amount: number; qty: number; subtotal: number };
type RegRow = {
  id: string; reg_no: string; member_id: string | null; name: string; phone: string | null; centreCode: string | null;
  volunteer_team_id: string | null; selections: Record<string, unknown>;
  fee_total: number; fee_breakdown: BreakdownLine[];
  status: string; decided_by: string | null; decidedByName: string | null; decided_at: string | null;
  payment_status: string; paid_amount: number | null; payment_note: string | null;
  has_proof: boolean; payment_verified_at: string | null;
};
type Team = { id: string; name_cn: string; slug: string };

// Registrations list page size (server DEFAULT is 25, MAX 100); CSV export re-fetches
// the full filtered list in MAX-sized batches so it never depends on the visible page.
const REG_PAGE_SIZE = 50;
const CSV_BATCH = 100;

// Compact selections summary chips: 🍚N餐/N天 🏨N晚 🚐 👕size×qty 🎁×N
function selectionsSummary(t: TFunc, sel: Record<string, unknown> | undefined): string {
  if (!sel) return '';
  const parts: string[] = [];
  const meals = Array.isArray(sel.meals) ? (sel.meals as unknown[]).filter((x) => typeof x === 'string').length : 0;
  const md = Number(sel.meal_days) || 0;
  const ni = Number(sel.nights) || 0;
  if (meals) parts.push(t('events.sel.meals', { n: meals }));
  else if (md) parts.push(t('events.sel.mealDays', { n: md }));
  if (ni) parts.push(t('events.sel.nights', { n: ni }));
  if (sel.transfer === true) parts.push('🚐');
  const u = sel.uniform as { size?: string; qty?: number } | undefined;
  if (u?.qty) parts.push(`👕${u.size ?? ''}×${u.qty}`);
  const oq = Number(sel.other_qty) || 0;
  if (oq) parts.push(`🎁×${oq}`);
  return parts.join(' ');
}

// Today in Malaysia time (YYYY-MM-DD) — for the selections-edit cutoff.
function todayMYT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

// The status-transition labels (matches the server matrix in src/lib/events.ts).
function transitionLabel(t: TFunc, from: string, to: string): string {
  if (to === 'open') return from === 'draft' ? t('events.transition.publish') : t('events.transition.reopen');
  if (to === 'closed') return t('events.transition.close');
  if (to === 'full') return t('events.transition.markFull');
  if (to === 'completed') return t('events.transition.markCompleted');
  return to;
}
const STATUS_NEXT: Record<string, string[]> = {
  draft: ['open'], open: ['full', 'closed', 'completed'], full: ['open', 'completed'], closed: ['completed'], completed: [],
};

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  return (
    <ErpGate active="events" module="events" titleSuffix={t('events.suffix.detail')}>
      {(me) => <Detail me={me} id={id} />}
    </ErpGate>
  );
}

function Detail({ me, id }: { me: ErpMe; id: string }) {
  const t = useT();
  const canEdit = grantAllows(me.grants, 'events', 'edit');
  const canOutreach = grantAllows(me.grants, 'outreach', 'edit');
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<Team[]>([]);
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected' | 'cancelled' | 'all'>('pending');
  const [regs, setRegs] = useState<RegRow[]>([]);
  const [regPage, setRegPage] = useState(1);
  const [regTotalPages, setRegTotalPages] = useState(1);
  const [regTotal, setRegTotal] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [regSearch, setRegSearch] = useState('');   // raw input
  const [regQuery, setRegQuery] = useState('');     // debounced — drives the fetch
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<RegRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editReg, setEditReg] = useState<RegRow | null>(null);
  const [payFor, setPayFor] = useState<RegRow | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (rid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });

  const teamName = useMemo(() => new Map(teams.map((t) => [t.id, t.name_cn])), [teams]);

  const loadEvent = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/events/${id}`);
      if (res.ok) setData((await res.json()) as Detail);
    } catch {
      /* keep loading state */
    } finally {
      setLoading(false);
    }
  }, [id]);

  // debounce the search input; a query change restarts at page 1 (identical values
  // bail out in React, so mount/no-op ticks cause no extra fetch)
  useEffect(() => {
    const timer = setTimeout(() => {
      setRegQuery(regSearch.trim());
      setRegPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [regSearch]);

  const loadRegs = useCallback(async () => {
    try {
      const sp = new URLSearchParams({ page: String(regPage), limit: String(REG_PAGE_SIZE) });
      if (tab !== 'all') sp.set('status', tab);
      if (regQuery) sp.set('search', regQuery);
      const res = await fetch(`/api/dashboard/events/${id}/registrations?${sp}`);
      if (res.ok) {
        const j = await res.json();
        setRegs(j.registrations ?? []);
        setRegTotal(j.total ?? 0);
        setRegTotalPages(j.totalPages ?? 1);
        // deciding away the last row of the final page leaves it empty — step back
        if ((j.registrations ?? []).length === 0 && (j.total ?? 0) > 0 && regPage > 1) {
          setRegPage((p) => Math.max(1, p - 1));
        }
      }
    } catch {
      /* ignore */
    }
  }, [id, tab, regPage, regQuery]);

  useEffect(() => {
    loadEvent();
    fetch('/api/dashboard/erp/meta').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setTeams(j.teams ?? []); }).catch(() => {});
  }, [loadEvent]);
  useEffect(() => { loadRegs(); }, [loadRegs]);

  const flashToast = (msg: string) => { setToast(msg); setTimeout(() => setToast((t) => (t === msg ? null : t)), 2500); };

  const decide = async (reg: RegRow, decision: 'approve' | 'reject' | 'cancel', reason?: string) => {
    setBusy(reg.id);
    try {
      const res = await fetch(`/api/dashboard/registrations/${reg.id}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { decision, reason } : { decision }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        flashToast(j?.error ?? t('events.toast.actionFailed'));
        return;
      }
      await Promise.all([loadRegs(), loadEvent()]); // reload event to catch capacity→full
      if (decision === 'approve') {
        // The decision response doesn't include event status, so we refetched; detect full.
        flashToast(t('events.toast.approved'));
      }
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = async (to: string) => {
    if (!data) return;
    if (!window.confirm(t('events.confirm.changeStatus', { status: eventStatusLabel(to, t) }))) return;
    const res = await fetch(`/api/dashboard/events/${id}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }),
    });
    if (res.ok) { flashToast(t('events.toast.statusUpdated', { status: eventStatusLabel(to, t) })); loadEvent(); }
    else { const j = await res.json().catch(() => null); flashToast(j?.error ?? t('events.toast.actionFailed')); }
  };

  const togglePublicReg = async (enabled: boolean) => {
    const res = await fetch(`/api/dashboard/events/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_registration_enabled: enabled }),
    });
    if (res.ok) { flashToast(enabled ? t('events.toast.publicOn') : t('events.toast.publicOff')); loadEvent(); }
    else { const j = await res.json().catch(() => null); flashToast(j?.error ?? t('events.toast.actionFailed')); }
  };

  if (loading) return <p className="max-w-4xl mx-auto px-4 py-10 text-sm text-ink-muted">{t('events.loading')}</p>;
  if (!data) return <p className="max-w-4xl mx-auto px-4 py-10 text-sm text-ink-muted">{t('events.loadFailed')}</p>;

  const e = data.event;
  const approved = data.regStats.counts.approved;
  const pct = e.capacity ? Math.min(100, Math.round((approved / e.capacity) * 100)) : 0;
  const nextStatuses = STATUS_NEXT[e.status] ?? [];
  const mealPerItem = data.fees.some((f) => f.item === 'meal' && f.billing === 'per_item');
  const cutoffDays = Number(e.reg_edit_cutoff_days ?? 3);
  const selectionsEditable = todayMYT() < addDays(e.starts_on, -cutoffDays);
  const tabs: [typeof tab, number | null][] = [
    ['pending', data.regStats.counts.pending], ['approved', data.regStats.counts.approved],
    ['rejected', data.regStats.counts.rejected], ['cancelled', data.regStats.counts.cancelled], ['all', null],
  ];

  return (
    <div className={`${PAGE_WIDE} space-y-5`}>
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-ink text-white text-sm shadow-lg">{toast}</div>
      )}

      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-bold font-serif text-ink">{e.title}</h2>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLES[e.status] ?? ''}`}>{eventStatusLabel(e.status, t)}</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full pill-gold">{eventTypeLabel(e.event_type, t)}</span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            <span className="font-mono">{e.code}</span>
            {e.organizing_centre ? ` · ${e.organizing_centre.name_cn}` : ''}
            {` · ${e.starts_on}${e.ends_on && e.ends_on !== e.starts_on ? ` — ${e.ends_on}` : ''}`}
            {e.location ? ` · ${e.location}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (e.status === 'draft' || e.status === 'open') && (
            <Link href={`/dashboard/events/${id}/edit`} className="px-4 py-1.5 text-sm btn-secondary">{t('events.detail.edit')}</Link>
          )}
          {canEdit && nextStatuses.map((to) => (
            <button key={to} onClick={() => changeStatus(to)}
              className="px-4 py-1.5 text-sm btn-primary">
              {transitionLabel(t, e.status, to)}
            </button>
          ))}
        </div>
      </div>

      {/* capacity bar */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <div className="flex items-center justify-between text-xs text-ink-muted mb-1">
          <span>{t('events.card.signupsLabel')} {approved}{e.capacity ? ` / ${e.capacity}` : ` / ${t('events.unlimited')}`}</span>
          {e.capacity ? <span>{pct}%</span> : null}
        </div>
        <div className="h-3 rounded-full bg-accent/10 overflow-hidden">
          <div className="h-full rounded-full bg-accent" style={{ width: e.capacity ? `${pct}%` : '0%' }} />
        </div>
        <div className="mt-2 text-xs text-ink-muted">{t('events.detail.approvedFeeSum')}<span className="font-semibold text-ink">{moneyRM(data.regStats.approvedFeeSum)}</span></div>
        {data.regStats.payment && (
          <div className="mt-1 text-xs text-ink-muted">
            {t('events.detail.received')} <span className="font-semibold text-[#3F6B2E]">{moneyRM(data.regStats.payment.paidSum)}</span>
            <span className="text-ink-faint"> · {t('events.detail.verified', { n: data.regStats.payment.verifiedCount })}{data.regStats.payment.waivedCount ? ` · ${t('events.detail.waived', { n: data.regStats.payment.waivedCount })}` : ''}{data.regStats.payment.proofCount ? ` · ${t('events.detail.pendingVerify', { n: data.regStats.payment.proofCount })}` : ''}</span>
            <span className="text-ink-faint"> · {t('events.detail.noTarget')}</span>
          </div>
        )}
      </div>

      {/* fees + team needs */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title={t('events.detail.feesTitle')}>
          {data.fees.length === 0 ? <p className="text-sm text-ink-muted">{t('events.detail.noFees')}</p> : (
            <ul className="space-y-1 text-sm">
              {data.fees.map((f) => (
                <li key={f.item} className="flex items-center justify-between">
                  <span className="text-ink">{f.label_cn || feeLabel(f.item, t)} <span className="text-[11px] text-ink-faint">{feeBillingLabel(f.item, f.billing, t)}</span></span>
                  <span className="font-medium text-ink">{moneyRM(f.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('events.detail.teamNeedsTitle')}>
          {data.teamNeeds.length === 0 ? <p className="text-sm text-ink-muted">{t('events.detail.none')}</p> : (
            <div className="flex flex-wrap gap-1.5">
              {data.teamNeeds.map((t) => {
                const short = t.approved < t.needed;
                return (
                  <span key={t.team_id} className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${short ? 'bg-[#FEF2F2] text-red-700' : 'pill-muted'}`}>
                    {t.name_cn} {t.approved}/{t.needed}{short ? ' ⚠' : ''}
                  </span>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* 公开报名 — publish a login-free self-registration link + QR (events:edit) */}
      {canEdit && <PublicRegCard enabled={!!e.public_registration_enabled} token={e.public_token ?? null} onToggle={togglePublicReg} onToast={flashToast} />}

      {/* 每餐人数统计 — kitchen prep counts (per_item meal events only) */}
      {mealPerItem && data.mealCounts && <MealStatsCard slots={data.mealSlots} counts={data.mealCounts} />}

      {/* registration queue */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {tabs.map(([tv, n]) => (
              <button key={tv} onClick={() => { setTab(tv); setRegPage(1); }}
                className={`px-3 py-1 rounded-full text-xs border transition ${tab === tv ? 'bg-accent/10 text-ink border-border' : 'text-ink-muted border-transparent hover:bg-accent/5'}`}>
                {tv === 'all' ? t('events.tab.all') : regStatusLabel(tv, t)}{n != null ? ` ${n}` : ''}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input value={regSearch} onChange={(ev2) => setRegSearch(ev2.target.value)} type="search"
              placeholder={t('events.regSearchPlaceholder')}
              className="w-44 text-xs p-1.5 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent" />
            <button disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  if (!(await exportCsv(t, e.code, id, tab, regQuery, teamName))) flashToast(t('events.toast.actionFailed'));
                } finally {
                  setExporting(false);
                }
              }}
              className="px-3 py-1 text-xs btn-secondary disabled:opacity-40">
              {exporting ? t('events.exporting') : t('events.exportCsv')}</button>
            {canEdit && e.status === 'open' && (
              <button onClick={() => setAddOpen(true)} className="px-3 py-1 text-xs btn-primary">{t('events.addReg')}</button>
            )}
          </div>
        </div>

        {regs.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted">{t('events.queue.empty')}</p>
        ) : (
          <ul>
            {regs.map((r) => {
              const sel = selectionsSummary(t, r.selections);
              const isOpen = expanded.has(r.id);
              return (
              <li id={`reg-${r.reg_no}`} key={r.id} className="px-4 py-3 border-b border-border last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {r.member_id ? (
                        <Link href={`/dashboard/members/${r.member_id}`} className="font-medium text-ink hover:text-accent-deep">{r.name}</Link>
                      ) : (
                        <span className="font-medium text-ink">{r.name}</span>
                      )}
                      {r.centreCode && <span className="text-[11px] px-2 py-0.5 rounded-full pill-gold">{r.centreCode}</span>}
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${REG_STATUS_STYLES[r.status] ?? ''}`}>{regStatusLabel(r.status, t)}</span>
                      {/* payment badge — independent of approval (separate tracks) */}
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${PAYMENT_STATUS_STYLES[r.payment_status] ?? PAYMENT_STATUS_STYLES.unpaid}`}>
                        {paymentStatusLabel(r.payment_status, t)}{r.payment_status === 'verified' && r.paid_amount != null ? ` ${moneyRM(r.paid_amount)}` : ''}
                      </span>
                      {sel && <span className="text-xs text-ink-muted">{sel}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      <span className="font-mono">{r.reg_no}</span>
                      {r.volunteer_team_id ? ` · ${t('events.row.team')}${teamName.get(r.volunteer_team_id) ?? '—'}` : ''}
                      {r.decidedByName ? ` · ${r.decidedByName}` : ''}
                      {r.decided_at ? ` ${r.decided_at.slice(0, 10)}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => toggleExpand(r.id)} className="font-semibold text-ink hover:text-accent-deep" title={t('events.row.expandFees')}>
                      {moneyRM(r.fee_total)} {isOpen ? '▴' : '▾'}
                    </button>
                    {canEdit && r.status !== 'cancelled' && (
                      <button onClick={() => setPayFor(r)} className="px-3 py-1 text-xs btn-secondary">{t('events.pay')}</button>
                    )}
                    {canOutreach && r.status !== 'cancelled' && (
                      <BringToOutreachButton eventId={id} name={r.name} phone={r.phone} />
                    )}
                    {canEdit && r.status === 'pending' && (
                      <>
                        <button disabled={busy === r.id} onClick={() => decide(r, 'approve')} className="px-3 py-1 text-xs btn-secondary disabled:opacity-40">{t('events.approve')}</button>
                        <button disabled={busy === r.id} onClick={() => setRejectFor(r)} className="px-3 py-1 text-xs text-red-700 border border-[#FCA5A5] rounded-full hover:bg-[#FEF2F2] disabled:opacity-40">{t('events.reject')}</button>
                      </>
                    )}
                    {canEdit && (r.status === 'pending' || r.status === 'approved') && selectionsEditable && (
                      <button disabled={busy === r.id} onClick={() => setEditReg(r)} className="px-3 py-1 text-xs btn-secondary disabled:opacity-40">{t('events.editSelections')}</button>
                    )}
                    {canEdit && (r.status === 'pending' || r.status === 'approved') && !selectionsEditable && (
                      <span className="text-[11px] text-ink-faint" title={t('events.row.lockTitle', { n: cutoffDays })}>{t('events.row.locked')}</span>
                    )}
                    {canEdit && (r.status === 'pending' || r.status === 'approved') && (
                      <button disabled={busy === r.id} onClick={() => { if (window.confirm(t('events.confirm.cancelReg'))) decide(r, 'cancel'); }} className="px-3 py-1 text-xs btn-secondary disabled:opacity-40">{t('events.cancel')}</button>
                    )}
                  </div>
                </div>
                {isOpen && r.fee_breakdown.length > 0 && (
                  <ul className="mt-2 ml-1 pl-3 border-l-2 border-border space-y-0.5 text-xs text-ink-muted">
                    {r.fee_breakdown.map((b) => (
                      <li key={b.item} className="flex justify-between max-w-xs">
                        <span>{b.label} × {b.qty}</span><span>{moneyRM(b.subtotal)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
              );
            })}
          </ul>
        )}
        {regTotalPages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-center gap-3">
            <button disabled={regPage <= 1} onClick={() => setRegPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 text-xs btn-secondary disabled:opacity-40">{t('events.prevPage')}</button>
            <span className="text-xs text-ink-muted">{t('events.pageInfo', { page: regPage, totalPages: regTotalPages, total: regTotal })}</span>
            <button disabled={regPage >= regTotalPages} onClick={() => setRegPage((p) => Math.min(regTotalPages, p + 1))}
              className="px-3 py-1 text-xs btn-secondary disabled:opacity-40">{t('events.nextPage')}</button>
          </div>
        )}
      </div>

      {rejectFor && (
        <RejectDialog reg={rejectFor} onClose={() => setRejectFor(null)}
          onReject={async (reason) => { await decide(rejectFor, 'reject', reason); setRejectFor(null); }} />
      )}
      {addOpen && (
        <AddRegDialog eventId={id} fees={data.fees} teams={teams} mealSlots={data.mealSlots} mealPerItem={mealPerItem}
          onClose={() => setAddOpen(false)}
          onDone={() => { setAddOpen(false); loadRegs(); loadEvent(); flashToast(t('events.toast.regDone')); }} />
      )}
      {editReg && (
        <AddRegDialog eventId={id} fees={data.fees} teams={teams} mealSlots={data.mealSlots} mealPerItem={mealPerItem}
          edit={{ regId: editReg.id, name: editReg.name, teamId: editReg.volunteer_team_id ?? '', selections: editReg.selections }}
          onClose={() => setEditReg(null)}
          onDone={() => { setEditReg(null); loadRegs(); loadEvent(); flashToast(t('events.toast.selectionsUpdated')); }} />
      )}
      {payFor && (
        <PaymentPanel reg={payFor} onClose={() => setPayFor(null)}
          onDone={(msg) => { setPayFor(null); loadRegs(); loadEvent(); flashToast(msg); }} />
      )}
    </div>
  );
}

// ── 每餐人数统计 card — approved-registration counts per (date, meal) + totals ──────
function MealStatsCard({ slots, counts }: { slots: MealSlot[]; counts: NonNullable<MealCounts> }) {
  const t = useT();
  const dates = [...new Set(slots.map((s) => s.slot_date))].sort();
  const offered = new Set(slots.filter((s) => s.offered).map((s) => mealSlotKey(s.slot_date, s.meal)));
  const colTotal = (meal: string) => dates.reduce((sum, d) => sum + (counts.perCell[mealSlotKey(d, meal)] ?? 0), 0);
  return (
    <div className="bg-surface border border-border rounded-2xl p-4">
      <h3 className="text-sm font-semibold font-serif text-ink mb-2">{t('events.mealStats.title')} <span className="text-[11px] font-normal text-ink-faint">{t('events.mealStats.sub')}</span></h3>
      {dates.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('events.mealStats.noMeals')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead>
              <tr className="text-[11px] text-ink-faint">
                <th className="px-3 py-1.5 text-left font-medium">{t('events.col.date')}</th>
                {MEAL_COLS.map((c) => <th key={c.meal} className="px-3 py-1.5 font-medium w-14">{mealColLabel(c.meal, t)}</th>)}
                <th className="px-3 py-1.5 font-medium w-16">{t('events.mealStats.dayTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => (
                <tr key={d} className="border-t border-border">
                  <td className="px-3 py-1.5 whitespace-nowrap text-ink">{d.slice(5)} <span className="text-[11px] text-ink-faint">{weekdayCn(d)}</span></td>
                  {MEAL_COLS.map((c) => {
                    const key = mealSlotKey(d, c.meal);
                    return (
                      <td key={c.meal} className="px-3 py-1.5 text-center">
                        {offered.has(key) ? <span className="text-ink font-medium">{counts.perCell[key] ?? 0}</span> : <span className="text-ink-faint">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-center font-semibold text-ink">{counts.perDay[d] ?? 0}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border bg-surface-soft">
                <td className="px-3 py-1.5 font-semibold text-ink">{t('events.mealStats.total')}</td>
                {MEAL_COLS.map((c) => <td key={c.meal} className="px-3 py-1.5 text-center font-semibold text-[#8A5A1E]">{colTotal(c.meal)}</td>)}
                <td className="px-3 py-1.5 text-center font-bold text-ink">{counts.total}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── reject modal (reason required) ───────────────────────────────────────────
function RejectDialog({ reg, onClose, onReject }: { reg: RegRow; onClose: () => void; onReject: (reason: string) => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-surface rounded-2xl w-full max-w-sm p-5" onClick={(ev) => ev.stopPropagation()}>
        <h3 className="text-base font-semibold font-serif text-ink mb-1">{t('events.reject.title')}</h3>
        <p className="text-xs text-ink-muted mb-3 font-mono">{reg.reg_no} · {reg.name}</p>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t('events.reject.placeholder')}
          className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink resize-y focus:outline-none focus:border-accent" />
        <div className="mt-3 flex items-center gap-2">
          <button disabled={saving || !reason.trim()} onClick={() => { setSaving(true); onReject(reason.trim()); }}
            className="px-4 py-1.5 text-sm text-white bg-red-600 rounded-full hover:bg-red-700 disabled:opacity-50">{t('events.reject.confirm')}</button>
          <button onClick={onClose} className="px-4 py-1.5 text-sm btn-secondary">{t('events.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

// ── 代报名 / 修改选项 dialog — member (search or preset) + selections + LIVE preview ──
// mode: create = member search + POST; edit = preset member + PATCH .../selections. When
// the meal fee bills per_item the 餐 input is the MEAL GRID (offered cells only).
function AddRegDialog({ eventId, fees, teams, mealSlots, mealPerItem, edit, onClose, onDone }: {
  eventId: string; fees: FeeRow[]; teams: Team[]; mealSlots: MealSlot[]; mealPerItem: boolean;
  edit?: { regId: string; name: string; teamId: string; selections: Record<string, unknown> };
  onClose: () => void; onDone: () => void;
}) {
  const t = useT();
  const isEdit = !!edit;
  const enabled = new Set(fees.map((f) => f.item));
  const feeItems: FeeItem[] = fees.map((f) => ({ item: f.item as FeeItem['item'], label_cn: f.label_cn, amount: Number(f.amount), billing: f.billing as FeeItem['billing'] }));
  const init = edit?.selections ?? {};
  const initUniform = (init.uniform ?? {}) as { size?: string; qty?: number };

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; centreCode: string | null }[]>([]);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(edit ? { id: '', name: edit.name } : null);
  const [teamId, setTeamId] = useState(edit?.teamId ?? '');
  const [mealDays, setMealDays] = useState(init.meal_days ? String(init.meal_days) : '');
  const [meals, setMeals] = useState<Set<string>>(new Set(Array.isArray(init.meals) ? (init.meals as unknown[]).filter((x): x is string => typeof x === 'string') : []));
  const [nights, setNights] = useState(init.nights ? String(init.nights) : '');
  const [transfer, setTransfer] = useState(init.transfer === true);
  const [uniformSize, setUniformSize] = useState(initUniform.size ?? '');
  const [uniformQty, setUniformQty] = useState(initUniform.qty ? String(initUniform.qty) : '');
  const [otherQty, setOtherQty] = useState(init.other_qty ? String(init.other_qty) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupe, setDupe] = useState<string | null>(null);

  // member search-as-you-type (active only), debounced. Skipped in edit mode.
  useEffect(() => {
    if (isEdit) return;
    const q = search.trim();
    if (!q) { setResults([]); return; }
    const timer = setTimeout(() => {
      fetch(`/api/dashboard/members?search=${encodeURIComponent(q)}&status=active&limit=8`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j) setResults((j.members ?? []).map((m: { id: string; name_cn: string | null; name_en: string | null; centre: { code: string } | null }) => ({ id: m.id, name: m.name_cn || m.name_en || t('events.reg.noName'), centreCode: m.centre?.code ?? null })));
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [search, isEdit, t]);

  const selections: Selections = {
    meal_days: !mealPerItem && mealDays ? Number(mealDays) : undefined,
    meals: mealPerItem ? [...meals] : undefined,
    nights: nights ? Number(nights) : undefined,
    transfer,
    uniform: uniformQty ? { size: uniformSize || undefined, qty: Number(uniformQty) } : undefined,
    other_qty: otherQty ? Number(otherQty) : undefined,
  };
  const preview = computeFees(feeItems, selections);

  const submit = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError(null);
    setDupe(null);
    try {
      const res = isEdit
        ? await fetch(`/api/dashboard/registrations/${edit!.regId}/selections`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selections }),
          })
        : await fetch(`/api/dashboard/events/${eventId}/registrations`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ member_id: selected.id, volunteer_team_id: teamId || null, selections }),
          });
      const j = await res.json().catch(() => null);
      if (res.status === 409) { setDupe(j?.existing?.reg_no ?? null); setError(t('events.reg.dupe')); return; }
      if (!res.ok) { setError(j?.error ?? (isEdit ? t('events.reg.saveFailed') : t('events.reg.regFailed'))); return; }
      onDone();
    } catch {
      setError(isEdit ? t('events.reg.saveFailedRetry') : t('events.reg.regFailedRetry'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-surface rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5" onClick={(ev) => ev.stopPropagation()}>
        <h3 className="text-base font-semibold font-serif text-ink mb-3">{isEdit ? t('events.editSelections') : t('events.addRegTitle')}</h3>

        {/* member — search (create) or preset name (edit) */}
        {isEdit ? (
          <div className="text-sm text-ink">{t('events.reg.member')}<span className="font-medium">{edit!.name}</span></div>
        ) : !selected ? (
          <div>
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('events.reg.searchPlaceholder')}
              className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent" />
            {results.length > 0 && (
              <ul className="mt-1 border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                {results.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => setSelected({ id: m.id, name: m.name })} className="w-full text-left px-3 py-2 text-sm hover:bg-accent/5 flex items-center justify-between">
                      <span className="text-ink">{m.name}</span>
                      {m.centreCode && <span className="text-[11px] text-ink-faint">{m.centreCode}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink">{t('events.reg.member')}<span className="font-medium">{selected.name}</span></span>
            <button onClick={() => setSelected(null)} className="text-xs text-accent-deep hover:underline">{t('events.reg.change')}</button>
          </div>
        )}

        {selected && (
          <div className="mt-4 space-y-3">
            {!isEdit && (
              <label className="block">
                <span className="block u-label mb-1">{t('events.reg.teamOptional')}</span>
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
                  className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent">
                  <option value="">{t('events.reg.noTeam')}</option>
                  {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name_cn}</option>)}
                </select>
              </label>
            )}

            {/* meal grid (per_item) — replaces the 用餐天数 input */}
            {enabled.has('meal') && mealPerItem && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="u-label">{t('events.reg.mealLabel')} <span className="text-ink-faint">{t('events.reg.mealsSelected', { n: meals.size })}</span></span>
                </div>
                <MealPickGrid slots={mealSlots} selected={meals} onChange={setMeals} />
              </div>
            )}

            {/* selection inputs — ONLY for items enabled on this event */}
            <div className="grid grid-cols-2 gap-3">
              {enabled.has('meal') && !mealPerItem && <Num label={t('events.reg.mealDays')} value={mealDays} onChange={setMealDays} />}
              {enabled.has('accommodation') && <Num label={t('events.reg.nights')} value={nights} onChange={setNights} />}
              {enabled.has('transfer') && (
                <label className="flex items-center gap-2 text-sm text-ink col-span-2">
                  <input type="checkbox" checked={transfer} onChange={(e) => setTransfer(e.target.checked)} /> {t('events.reg.transfer')}
                </label>
              )}
              {enabled.has('uniform') && (
                <>
                  <label className="block">
                    <span className="block u-label mb-1">{t('events.reg.uniformSize')}</span>
                    <input value={uniformSize} onChange={(e) => setUniformSize(e.target.value)} placeholder="M"
                      className="w-full text-sm p-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent" />
                  </label>
                  <Num label={t('events.reg.uniformQty')} value={uniformQty} onChange={setUniformQty} />
                </>
              )}
              {enabled.has('other') && <Num label={t('events.reg.otherQty')} value={otherQty} onChange={setOtherQty} />}
            </div>

            {/* live fee preview */}
            <div className="rounded-lg bg-accent/10 p-3 text-sm">
              {preview.breakdown.length === 0 ? <p className="text-ink-muted">{t('events.reg.noFee')}</p> : (
                <ul className="space-y-0.5">
                  {preview.breakdown.map((b) => (
                    <li key={b.item} className="flex justify-between text-ink-muted">
                      <span>{b.label} × {b.qty}</span><span>{moneyRM(b.subtotal)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-1 pt-1 border-t border-gold-border flex justify-between font-semibold text-ink">
                <span>{t('events.total')}</span><span>{moneyRM(preview.total)}</span>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600">
                {error}
                {dupe && <> · <Link href={`#reg-${dupe}`} className="underline text-accent-deep" onClick={onClose}>{t('events.reg.existing', { no: dupe })}</Link></>}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button disabled={saving} onClick={submit} className="px-5 py-2 text-sm btn-primary">
                {saving ? t('events.saving') : isEdit ? t('events.reg.saveSelections') : t('events.reg.submit')}
              </button>
              <button onClick={onClose} className="px-5 py-2 text-sm btn-secondary">{t('events.cancel')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Meal picker — dates × 早/午/晚; only OFFERED cells are clickable. 整天 toggles a row's
// offered cells; 全选/清空 select/clear every offered cell. Zero selected is valid.
function MealPickGrid({ slots, selected, onChange }: { slots: MealSlot[]; selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const t = useT();
  const dates = [...new Set(slots.map((s) => s.slot_date))].sort();
  const offered = new Set(slots.filter((s) => s.offered).map((s) => mealSlotKey(s.slot_date, s.meal)));
  const allOffered = [...offered];

  const toggle = (key: string) => {
    if (!offered.has(key)) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  };
  const toggleRow = (date: string) => {
    const keys = MEAL_COLS.map((c) => mealSlotKey(date, c.meal)).filter((k) => offered.has(k));
    if (keys.length === 0) return;
    const anyUnset = keys.some((k) => !selected.has(k));
    const next = new Set(selected);
    for (const k of keys) { if (anyUnset) next.add(k); else next.delete(k); }
    onChange(next);
  };

  if (dates.length === 0) return <p className="text-xs text-ink-muted">{t('events.mealPick.noMeals')}</p>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <button type="button" onClick={() => onChange(new Set(allOffered))} className="px-2.5 py-0.5 text-[11px] btn-secondary">{t('events.selectAll')}</button>
        <button type="button" onClick={() => onChange(new Set())} className="px-2.5 py-0.5 text-[11px] btn-secondary">{t('events.clearAll')}</button>
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse w-full">
          <thead>
            <tr className="text-[11px] text-ink-faint">
              <th className="px-2 py-1 text-left font-medium">{t('events.col.date')}</th>
              {MEAL_COLS.map((c) => <th key={c.meal} className="px-1 py-1 font-medium">{mealColLabel(c.meal, t)}</th>)}
              <th className="px-1 py-1 font-medium w-12">{t('events.mealPick.wholeDay')}</th>
            </tr>
          </thead>
          <tbody>
            {dates.map((d) => (
              <tr key={d} className="border-t border-border">
                <td className="px-2 py-1 whitespace-nowrap text-ink">{d.slice(5)} <span className="text-[11px] text-ink-faint">{weekdayCn(d)}</span></td>
                {MEAL_COLS.map((c) => {
                  const key = mealSlotKey(d, c.meal);
                  const isOffered = offered.has(key);
                  const isSel = selected.has(key);
                  return (
                    <td key={c.meal} className="px-1 py-1 text-center">
                      {isOffered ? (
                        <button type="button" onClick={() => toggle(key)}
                          className={`w-9 py-1 rounded-md text-xs transition ${isSel ? 'bg-accent text-white' : 'bg-accent/10 text-accent-deep border border-border hover:bg-accent/20'}`}>
                          {isSel ? '✓' : mealColLabel(c.meal, t)}
                        </button>
                      ) : (
                        <span className="inline-block w-9 py-1 rounded-md text-xs text-[#C9B892] border border-dashed border-[#DCCDA2]">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-1 py-1 text-center">
                  <button type="button" onClick={() => toggleRow(d)} className="px-2 py-0.5 text-[11px] text-ink-muted border border-border rounded-md hover:bg-accent/5">{t('events.mealPick.allDay')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block u-label mb-1">{label}</span>
      <input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm p-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent" />
    </label>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded-2xl p-4">
      <h3 className="text-sm font-semibold font-serif text-ink mb-2">{title}</h3>
      {children}
    </section>
  );
}

// 付款 panel — view the receipt (short-lived signed URL) + 核实/豁免/撤销. Payment is a
// track SEPARATE from approval and never coercive: no overdue styling, 已豁免 is first-class.
function PaymentPanel({ reg, onClose, onDone }: { reg: RegRow; onClose: () => void; onDone: (msg: string) => void }) {
  const t = useT();
  const [proof, setProof] = useState<{ url: string; isPdf: boolean } | null>(null);
  const [proofState, setProofState] = useState<'idle' | 'loading' | 'none' | 'error'>(reg.has_proof ? 'loading' : 'none');
  const [amount, setAmount] = useState<string>(reg.paid_amount != null ? String(reg.paid_amount) : String(reg.fee_total));
  const [note, setNote] = useState(reg.payment_note ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!reg.has_proof) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/dashboard/registrations/${reg.id}/proof-url`);
        if (!alive) return;
        if (res.ok) { setProof(await res.json()); setProofState('idle'); }
        else setProofState(res.status === 404 ? 'none' : 'error');
      } catch { if (alive) setProofState('error'); }
    })();
    return () => { alive = false; };
  }, [reg.id, reg.has_proof]);

  const act = async (action: 'verify' | 'waive' | 'revoke') => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { action };
      if (action === 'verify') { body.paid_amount = amount; if (note.trim()) body.note = note.trim(); }
      if (action === 'waive' && note.trim()) body.note = note.trim();
      const res = await fetch(`/api/dashboard/registrations/${reg.id}/payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (res.ok) onDone(action === 'verify' ? t('events.pay.verifiedMsg') : action === 'waive' ? t('events.pay.waivedMsg') : t('events.pay.revokedMsg'));
      else { const j = await res.json().catch(() => null); onDone(j?.error ?? t('events.toast.actionFailed')); }
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-surface w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold font-serif text-ink">{t('events.pay')} · <span className="font-mono text-sm">{reg.reg_no}</span></h3>
          <button onClick={onClose} className="text-ink-muted text-sm">{t('events.close')}</button>
        </div>
        <p className="text-xs text-ink-muted mb-3">
          {t('events.pay.current')}<span className={`px-2 py-0.5 rounded-full ${PAYMENT_STATUS_STYLES[reg.payment_status] ?? PAYMENT_STATUS_STYLES.unpaid}`}>{paymentStatusLabel(reg.payment_status, t)}</span>
          <span className="ml-2">{t('events.feeWord')} {moneyRM(reg.fee_total)}</span>
        </p>

        {/* receipt viewer */}
        {reg.has_proof && (
          <div className="mb-3">
            {proofState === 'loading' && <p className="text-xs text-ink-muted">{t('events.pay.loadingProof')}</p>}
            {proofState === 'error' && <p className="text-xs text-[#B4402E]">{t('events.pay.proofFailed')}</p>}
            {proof && !proof.isPdf && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={proof.url} alt={t('events.pay.proofAlt')} className="w-full rounded-xl border border-border" />
            )}
            {proof && proof.isPdf && (
              <a href={proof.url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline">{t('events.pay.openPdf')}</a>
            )}
          </div>
        )}
        {!reg.has_proof && <p className="text-xs text-ink-faint mb-3">{t('events.pay.noProof')}</p>}

        {/* actions */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-ink-muted mb-1">{t('events.pay.verifyAmount')}</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
              className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">{t('events.pay.noteLabel')}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('events.pay.notePlaceholder')}
              className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button disabled={busy} onClick={() => act('verify')} className="flex-1 rounded-xl bg-[#3F6B2E] text-white py-2 text-sm font-medium disabled:opacity-50">{t('events.pay.verify')}</button>
            <button disabled={busy} onClick={() => act('waive')} className="flex-1 rounded-xl bg-[#6B5B8A] text-white py-2 text-sm font-medium disabled:opacity-50">{t('events.pay.waive')}</button>
          </div>
          {(reg.payment_status === 'verified' || reg.payment_status === 'waived') && (
            <button disabled={busy} onClick={() => act('revoke')} className="w-full rounded-xl border border-border text-ink-muted py-2 text-sm disabled:opacity-50">{t('events.pay.revoke')}</button>
          )}
        </div>
      </div>
    </div>
  );
}

// CSV of the FULL filtered list (BOM for Excel) — re-fetches every page of the current
// tab + search in CSV_BATCH-sized requests so the export never depends on the visible
// page. Returns false on any fetch failure (nothing is downloaded).
async function exportCsv(t: TFunc, code: string, eventId: string, tab: string, search: string, teamName: Map<string, string>): Promise<boolean> {
  const regs: RegRow[] = [];
  for (let page = 1; ; page++) {
    const sp = new URLSearchParams({ page: String(page), limit: String(CSV_BATCH) });
    if (tab !== 'all') sp.set('status', tab);
    if (search) sp.set('search', search);
    let j: { registrations?: RegRow[]; totalPages?: number } | null = null;
    try {
      const res = await fetch(`/api/dashboard/events/${eventId}/registrations?${sp}`);
      if (res.ok) j = await res.json();
    } catch {
      /* fall through to failure */
    }
    if (!j) return false;
    regs.push(...(j.registrations ?? []));
    if (page >= (j.totalPages ?? 1)) break;
  }
  const header = [t('events.csv.regNo'), t('events.csv.name'), t('events.csv.centre'), t('events.csv.team'), t('events.csv.selections'), t('events.csv.fee'), t('events.csv.status'), t('events.csv.decider'), t('events.csv.decideDate')];
  const rows = regs.map((r) => [
    r.reg_no, r.name, r.centreCode ?? '', r.volunteer_team_id ? teamName.get(r.volunteer_team_id) ?? '' : '',
    selectionsSummary(t, r.selections), String(r.fee_total), regStatusLabel(r.status, t),
    r.decidedByName ?? '', r.decided_at ? r.decided_at.slice(0, 10) : '',
  ]);
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = '﻿' + [header, ...rows].map((row) => row.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${code}-${t('events.csv.filenameTag')}-${tab}-${new Date().toLocaleDateString('en-CA')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

// A crisp inline-SVG QR of `text` (dep-free renderer, src/lib/qr.ts). 4-module quiet zone.
function QrSvg({ text, px = 176 }: { text: string; px?: number }) {
  const t = useT();
  const mods = useMemo(() => { try { return qrModules(text, 'M'); } catch { return null; } }, [text]);
  if (!mods) return null;
  const n = mods.length, quiet = 4, dim = n + quiet * 2;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (mods[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  return (
    <svg width={px} height={px} viewBox={`0 0 ${dim} ${dim}`} shapeRendering="crispEdges" role="img" aria-label={t('events.public.qrAlt')}>
      <rect width={dim} height={dim} fill="#FFFFFF" />
      <path d={d} fill="#2B2314" />
    </svg>
  );
}

// 公开报名 affordance: toggle → PATCH {public_registration_enabled}; when on, show the
// public /r/<token> URL, a copy-link button, and a scannable QR of that URL.
function PublicRegCard({
  enabled, token, onToggle, onToast,
}: { enabled: boolean; token: string | null; onToggle: (v: boolean) => void; onToast: (m: string) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = token ? `${origin}/r/${token}` : '';

  const toggle = async (v: boolean) => { setBusy(true); try { await onToggle(v); } finally { setBusy(false); } };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); onToast(t('events.public.copied')); }
    catch { onToast(t('events.public.copyFailed')); }
  };

  return (
    <section className="bg-surface border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold font-serif text-ink">{t('events.public.title')}</h3>
          <p className="text-xs text-ink-muted mt-0.5">{t('events.public.desc')}</p>
        </div>
        <button role="switch" aria-checked={enabled} disabled={busy} onClick={() => toggle(!enabled)}
          className={`shrink-0 w-12 h-7 rounded-full transition relative ${enabled ? 'bg-accent' : 'bg-border-strong'} disabled:opacity-50`}>
          <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {enabled && url && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <input readOnly value={url} onFocus={(e) => e.target.select()}
                className="flex-1 min-w-0 rounded-lg border border-border-strong bg-accent/10 px-3 py-2 text-xs font-mono text-ink outline-none" />
              <button onClick={copy} className="shrink-0 px-3 py-2 text-xs text-white bg-accent rounded-lg hover:bg-accent-strong">{t('events.public.copyLink')}</button>
            </div>
            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-xs text-accent hover:underline">{t('events.public.openInNewTab')}</a>
          </div>
          <div className="justify-self-center rounded-xl border border-border p-2 bg-surface">
            <QrSvg text={url} />
          </div>
        </div>
      )}
      {enabled && !url && (
        <p className="mt-3 text-xs text-[#B4402E]">{t('events.public.notReady')}</p>
      )}
    </section>
  );
}
