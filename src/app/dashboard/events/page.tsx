// src/app/dashboard/events/page.tsx
// 活动总览 — KPI strip + filters + event cards. KPIs are derived CLIENT-SIDE from a
// single ?limit=100 fetch of current events (no dedicated stats endpoint, per B3);
// LIMITATION: only the most recent 100 events are considered, and 本月报名 counts the
// registrations of this-month events (the list response has no per-registration
// dates). Filters are applied client-side to that same set.

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { EVENT_TYPE_LABELS, EVENT_TYPE_OPTIONS, STATUS_LABELS, STATUS_STYLES, FEE_LABEL, moneyRM } from '@/lib/events-display';

type RegCounts = { pending: number; approved: number; rejected: number; cancelled: number };
type TeamNeed = { team_id: string; name_cn: string; needed: number; approved: number };
type FeeRow = { item: string; label_cn: string | null; amount: number; billing: string; sort: number };
type EventRow = {
  id: string;
  code: string;
  title: string;
  event_type: string;
  status: string;
  starts_on: string;
  ends_on: string | null;
  location: string | null;
  capacity: number | null;
  reg_deadline: string | null;
  requires_approval: boolean;
  organizingCentre: { code: string; name_cn: string } | null;
  regCounts: RegCounts;
  teamNeeds: TeamNeed[];
  fees: FeeRow[];
};
type MetaCentre = { id: string; code: string; name_cn: string };

function thisMonthKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).slice(0, 7); // YYYY-MM
}

export default function EventsPage() {
  return (
    <ErpGate active="events" module="events">
      {(me) => <EventsOverview me={me} />}
    </ErpGate>
  );
}

