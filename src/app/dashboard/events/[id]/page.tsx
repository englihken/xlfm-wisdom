// src/app/dashboard/events/[id]/page.tsx
// 活动详情 + 报名审核. Header (badges/dates/capacity + 编辑 + status-action buttons from
// the server matrix), fee & team-need summary cards, and the registration queue with
// approve/reject/cancel + 代报名 (live client-side fee preview) + CSV export. The queue
// rows show selections chips, an expandable fee breakdown, a member-profile link, and
// the decider name+time (B2.1 added those fields to the registrations list response).

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { computeFees, type FeeItem, type Selections } from '@/lib/event-fees';
import {
  EVENT_TYPE_LABELS, STATUS_LABELS, STATUS_STYLES, REG_STATUS_LABELS,
  FEE_LABEL, BILLING_LABELS, moneyRM,
} from '@/lib/events-display';

type FeeRow = { item: string; label_cn: string | null; amount: number; billing: string; sort?: number };
type TeamNeed = { team_id: string; name_cn: string; needed: number; approved: number };
type Detail = {
  event: Record<string, unknown> & {
    id: string; code: string; title: string; event_type: string; status: string;
    starts_on: string; ends_on: string | null; location: string | null; capacity: number | null;
    reg_deadline: string | null; organizing_centre?: { name_cn: string; code: string } | null;
  };
  fees: FeeRow[];
  teamNeeds: TeamNeed[];
  regStats: { counts: { pending: number; approved: number; rejected: number; cancelled: number }; approvedFeeSum: number };
};
type BreakdownLine = { item: string; label: string; amount: number; qty: number; subtotal: number };
type RegRow = {
  id: string; reg_no: string; member_id: string | null; name: string; centreCode: string | null;
  volunteer_team_id: string | null; selections: Record<string, unknown>;
  fee_total: number; fee_breakdown: BreakdownLine[];
  status: string; decided_by: string | null; decidedByName: string | null; decided_at: string | null;
};
type Team = { id: string; name_cn: string; slug: string };

// Compact selections summary chips: 🍚N天 🏨N晚 🚐 👕size×qty 🎁×N
function selectionsSummary(sel: Record<string, unknown> | undefined): string {
  if (!sel) return '';
  const parts: string[] = [];
  const md = Number(sel.meal_days) || 0;
  const ni = Number(sel.nights) || 0;
  if (md) parts.push(`🍚${md}天`);
  if (ni) parts.push(`🏨${ni}晚`);
  if (sel.transfer === true) parts.push('🚐');
  const u = sel.uniform as { size?: string; qty?: number } | undefined;
  if (u?.qty) parts.push(`👕${u.size ?? ''}×${u.qty}`);
  const oq = Number(sel.other_qty) || 0;
  if (oq) parts.push(`🎁×${oq}`);
  return parts.join(' ');
}

// The status-transition labels (matches the server matrix in src/lib/events.ts).
function transitionLabel(from: string, to: string): string {
  if (to === 'open') return from === 'draft' ? '发布' : '重新开放';
  if (to === 'closed') return '关闭报名';
  if (to === 'full') return '标记满额';
  if (to === 'completed') return '标记结束';
  return to;
}
const STATUS_NEXT: Record<string, string[]> = {
  draft: ['open'], open: ['full', 'closed', 'completed'], full: ['open', 'completed'], closed: ['completed'], completed: [],
};

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ErpGate active="events" module="events" titleSuffix="详情">
      {(me) => <Detail me={me} id={id} />}
    </ErpGate>
  );
}

