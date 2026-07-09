// src/dashboard/outreach/page.tsx
// 渡人 WORKBENCH (Phase E1) — a work queue, not a dashboard. Slim header of PLAIN numbers (no
// charts, deliberately — all reporting is parked for 报表中心/E3), the 善缘名单 queue (sort 最久
// 未跟进 by default — the conscience), and a 渡人卡 drawer for recording milestones on real people.
// ＋新增善缘 adds a manual 善缘. Tone: 只记录善缘的成长. outreach:view to see; edit to record.

'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { OutreachCardDrawer } from '@/components/outreach-card-drawer';
import { MILESTONES, SOURCES, milestoneMeta, milestoneLabel, sourceLabel } from '@/lib/outreach';

type Meta = { centres: { id: string; code: string; name_cn: string }[]; events: { id: string; code: string; title: string }[] };
type Person = {
  id: string; display_name: string | null; phone: string | null; wa_id: string | null;
  source_type: string | null; centre_id: string | null; centre_name: string | null; rung: string; lastActivity: string;
};

const inputCls = 'text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent';

export default function OutreachPage() {
  return (
    <ErpGate active="outreach" module="outreach">
      {(me) => (
        <Suspense fallback={<p className="p-6 text-sm text-ink-muted">加载中…</p>}>
          <Workbench me={me} />
        </Suspense>
      )}
    </ErpGate>
  );
}