function EventsOverview({ me }: { me: ErpMe }) {
  const canEdit = grantAllows(me.grants, 'events', 'edit');
  const [events, setEvents] = useState<EventRow[]>([]);
  const [centres, setCentres] = useState<MetaCentre[]>([]);
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [centre, setCentre] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/dashboard/events?limit=100').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/dashboard/erp/meta').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([ev, meta]) => {
        if (!active) return;
        if (ev) setEvents(ev.events ?? []);
        if (meta) setCentres(meta.centres ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const kpis = useMemo(() => {
    const mk = thisMonthKey();
    let ongoing = 0;
    let pending = 0;
    let monthEvents = 0;
    let monthRegs = 0;
    for (const e of events) {
      if (e.status === 'open') ongoing++;
      pending += e.regCounts.pending;
      if ((e.starts_on ?? '').slice(0, 7) === mk) {
        monthEvents++;
        monthRegs += e.regCounts.pending + e.regCounts.approved + e.regCounts.rejected + e.regCounts.cancelled;
      }
    }
    return { ongoing, pending, monthEvents, monthRegs };
  }, [events]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(
      (e) =>
        (!status || e.status === status) &&
        (!type || e.event_type === type) &&
        (!centre || e.organizingCentre?.code === centre || false) &&
        (!q || e.title.toLowerCase().includes(q) || e.code.toLowerCase().includes(q))
    );
  }, [events, status, type, centre, search]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold text-[#583A0F]">活动总览</h2>
          <span className="text-sm text-[#B89968]">Events · {events.length}</span>
        </div>
        {canEdit && (
          <Link href="/dashboard/events/new" className="px-4 py-1.5 text-sm text-white bg-[#D89938] rounded-full hover:bg-[#A87929] transition">
            ＋新建活动
          </Link>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="进行中" value={kpis.ongoing} />
        <Kpi label="待审核报名" value={kpis.pending} accent={kpis.pending > 0} />
        <Kpi label="本月报名" value={kpis.monthRegs} />
        <Kpi label="本月活动" value={kpis.monthEvents} />
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Sel value={status} onChange={setStatus} options={[['', '全部状态'], ...Object.entries(STATUS_LABELS)]} />
        <Sel value={type} onChange={setType} options={[['', '全部类型'], ...EVENT_TYPE_OPTIONS]} />
        <Sel value={centre} onChange={setCentre} options={[['', '全部中心'], ...centres.map((c) => [c.code, c.name_cn] as [string, string])]} />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索 名称 / 编号…"
          className="text-sm px-3 py-2 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] placeholder:text-[#B89968] focus:outline-none focus:border-[#D89938] w-52"
        />
      </div>

      {/* cards */}
      {loading ? (
        <p className="p-6 text-sm text-[#8B6F47]">加载中…</p>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl">
          <p className="text-sm text-[#583A0F]">{events.length === 0 ? '还没有活动' : '未找到匹配的活动'}</p>
          {events.length === 0 && canEdit && (
            <p className="mt-1 text-xs text-[#8B6F47]">点击「＋新建活动」创建第一个活动。</p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => (
            <EventCard key={e.id} e={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({ e }: { e: EventRow }) {
  const approved = e.regCounts.approved;
  const pct = e.capacity ? Math.min(100, Math.round((approved / e.capacity) * 100)) : 0;
  return (
    <Link
      href={`/dashboard/events/${e.id}`}
      className="block bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl p-4 hover:border-[#D89938] hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-[#583A0F] leading-snug">{e.title}</h3>
        <span className={`shrink-0 inline-block px-2 py-0.5 rounded-full text-[11px] ${STATUS_STYLES[e.status] ?? ''}`}>
          {STATUS_LABELS[e.status] ?? e.status}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#8B6F47]">
        <span className="inline-block px-2 py-0.5 rounded-full bg-[#FAEFD0] text-[#8A5A1E]">{EVENT_TYPE_LABELS[e.event_type] ?? e.event_type}</span>
        {e.organizingCentre && <span>{e.organizingCentre.name_cn}</span>}
        <span className="font-mono">{e.code}</span>
      </div>
      <p className="mt-1 text-xs text-[#8B6F47]">
        {e.starts_on}
        {e.ends_on && e.ends_on !== e.starts_on ? ` — ${e.ends_on}` : ''}
        {e.reg_deadline ? ` · 截止 ${e.reg_deadline}` : ''}
      </p>

      {/* capacity bar */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-[#8B6F47] mb-1">
          <span>报名 {approved}{e.capacity ? ` / ${e.capacity}` : ' / 不限'}</span>
          {e.capacity ? <span>{pct}%</span> : null}
        </div>
        <div className="h-2 rounded-full bg-[#FAEFD0] overflow-hidden">
          <div className="h-full rounded-full bg-[#D89938]" style={{ width: e.capacity ? `${pct}%` : '0%' }} />
        </div>
      </div>

      {/* counts */}
      <div className="mt-2 flex items-center gap-3 text-[11px]">
        <span className={e.regCounts.pending > 0 ? 'text-red-700 font-medium' : 'text-[#8B6F47]'}>待审 {e.regCounts.pending}</span>
        <span className="text-[#8B6F47]">已批 {e.regCounts.approved}</span>
        <span className="text-[#8B6F47]">已拒 {e.regCounts.rejected}</span>
      </div>

      {/* team-needs chips */}
      {e.teamNeeds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {e.teamNeeds.map((t) => {
            const short = t.approved < t.needed;
            return (
              <span
                key={t.team_id}
                className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${
                  short ? 'bg-[#FEF2F2] text-red-700' : 'bg-white border border-[#EFE3BF] text-[#8B6F47]'
                }`}
              >
                {t.name_cn} {t.approved}/{t.needed}{short ? ' ⚠' : ''}
              </span>
            );
          })}
        </div>
      )}
      {/* fee summary — enabled items + amounts */}
      {e.fees.length > 0 && (
        <p className="mt-2 text-[11px] text-[#8B6F47] truncate" title={e.fees.map((f) => `${f.label_cn || FEE_LABEL[f.item] || f.item} ${moneyRM(f.amount)}`).join(' · ')}>
          {e.fees.map((f) => `${f.label_cn || FEE_LABEL[f.item] || f.item} ${moneyRM(f.amount)}`).join(' · ')}
        </p>
      )}
    </Link>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-xl px-4 py-3">
      <div className={`text-2xl font-bold ${accent ? 'text-red-700' : 'text-[#583A0F]'}`}>{value}</div>
      <div className="text-xs text-[#8B6F47]">{label}</div>
    </div>
  );
}
function Sel({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm px-3 py-2 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] focus:outline-none focus:border-[#D89938]"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}