function Detail({ me, id }: { me: ErpMe; id: string }) {
  const canEdit = grantAllows(me.grants, 'events', 'edit');
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<Team[]>([]);
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected' | 'cancelled' | 'all'>('pending');
  const [regs, setRegs] = useState<RegRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<RegRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
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

  const loadRegs = useCallback(async () => {
    try {
      const qs = tab === 'all' ? '' : `?status=${tab}`;
      const res = await fetch(`/api/dashboard/events/${id}/registrations${qs}`);
      if (res.ok) {
        const j = await res.json();
        setRegs(j.registrations ?? []);
      }
    } catch {
      /* ignore */
    }
  }, [id, tab]);

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
        flashToast(j?.error ?? '操作失败');
        return;
      }
      await Promise.all([loadRegs(), loadEvent()]); // reload event to catch capacity→full
      if (decision === 'approve') {
        // The decision response doesn't include event status, so we refetched; detect full.
        flashToast('已批准');
      }
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = async (to: string) => {
    if (!data) return;
    if (!window.confirm(`确定将活动状态变更为「${STATUS_LABELS[to]}」？`)) return;
    const res = await fetch(`/api/dashboard/events/${id}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }),
    });
    if (res.ok) { flashToast(`状态已更新为「${STATUS_LABELS[to]}」`); loadEvent(); }
    else { const j = await res.json().catch(() => null); flashToast(j?.error ?? '操作失败'); }
  };

  if (loading) return <p className="max-w-4xl mx-auto px-4 py-10 text-sm text-[#8B6F47]">加载中…</p>;
  if (!data) return <p className="max-w-4xl mx-auto px-4 py-10 text-sm text-[#8B6F47]">无法加载该活动。</p>;

  const e = data.event;
  const approved = data.regStats.counts.approved;
  const pct = e.capacity ? Math.min(100, Math.round((approved / e.capacity) * 100)) : 0;
  const nextStatuses = STATUS_NEXT[e.status] ?? [];
  const tabs: [typeof tab, number | null][] = [
    ['pending', data.regStats.counts.pending], ['approved', data.regStats.counts.approved],
    ['rejected', data.regStats.counts.rejected], ['cancelled', data.regStats.counts.cancelled], ['all', null],
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#583A0F] text-white text-sm shadow-lg">{toast}</div>
      )}

      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-bold text-[#583A0F]">{e.title}</h2>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLES[e.status] ?? ''}`}>{STATUS_LABELS[e.status] ?? e.status}</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#FAEFD0] text-[#8A5A1E]">{EVENT_TYPE_LABELS[e.event_type] ?? e.event_type}</span>
          </div>
          <p className="mt-1 text-sm text-[#8B6F47]">
            <span className="font-mono">{e.code}</span>
            {e.organizing_centre ? ` · ${e.organizing_centre.name_cn}` : ''}
            {` · ${e.starts_on}${e.ends_on && e.ends_on !== e.starts_on ? ` — ${e.ends_on}` : ''}`}
            {e.location ? ` · ${e.location}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (e.status === 'draft' || e.status === 'open') && (
            <Link href={`/dashboard/events/${id}/edit`} className="px-4 py-1.5 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition">编辑</Link>
          )}
          {canEdit && nextStatuses.map((to) => (
            <button key={to} onClick={() => changeStatus(to)}
              className="px-4 py-1.5 text-sm text-white bg-[#D89938] rounded-full hover:bg-[#A87929] transition">
              {transitionLabel(e.status, to)}
            </button>
          ))}
        </div>
      </div>

      {/* capacity bar */}
      <div className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl p-4">
        <div className="flex items-center justify-between text-xs text-[#8B6F47] mb-1">
          <span>报名 {approved}{e.capacity ? ` / ${e.capacity}` : ' / 不限'}</span>
          {e.capacity ? <span>{pct}%</span> : null}
        </div>
        <div className="h-2.5 rounded-full bg-[#FAEFD0] overflow-hidden">
          <div className="h-full rounded-full bg-[#D89938]" style={{ width: e.capacity ? `${pct}%` : '0%' }} />
        </div>
        <div className="mt-2 text-xs text-[#8B6F47]">已批费用合计：<span className="font-semibold text-[#583A0F]">{moneyRM(data.regStats.approvedFeeSum)}</span></div>
      </div>

      {/* fees + team needs */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="费率 Fees">
          {data.fees.length === 0 ? <p className="text-sm text-[#8B6F47]">未设置收费</p> : (
            <ul className="space-y-1 text-sm">
              {data.fees.map((f) => (
                <li key={f.item} className="flex items-center justify-between">
                  <span className="text-[#583A0F]">{f.label_cn || FEE_LABEL[f.item] || f.item} <span className="text-[11px] text-[#B89968]">{BILLING_LABELS[f.billing]}</span></span>
                  <span className="font-medium text-[#583A0F]">{moneyRM(f.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="团队需求 Team needs">
          {data.teamNeeds.length === 0 ? <p className="text-sm text-[#8B6F47]">无</p> : (
            <div className="flex flex-wrap gap-1.5">
              {data.teamNeeds.map((t) => {
                const short = t.approved < t.needed;
                return (
                  <span key={t.team_id} className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${short ? 'bg-[#FEF2F2] text-red-700' : 'bg-white border border-[#EFE3BF] text-[#8B6F47]'}`}>
                    {t.name_cn} {t.approved}/{t.needed}{short ? ' ⚠' : ''}
                  </span>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* registration queue */}
      <div className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#EFE3BF] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {tabs.map(([t, n]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1 rounded-full text-xs border transition ${tab === t ? 'bg-[#FAEFD0] text-[#583A0F] border-[#EFE3BF]' : 'text-[#8B6F47] border-transparent hover:bg-[#FAEFD0]/60'}`}>
                {t === 'all' ? '全部' : REG_STATUS_LABELS[t]}{n != null ? ` ${n}` : ''}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => exportCsv(e.code, tab, regs, teamName)}
              className="px-3 py-1 text-xs text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0]">导出 CSV</button>
            {canEdit && e.status === 'open' && (
              <button onClick={() => setAddOpen(true)} className="px-3 py-1 text-xs text-white bg-[#D89938] rounded-full hover:bg-[#A87929]">＋代报名</button>
            )}
          </div>
        </div>

        {regs.length === 0 ? (
          <p className="p-6 text-sm text-[#8B6F47]">暂无报名</p>
        ) : (
          <ul>
            {regs.map((r) => {
              const sel = selectionsSummary(r.selections);
              const isOpen = expanded.has(r.id);
              return (
              <li id={`reg-${r.reg_no}`} key={r.id} className="px-4 py-3 border-b border-[#EFE3BF] last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {r.member_id ? (
                        <Link href={`/dashboard/members/${r.member_id}`} className="font-medium text-[#583A0F] hover:text-[#A87929]">{r.name}</Link>
                      ) : (
                        <span className="font-medium text-[#583A0F]">{r.name}</span>
                      )}
                      {r.centreCode && <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#FAEFD0] text-[#8A5A1E]">{r.centreCode}</span>}
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${REG_STATUS_STYLE(r.status)}`}>{REG_STATUS_LABELS[r.status] ?? r.status}</span>
                      {sel && <span className="text-xs text-[#8B6F47]">{sel}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-[#8B6F47]">
                      <span className="font-mono">{r.reg_no}</span>
                      {r.volunteer_team_id ? ` · 组：${teamName.get(r.volunteer_team_id) ?? '—'}` : ''}
                      {r.decidedByName ? ` · ${r.decidedByName}` : ''}
                      {r.decided_at ? ` ${r.decided_at.slice(0, 10)}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => toggleExpand(r.id)} className="font-semibold text-[#583A0F] hover:text-[#A87929]" title="展开费用明细">
                      {moneyRM(r.fee_total)} {isOpen ? '▴' : '▾'}
                    </button>
                    {canEdit && r.status === 'pending' && (
                      <>
                        <button disabled={busy === r.id} onClick={() => decide(r, 'approve')} className="px-3 py-1 text-xs text-[#A87929] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] disabled:opacity-40">✓批准</button>
                        <button disabled={busy === r.id} onClick={() => setRejectFor(r)} className="px-3 py-1 text-xs text-red-700 border border-[#FCA5A5] rounded-full hover:bg-[#FEF2F2] disabled:opacity-40">✗拒绝</button>
                      </>
                    )}
                    {canEdit && (r.status === 'pending' || r.status === 'approved') && (
                      <button disabled={busy === r.id} onClick={() => { if (window.confirm('确定取消此报名？')) decide(r, 'cancel'); }} className="px-3 py-1 text-xs text-[#8B6F47] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] disabled:opacity-40">取消</button>
                    )}
                  </div>
                </div>
                {isOpen && r.fee_breakdown.length > 0 && (
                  <ul className="mt-2 ml-1 pl-3 border-l-2 border-[#EFE3BF] space-y-0.5 text-xs text-[#8B6F47]">
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
      </div>

      {rejectFor && (
        <RejectDialog reg={rejectFor} onClose={() => setRejectFor(null)}
          onReject={async (reason) => { await decide(rejectFor, 'reject', reason); setRejectFor(null); }} />
      )}
      {addOpen && (
        <AddRegDialog eventId={id} fees={data.fees} teams={teams} onClose={() => setAddOpen(false)}
          onDone={() => { setAddOpen(false); loadRegs(); loadEvent(); flashToast('已代报名'); }} />
      )}
    </div>
  );
}

function REG_STATUS_STYLE(s: string): string {
  return s === 'pending' ? 'bg-[#FEF2F2] text-red-700'
    : s === 'approved' ? 'bg-[#E7F0E0] text-[#3F6B2E]'
    : s === 'rejected' ? 'bg-white border border-[#EFE3BF] text-[#8B6F47]'
    : 'bg-white border border-[#EFE3BF] text-[#B89968]';
}

// ── reject modal (reason required) ───────────────────────────────────────────
function RejectDialog({ reg, onClose, onReject }: { reg: RegRow; onClose: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-[#FFFEF6] rounded-2xl w-full max-w-sm p-5" onClick={(ev) => ev.stopPropagation()}>
        <h3 className="text-base font-semibold text-[#583A0F] mb-1">拒绝报名</h3>
        <p className="text-xs text-[#8B6F47] mb-3 font-mono">{reg.reg_no} · {reg.name}</p>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="拒绝原因（必填）"
          className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] resize-y focus:outline-none focus:border-[#D89938]" />
        <div className="mt-3 flex items-center gap-2">
          <button disabled={saving || !reason.trim()} onClick={() => { setSaving(true); onReject(reason.trim()); }}
            className="px-4 py-1.5 text-sm text-white bg-red-600 rounded-full hover:bg-red-700 disabled:opacity-50">确认拒绝</button>
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0]">取消</button>
        </div>
      </div>
    </div>
  );
}

// ── 代报名 dialog — member search + selections + LIVE fee preview ─────────────
function AddRegDialog({ eventId, fees, teams, onClose, onDone }: {
  eventId: string; fees: FeeRow[]; teams: Team[]; onClose: () => void; onDone: () => void;
}) {
  const enabled = new Set(fees.map((f) => f.item));
  const feeItems: FeeItem[] = fees.map((f) => ({ item: f.item as FeeItem['item'], label_cn: f.label_cn, amount: Number(f.amount), billing: f.billing as FeeItem['billing'] }));

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; centreCode: string | null }[]>([]);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [teamId, setTeamId] = useState('');
  const [mealDays, setMealDays] = useState('');
  const [nights, setNights] = useState('');
  const [transfer, setTransfer] = useState(false);
  const [uniformSize, setUniformSize] = useState('');
  const [uniformQty, setUniformQty] = useState('');
  const [otherQty, setOtherQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupe, setDupe] = useState<string | null>(null);

  // member search-as-you-type (active only), debounced.
  useEffect(() => {
    const q = search.trim();
    if (!q) { setResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/dashboard/members?search=${encodeURIComponent(q)}&status=active&limit=8`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j) setResults((j.members ?? []).map((m: { id: string; name_cn: string | null; name_en: string | null; centre: { code: string } | null }) => ({ id: m.id, name: m.name_cn || m.name_en || '（无名）', centreCode: m.centre?.code ?? null })));
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const selections: Selections = {
    meal_days: mealDays ? Number(mealDays) : undefined,
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
      const res = await fetch(`/api/dashboard/events/${eventId}/registrations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: selected.id, volunteer_team_id: teamId || null, selections }),
      });
      const j = await res.json().catch(() => null);
      if (res.status === 409) { setDupe(j?.existing?.reg_no ?? null); setError('该会员已报名此活动'); return; }
      if (!res.ok) { setError(j?.error ?? '登记失败'); return; }
      onDone();
    } catch {
      setError('登记失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-[#FFFEF6] rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5" onClick={(ev) => ev.stopPropagation()}>
        <h3 className="text-base font-semibold text-[#583A0F] mb-3">代报名</h3>

        {/* member search */}
        {!selected ? (
          <div>
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索会员 名字 / 电话…"
              className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] focus:outline-none focus:border-[#D89938]" />
            {results.length > 0 && (
              <ul className="mt-1 border border-[#EFE3BF] rounded-lg divide-y divide-[#EFE3BF] max-h-48 overflow-y-auto">
                {results.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => setSelected({ id: m.id, name: m.name })} className="w-full text-left px-3 py-2 text-sm hover:bg-[#FAEFD0]/50 flex items-center justify-between">
                      <span className="text-[#583A0F]">{m.name}</span>
                      {m.centreCode && <span className="text-[11px] text-[#B89968]">{m.centreCode}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#583A0F]">会员：<span className="font-medium">{selected.name}</span></span>
            <button onClick={() => setSelected(null)} className="text-xs text-[#A87929] hover:underline">更换</button>
          </div>
        )}

        {selected && (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="block text-xs font-medium text-[#B89968] mb-1">义工组（可选）</span>
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
                className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] focus:outline-none focus:border-[#D89938]">
                <option value="">信众参加（无组）</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name_cn}</option>)}
              </select>
            </label>

            {/* selection inputs — ONLY for items enabled on this event */}
            <div className="grid grid-cols-2 gap-3">
              {enabled.has('meal') && <Num label="用餐天数 🍚" value={mealDays} onChange={setMealDays} />}
              {enabled.has('accommodation') && <Num label="住宿晚数 🏨" value={nights} onChange={setNights} />}
              {enabled.has('transfer') && (
                <label className="flex items-center gap-2 text-sm text-[#583A0F] col-span-2">
                  <input type="checkbox" checked={transfer} onChange={(e) => setTransfer(e.target.checked)} /> 机场接送 🚐
                </label>
              )}
              {enabled.has('uniform') && (
                <>
                  <label className="block">
                    <span className="block text-xs font-medium text-[#B89968] mb-1">制服尺码 👕</span>
                    <input value={uniformSize} onChange={(e) => setUniformSize(e.target.value)} placeholder="M"
                      className="w-full text-sm p-2 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] focus:outline-none focus:border-[#D89938]" />
                  </label>
                  <Num label="制服数量" value={uniformQty} onChange={setUniformQty} />
                </>
              )}
              {enabled.has('other') && <Num label="结缘品数量" value={otherQty} onChange={setOtherQty} />}
            </div>

            {/* live fee preview */}
            <div className="rounded-lg bg-[#FAEFD0]/60 p-3 text-sm">
              {preview.breakdown.length === 0 ? <p className="text-[#8B6F47]">暂无费用</p> : (
                <ul className="space-y-0.5">
                  {preview.breakdown.map((b) => (
                    <li key={b.item} className="flex justify-between text-[#8B6F47]">
                      <span>{b.label} × {b.qty}</span><span>{moneyRM(b.subtotal)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-1 pt-1 border-t border-[#E8D5A8] flex justify-between font-semibold text-[#583A0F]">
                <span>合计</span><span>{moneyRM(preview.total)}</span>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600">
                {error}
                {dupe && <> · <Link href={`#reg-${dupe}`} className="underline text-[#A87929]" onClick={onClose}>已有报名 {dupe}</Link></>}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button disabled={saving} onClick={submit} className="px-5 py-2 text-sm text-white bg-[#D89938] rounded-full hover:bg-[#A87929] disabled:opacity-50">
                {saving ? '登记中…' : '提交报名'}
              </button>
              <button onClick={onClose} className="px-5 py-2 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0]">取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#B89968] mb-1">{label}</span>
      <input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm p-2 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] focus:outline-none focus:border-[#D89938]" />
    </label>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl p-4">
      <h3 className="text-sm font-semibold text-[#583A0F] mb-2">{title}</h3>
      {children}
    </section>
  );
}

// CSV of the current rows (BOM for Excel).
function exportCsv(code: string, tab: string, regs: RegRow[], teamName: Map<string, string>) {
  const header = ['报名编号', '姓名', '中心', '组', '选项', '费用', '状态', '处理人', '处理日期'];
  const rows = regs.map((r) => [
    r.reg_no, r.name, r.centreCode ?? '', r.volunteer_team_id ? teamName.get(r.volunteer_team_id) ?? '' : '',
    selectionsSummary(r.selections), String(r.fee_total), REG_STATUS_LABELS[r.status] ?? r.status,
    r.decidedByName ?? '', r.decided_at ? r.decided_at.slice(0, 10) : '',
  ]);
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = '﻿' + [header, ...rows].map((row) => row.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${code}-报名-${tab}-${new Date().toLocaleDateString('en-CA')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