function Workbench({ me }: { me: ErpMe }) {
  const canEdit = grantAllows(me.grants, 'outreach', 'edit');
  const sp = useSearchParams();

  const [summary, setSummary] = useState<{ newThisMonth: number; chantingThisMonth: number; total: number; stale: number } | null>(null);
  const [meta, setMeta] = useState<Meta>({ centres: [], events: [] });
  const [persons, setPersons] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [source, setSource] = useState('');
  const [rung, setRung] = useState('');
  const [centre, setCentre] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'stale' | 'recent'>('stale');

  const [drawerId, setDrawerId] = useState<string | null>(sp.get('contact'));
  const [showCreate, setShowCreate] = useState(false);

  const loadAux = useCallback(() => {
    fetch('/api/dashboard/outreach/summary').then((r) => (r.ok ? r.json() : null)).then((j) => j && setSummary(j)).catch(() => {});
    fetch('/api/dashboard/outreach/meta').then((r) => (r.ok ? r.json() : null)).then((j) => j && setMeta(j)).catch(() => {});
  }, []);
  useEffect(() => {
    loadAux();
  }, [loadAux]);

  const loadList = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '30', sort });
    if (source) params.set('source', source);
    if (rung) params.set('rung', rung);
    if (centre) params.set('centre_id', centre);
    if (q.trim()) params.set('q', q.trim());
    fetch(`/api/dashboard/outreach/persons?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) { setPersons(j.persons ?? []); setTotal(j.total ?? 0); setTotalPages(j.totalPages ?? 1); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, sort, source, rung, centre, q]);
  useEffect(() => {
    loadList();
  }, [loadList]);

  // reset to page 1 when filters change (render-time previous-value pattern)
  const filterSig = `${source}|${rung}|${centre}|${q}|${sort}`;
  const [prevSig, setPrevSig] = useState(filterSig);
  if (filterSig !== prevSig) { setPrevSig(filterSig); setPage(1); }

  const onDrawerChanged = () => { loadList(); loadAux(); };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold font-serif text-ink">🪷 渡人</h2>
          <span className="text-sm text-ink-faint">善缘名单 · 只记录善缘的成长</span>
        </div>
        {canEdit && <button onClick={() => setShowCreate(true)} className="px-4 py-1.5 text-sm btn-primary">＋ 新增善缘</button>}
      </div>

      {/* header numbers — plain, no charts */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Num label="本月新结缘" value={summary?.newThisMonth} />
        <Num label="本月开始念经" value={summary?.chantingThisMonth} />
        <Num label="名单总数" value={summary?.total} />
        <Num label="超过 30 天没动静" value={summary?.stale} alert />
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
          <option value="">全部来源</option>
          {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={rung} onChange={(e) => setRung(e.target.value)} className={inputCls}>
          <option value="">全部阶段</option>
          {MILESTONES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <select value={centre} onChange={(e) => setCentre(e.target.value)} className={inputCls}>
          <option value="">全部中心</option>
          {meta.centres.map((c) => <option key={c.id} value={c.id}>{c.name_cn}</option>)}
        </select>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索姓名 / 电话…" className={`${inputCls} w-44`} />
        <span className="flex-1" />
        <div className="flex gap-1">
          <button onClick={() => setSort('stale')} className={`px-3 py-1.5 text-xs rounded-lg border ${sort === 'stale' ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border-strong'}`}>最久未跟进</button>
          <button onClick={() => setSort('recent')} className={`px-3 py-1.5 text-xs rounded-lg border ${sort === 'recent' ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border-strong'}`}>最近动静</button>
        </div>
      </div>

      {/* queue */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">加载中…</p>
        ) : persons.length === 0 ? (
          <div className="p-10 text-center"><p className="text-2xl mb-1">🪷</p><p className="text-sm text-ink">名单里还没有符合条件的善缘。</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <th className="px-4 py-2.5 font-normal">姓名</th><th className="px-4 py-2.5 font-normal">电话</th>
                  <th className="px-4 py-2.5 font-normal">来源</th><th className="px-4 py-2.5 font-normal">当前阶段</th>
                  <th className="px-4 py-2.5 font-normal">中心</th><th className="px-4 py-2.5 font-normal">最后动静</th>
                </tr>
              </thead>
              <tbody>
                {persons.map((p) => (
                  <tr key={p.id} onClick={() => setDrawerId(p.id)} className="border-b border-border last:border-b-0 hover:bg-accent/5 cursor-pointer">
                    <td className="px-4 py-2.5 font-medium text-ink">{p.display_name || '匿名结缘人'}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">{p.phone || p.wa_id || '—'}</td>
                    <td className="px-4 py-2.5"><span className="pill-muted inline-block px-2 py-0.5 rounded-full text-[11px]">{sourceLabel(p.source_type)}</span></td>
                    <td className="px-4 py-2.5"><span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[11px]">{milestoneMeta(p.rung)?.emoji} {milestoneLabel(p.rung)}</span></td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">{p.centre_name || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-faint">{p.lastActivity || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 border border-border-strong rounded-lg bg-surface text-ink disabled:opacity-40">上一页</button>
          <span className="text-ink-muted">{page} / {totalPages} · 共 {total}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 border border-border-strong rounded-lg bg-surface text-ink disabled:opacity-40">下一页</button>
        </div>
      )}

      {showCreate && <CreateModal meta={meta} onClose={() => setShowCreate(false)} onDone={(id) => { setShowCreate(false); onDrawerChanged(); if (id) setDrawerId(id); }} />}
      {drawerId && <OutreachCardDrawer contactId={drawerId} meta={meta} canEdit={canEdit} onClose={() => setDrawerId(null)} onChanged={onDrawerChanged} />}
    </div>
  );
}

function Num({ label, value, alert }: { label: string; value: number | undefined; alert?: boolean }) {
  return (
    <div className={`bg-surface border rounded-2xl px-4 py-3 ${alert && (value ?? 0) > 0 ? 'border-[#E5C4BF]' : 'border-border'}`}>
      <div className={`text-2xl font-bold tabular-nums ${alert && (value ?? 0) > 0 ? 'text-[#B4402E]' : 'text-ink'}`}>{value ?? '—'}</div>
      <div className="text-[11px] text-ink-muted mt-0.5">{label}</div>
    </div>
  );
}

function CreateModal({ meta, onClose, onDone }: { meta: Meta; onClose: () => void; onDone: (id?: string) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [eventId, setEventId] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [centreId, setCentreId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState('');
  const [existing, setExisting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    setExisting(null);
    if (!name.trim()) return setErr('请填写姓名');
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/outreach/persons', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name.trim(), phone: phone.trim() || undefined, source_type: sourceType || undefined, source_event_id: sourceType === 'event' ? eventId || undefined : undefined, source_note: sourceNote.trim() || undefined, centre_id: centreId || undefined, first_contact_date: date }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) { setErr(j.error ?? '已在名单中'); setExisting(j.existing?.id ?? null); }
      else if (!res.ok) setErr(j.error ?? '创建失败');
      else onDone(j.person?.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-ink/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold font-serif text-ink mb-3">＋ 新增善缘</h3>
        {err && (
          <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2 mb-2">
            {err}{existing && <> · <button onClick={() => onDone(existing)} className="underline">打开已有渡人卡</button></>}
          </p>
        )}
        <div className="space-y-2.5">
          <div><p className="text-[11px] text-ink-muted mb-1">姓名（必填）</p><input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-full`} /></div>
          <div><p className="text-[11px] text-ink-muted mb-1">电话</p><input value={phone} onChange={(e) => setPhone(e.target.value)} className={`${inputCls} w-full`} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><p className="text-[11px] text-ink-muted mb-1">来源</p>
              <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className={`${inputCls} w-full`}>
                <option value="">（未填）</option>
                {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div><p className="text-[11px] text-ink-muted mb-1">中心</p>
              <select value={centreId} onChange={(e) => setCentreId(e.target.value)} className={`${inputCls} w-full`}>
                <option value="">（未指定）</option>
                {meta.centres.map((c) => <option key={c.id} value={c.id}>{c.name_cn}</option>)}
              </select>
            </div>
          </div>
          {sourceType === 'event' && (
            <div><p className="text-[11px] text-ink-muted mb-1">来源活动</p>
              <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={`${inputCls} w-full`}>
                <option value="">（不指定）</option>
                {meta.events.map((e) => <option key={e.id} value={e.id}>{e.code} {e.title}</option>)}
              </select>
            </div>
          )}
          <div><p className="text-[11px] text-ink-muted mb-1">来源备注（可选）</p><input value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} className={`${inputCls} w-full`} /></div>
          <div><p className="text-[11px] text-ink-muted mb-1">初次接触日期</p><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} w-full`} /></div>
        </div>
        <div className="flex gap-2 justify-end mt-3">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
          <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? '创建中…' : '加入名单'}</button>
        </div>
      </div>
    </div>
  );
}
