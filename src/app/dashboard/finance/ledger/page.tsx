// src/app/dashboard/finance/ledger/page.tsx
// 月费台账 (D2) — the digital version of the Melaka paper ledger. One row per active member:
// 赞助者 · 认捐 pill · 付至 · 12 month cells (paid √ gold / 豁免 lav / future dashed / empty).
// Ethics: an empty cell is UNPAID — never "overdue"; we only state 付至, never chase. Centre
// selector is hidden+locked for own_center users. Header pause chip toggles this month's
// collection-pause. ＋记录收款 (D3 modal) and a per-member panel (payments + 认捐/豁免 edit + 作废).
// finance:view to see; finance:edit for every mutation.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { FinanceTabs } from '@/components/finance-chrome';
import { CHANNEL_LABELS, CHANNEL_OPTIONS, pledgeLabel, moneyRM } from '@/lib/finance-display';

type Lite<T> = T | T[] | null;
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

type Centre = { id: string; code: string; name_cn: string; receiptBookAt: string | null; paused: boolean; pausedNote: string | null };
type Member = {
  id: string; name_cn: string; name_en: string | null; phone: string | null;
  fee_pledge_amount: number | null; fee_pledge_period: string | null; fee_waived_from: string | null; fee_waiver_note: string | null;
};
type Payment = {
  id: string; member_id: string; receipt_no: string; paid_at: string; amount: number;
  months_from: string; months_to: string; channel: string; note: string | null; voided_at: string | null; void_reason: string | null;
  enterer: Lite<{ display_name: string | null; email: string }>;
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const ym = (year: number, m: number) => `${year}-${String(m).padStart(2, '0')}`;
const todayYM = () => new Date().toISOString().slice(0, 7);
const pillTone = (tone: 'gold' | 'lav' | 'muted') =>
  tone === 'gold' ? 'pill-gold' : tone === 'lav' ? 'bg-[#EFEAF6] text-[#6B5B8A]' : 'pill-muted';

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FinancePage() {
  return (
    <ErpGate active="finance" module="finance" titleSuffix="月费台账">
      {(me) => <Ledger me={me} />}
    </ErpGate>
  );
}

function Ledger({ me }: { me: ErpMe }) {
  const canEdit = grantAllows(me.grants, 'finance', 'edit');
  const [centres, setCentres] = useState<Centre[]>([]);
  const [locked, setLocked] = useState(false);
  const [centreId, setCentreId] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [voided, setVoided] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRecord, setShowRecord] = useState(false);
  const [showPause, setShowPause] = useState(false);
  const [panelMember, setPanelMember] = useState<Member | null>(null);

  const loadMeta = useCallback(() => {
    fetch('/api/dashboard/finance/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setCentres(j.centres ?? []);
        setLocked(!!j.scope?.locked);
        setCentreId((c) => c || j.centres?.[0]?.id || '');
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const loadLedger = useCallback(() => {
    if (!centreId) return;
    setLoading(true);
    fetch(`/api/dashboard/finance/ledger?centre_id=${encodeURIComponent(centreId)}&year=${year}&include_void=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) {
          setMembers(j.members ?? []);
          setPayments(j.payments ?? []);
          setVoided(j.voided ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [centreId, year]);
  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  const centre = centres.find((c) => c.id === centreId) ?? null;

  // member_id → its non-void payments
  const payByMember = useMemo(() => {
    const m = new Map<string, Payment[]>();
    for (const p of payments) {
      const arr = m.get(p.member_id) ?? [];
      arr.push(p);
      m.set(p.member_id, arr);
    }
    return m;
  }, [payments]);

  // member_id → its VOIDED payments (a consumed receipt № stays visible, struck-through)
  const voidByMember = useMemo(() => {
    const m = new Map<string, Payment[]>();
    for (const p of voided) {
      const arr = m.get(p.member_id) ?? [];
      arr.push(p);
      m.set(p.member_id, arr);
    }
    return m;
  }, [voided]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((mem) => mem.name_cn.toLowerCase().includes(q) || (mem.phone ?? '').includes(q));
  }, [members, search]);

  // paid-through (max months_to) per member
  const paidThrough = (mem: Member): string | null => {
    const ps = payByMember.get(mem.id) ?? [];
    if (ps.length === 0) return null;
    return ps.reduce((mx, p) => (p.months_to > mx ? p.months_to : mx), ps[0].months_to).slice(0, 7);
  };

  const cellState = (mem: Member, m: number): { kind: 'paid' | 'waived' | 'future' | 'empty'; title?: string } => {
    const cellYM = ym(year, m);
    const cellDate = `${cellYM}-01`;
    if (mem.fee_waived_from && cellDate >= mem.fee_waived_from) return { kind: 'waived' };
    const cover = (payByMember.get(mem.id) ?? []).find((p) => p.months_from <= cellDate && cellDate <= p.months_to);
    if (cover) {
      const by = one(cover.enterer);
      return { kind: 'paid', title: `№${cover.receipt_no} · ${cover.paid_at} · ${moneyRM(cover.amount)} · ${by?.display_name || by?.email || ''}` };
    }
    if (cellYM > todayYM()) return { kind: 'future' };
    return { kind: 'empty' };
  };

  const exportCsv = () => {
    downloadCsv(
      `月费台账_${centre?.name_cn ?? ''}_${year}.csv`,
      ['赞助者', '电话', '认捐', '付至', ...MONTHS.map((m) => `${m}月`)],
      filtered.map((mem) => {
        const pl = pledgeLabel(mem);
        return [
          mem.name_cn,
          mem.phone ?? '',
          pl.text,
          mem.fee_waived_from ? '豁免中' : paidThrough(mem) ?? '',
          ...MONTHS.map((m) => {
            const s = cellState(mem, m).kind;
            return s === 'paid' ? '√' : s === 'waived' ? '豁免' : '';
          }),
        ];
      })
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold font-serif text-ink">💰 月费台账</h2>
        <span className="text-sm text-ink-faint">Fee Ledger</span>
      </div>
      <FinanceTabs active="ledger" />

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        {!locked && centres.length > 0 && (
          <select value={centreId} onChange={(e) => setCentreId(e.target.value)} className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent">
            {centres.map((c) => <option key={c.id} value={c.id}>{c.name_cn}</option>)}
          </select>
        )}
        {locked && centre && <span className="text-sm font-medium text-ink px-3 py-2">{centre.name_cn}</span>}
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent">
          {[year + 1, year, year - 1, year - 2].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索姓名 / 电话…"
          className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent w-48" />
        {centre && <PauseChip centre={centre} canEdit={canEdit} onClick={() => canEdit && setShowPause(true)} />}
        <span className="flex-1" />
        {canEdit && <button onClick={() => setShowRecord(true)} className="px-4 py-1.5 text-sm btn-primary">＋ 记录收款</button>}
        <button onClick={exportCsv} className="px-3 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">导出 CSV</button>
      </div>

      {centre?.receiptBookAt && <p className="text-xs text-ink-faint">收据簿至 № {centre.receiptBookAt}</p>}

      {/* grid */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">加载中…</p>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center"><p className="text-2xl mb-1">🪷</p><p className="text-sm text-ink">此中心暂无会员记录。</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm" style={{ minWidth: 980 }}>
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <th className="px-3 py-2.5 font-normal sticky left-0 bg-surface" style={{ minWidth: 130 }}>赞助者</th>
                  <th className="px-3 py-2.5 font-normal">认捐</th>
                  <th className="px-3 py-2.5 font-normal">付至</th>
                  {MONTHS.map((m) => <th key={m} className="px-1.5 py-2.5 font-normal text-center">{m}月</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((mem) => {
                  const pl = pledgeLabel(mem);
                  const through = mem.fee_waived_from ? '豁免中' : paidThrough(mem);
                  return (
                    <tr key={mem.id} className="border-b border-border last:border-b-0 hover:bg-accent/5">
                      <td className="px-3 py-2 sticky left-0 bg-surface">
                        <button onClick={() => setPanelMember(mem)} className="text-left font-medium text-ink hover:text-accent-deep">{mem.name_cn}</button>
                        {mem.phone && <div className="text-[10.5px] text-ink-faint">{mem.phone}</div>}
                      </td>
                      <td className="px-3 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${pillTone(pl.tone)}`}>{pl.text}</span></td>
                      <td className="px-3 py-2">
                        {mem.fee_waived_from ? <span className="text-[#6B5B8A] text-xs">豁免中</span> : through ? <b className="text-[#3F6B2E] text-xs">{through}</b> : <span className="text-ink-faint">—</span>}
                      </td>
                      {MONTHS.map((m) => {
                        const st = cellState(mem, m);
                        const cls =
                          st.kind === 'paid' ? 'bg-[#F8ECCB] border-[#EDDCAC] text-accent-deep font-bold'
                          : st.kind === 'waived' ? 'bg-[#EFEAF6] border-[#DDD3EC] text-[#6B5B8A]'
                          : st.kind === 'future' ? 'border-dashed border-border text-transparent'
                          : 'bg-surface-soft border-border text-transparent';
                        return (
                          <td key={m} className="px-1 py-1.5 text-center">
                            <span title={st.title} className={`block text-[10px] border rounded px-0 py-0.5 ${cls}`}>
                              {st.kind === 'paid' ? '√' : st.kind === 'waived' ? '豁' : '·'}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-ink-faint">
        单元格 hover → 收据号 / 日期 / 金额 / 录入人 · 空白格 = 未付（<b>不是</b>逾期——只陈述“付至”，不催缴）
      </p>

      {showRecord && centre && (
        <RecordPaymentModal centre={centre} members={members} onClose={() => setShowRecord(false)} onDone={() => { setShowRecord(false); loadLedger(); loadMeta(); }} />
      )}
      {showPause && centre && (
        <PauseModal centre={centre} onClose={() => setShowPause(false)} onDone={() => { setShowPause(false); loadMeta(); }} />
      )}
      {panelMember && (
        <MemberPanel
          member={panelMember}
          payments={payByMember.get(panelMember.id) ?? []}
          voidedPayments={voidByMember.get(panelMember.id) ?? []}
          canEdit={canEdit}
          onClose={() => setPanelMember(null)}
          onChanged={() => { loadLedger(); }}
          onMemberUpdated={(m) => { setMembers((list) => list.map((x) => (x.id === m.id ? { ...x, ...m } : x))); setPanelMember((cur) => (cur ? { ...cur, ...m } : cur)); }}
        />
      )}
    </div>
  );
}

function PauseChip({ centre, canEdit, onClick }: { centre: Centre; canEdit: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!canEdit}
      title={centre.pausedNote ?? undefined}
      className={`text-xs px-3 py-1.5 rounded-full border ${centre.paused ? 'bg-surface-soft text-accent-deep border-gold-border' : 'bg-[#E7F0E0] text-[#3F6B2E] border-[#3F6B2E]/20'} ${canEdit ? 'hover:border-accent' : 'cursor-default'}`}
    >
      {centre.paused ? '本月已足 · 已暂停' : '收款中'}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] tracking-wide text-[#8A7444] uppercase mb-1">{label}</p>
      {children}
    </div>
  );
}
const inputCls = 'w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent';

// Clickable-row member picker (search name / phone) — the ItemPicker pattern applied to members.
function MemberPicker({ members, value, onChange }: { members: Member[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return members;
    return members.filter((m) => m.name_cn.toLowerCase().includes(s) || (m.phone ?? '').includes(s));
  }, [members, q]);
  const sel = members.find((m) => m.id === value) ?? null;
  return (
    <div>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索姓名 / 电话…" className={inputCls} />
      <div role="listbox" className="mt-1.5 max-h-40 overflow-auto border border-border-strong rounded-lg bg-surface divide-y divide-border">
        {filtered.length === 0 ? (
          <p className="px-3 py-3 text-xs text-ink-faint">没有匹配的赞助者</p>
        ) : (
          filtered.map((m) => {
            const isSel = m.id === value;
            return (
              <button key={m.id} type="button" onClick={() => onChange(m.id)} className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${isSel ? 'bg-accent/10 text-accent-deep font-medium' : 'text-ink hover:bg-accent/5'}`}>
                <span className={`w-3.5 shrink-0 ${isSel ? 'text-accent-deep' : 'text-transparent'}`}>✓</span>
                <span className="truncate">{m.name_cn}{m.phone ? <span className="text-ink-faint"> · {m.phone}</span> : ''}</span>
              </button>
            );
          })
        )}
      </div>
      <p className="mt-1 text-[11.5px] min-h-[16px]">
        {sel ? <span className="text-accent-deep">已选：{sel.name_cn}{sel.phone ? ` · ${sel.phone}` : ''}</span> : <span className="text-ink-faint">在上方点选一位赞助者</span>}
      </p>
    </div>
  );
}

function ModalShell({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[70] bg-ink/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-surface rounded-2xl w-full ${wide ? 'max-w-xl' : 'max-w-md'} p-5 max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold font-serif text-ink mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}
function ErrLine({ msg }: { msg: string }) {
  return msg ? <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2 mb-2">{msg}</p> : null;
}

function RecordPaymentModal({ centre, members, onClose, onDone }: { centre: Centre; members: Member[]; onClose: () => void; onDone: () => void }) {
  const [memberId, setMemberId] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }));
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState('cash');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/dashboard/finance/payments/next-receipt?centre_id=${encodeURIComponent(centre.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.receiptNo) setReceiptNo(j.receiptNo);
      })
      .catch(() => {});
  }, [centre.id]);

  const submit = async () => {
    setErr('');
    if (!memberId) return setErr('请选择赞助者');
    if (!receiptNo.trim()) return setErr('请填写收据号');
    if (!(Number(amount) > 0)) return setErr('金额须大于 0');
    if (!from || !to) return setErr('请填写覆盖月份');
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/finance/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centre_id: centre.id, member_id: memberId, receipt_no: receiptNo.trim(), paid_at: paidAt, amount: Number(amount), channel, months_from: from, months_to: to, note }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? '保存失败');
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`记录收款 · ${centre.name_cn}`} onClose={onClose} wide>
      <ErrLine msg={err} />
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="赞助者"><MemberPicker members={members} value={memberId} onChange={setMemberId} /></Field></div>
        <Field label="收据号 №">
          <input value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} className="w-full text-sm px-3 py-2 border border-gold-border rounded-lg bg-[#FEFBF3] text-accent-deep font-bold focus:outline-none focus:border-accent" />
          <p className="text-[10.5px] text-ink-faint mt-1">自动接续本中心号簿，可改</p>
        </Field>
        <Field label="收款日期"><input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={inputCls} /></Field>
        <Field label="金额 RM"><input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} /></Field>
        <Field label="渠道">
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className={inputCls}>
            {CHANNEL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="覆盖月份 从"><input type="month" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></Field>
        <Field label="至"><input type="month" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></Field>
        <div className="col-span-2"><Field label="备注（可选）"><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} /></Field></div>
      </div>
      <div className="mt-3 text-xs text-[#4A3A14] bg-[#FBF3DE] border border-gold-border rounded-lg px-3 py-2.5 leading-relaxed">
        💡 金额与月份<b>互相独立</b>：系统不会用金额÷认捐推月份。RM100 覆盖两个月是财政与赞助者的共识，如实记录即可。
      </div>
      <div className="flex gap-2 justify-end mt-3">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? '保存中…' : '保存收款'}</button>
      </div>
    </ModalShell>
  );
}

function PauseModal({ centre, onClose, onDone }: { centre: Centre; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(centre.pausedNote ?? '');
  const [busy, setBusy] = useState(false);
  const target = !centre.paused;
  const submit = async () => {
    setBusy(true);
    try {
      await fetch('/api/dashboard/finance/months', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centre_id: centre.id, month: todayYM(), collection_paused: target, paused_note: target ? note.trim() || null : null }),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell title={target ? '暂停本月收款' : '恢复本月收款'} onClose={onClose}>
      <p className="text-sm text-ink-muted mb-3 leading-relaxed">
        {target ? '本月中心需求已足，暂停收款。会员自查页会显示「本月已满，感恩 🙏」。这是透明化的手动开关，不是自动上限。' : '恢复本月收款。'}
      </p>
      {target && (
        <div className="mb-3"><Field label="说明（可选，透明化）"><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="如：本月已足额" /></Field></div>
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? '保存中…' : target ? '暂停收款' : '恢复收款'}</button>
      </div>
    </ModalShell>
  );
}

function MemberPanel({ member, payments, voidedPayments, canEdit, onClose, onChanged, onMemberUpdated }: {
  member: Member; payments: Payment[]; voidedPayments: Payment[]; canEdit: boolean; onClose: () => void; onChanged: () => void;
  onMemberUpdated: (m: Partial<Member> & { id: string }) => void;
}) {
  const [voidTarget, setVoidTarget] = useState<Payment | null>(null);
  const [showPledge, setShowPledge] = useState(false);
  const pl = pledgeLabel(member);
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-[min(460px,94vw)] bg-surface border-l border-border overflow-y-auto p-5">
        <button onClick={onClose} className="float-right text-lg text-ink-faint hover:text-ink" aria-label="关闭">✕</button>
        <h3 className="text-lg font-bold font-serif text-ink">{member.name_cn}</h3>
        <p className="text-xs text-ink-faint mt-0.5">{member.phone ?? '（无电话）'}</p>
        <div className="flex items-center gap-2 mt-2">
          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${pillTone(pl.tone)}`}>{pl.text}</span>
          {member.fee_waived_from && <span className="text-[11px] text-[#6B5B8A]">豁免起 {member.fee_waived_from}</span>}
          {canEdit && <button onClick={() => setShowPledge(true)} className="ml-auto text-xs text-accent-deep hover:underline">认捐 / 豁免 ✏️</button>}
        </div>
        {member.fee_waiver_note && <p className="mt-1 text-[11px] text-ink-muted">{member.fee_waiver_note}</p>}

        <h4 className="text-sm font-semibold text-ink mt-4 mb-1">缴付记录（{payments.length}）</h4>
        {payments.length === 0 ? (
          <p className="text-xs text-ink-faint py-2">本年暂无缴付记录。</p>
        ) : (
          <div className="space-y-1.5">
            {payments.slice().sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1)).map((p) => {
              const by = one(p.enterer);
              return (
                <div key={p.id} className="border border-border rounded-lg px-3 py-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="font-mono text-ink-muted">№{p.receipt_no}</span>
                    <span className="font-semibold text-ink">{moneyRM(p.amount)}</span>
                  </div>
                  <div className="text-ink-muted mt-0.5">{p.paid_at} · {CHANNEL_LABELS[p.channel] ?? p.channel} · 覆盖 {p.months_from.slice(0, 7)} → {p.months_to.slice(0, 7)}</div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-ink-faint">{by?.display_name || by?.email || ''}</span>
                    {canEdit && <button onClick={() => setVoidTarget(p)} className="text-[#B4402E] hover:underline">作废</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {voidedPayments.length > 0 && (
          <>
            <h4 className="text-sm font-semibold text-ink-muted mt-4 mb-1">已作废（保留号簿）</h4>
            <div className="space-y-1">
              {voidedPayments.slice().sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1)).map((p) => (
                <div key={p.id} className="text-[11.5px] text-ink-faint line-through">
                  №{p.receipt_no} · {p.paid_at} · {moneyRM(p.amount)}
                  <span className="no-underline text-[#B4402E]"> （已作废：{p.void_reason}）</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {voidTarget && (
        <VoidModal
          title={`作废收款 №${voidTarget.receipt_no}`}
          url={`/api/dashboard/finance/payments/${voidTarget.id}/void`}
          onClose={() => setVoidTarget(null)}
          onDone={() => { setVoidTarget(null); onChanged(); }}
        />
      )}
      {showPledge && (
        <PledgeModal member={member} onClose={() => setShowPledge(false)} onDone={(m) => { setShowPledge(false); onMemberUpdated(m); onChanged(); }} />
      )}
    </div>
  );
}

function PledgeModal({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: (m: Partial<Member> & { id: string }) => void }) {
  const [amount, setAmount] = useState(member.fee_pledge_amount != null ? String(member.fee_pledge_amount) : '');
  const [period, setPeriod] = useState(member.fee_pledge_period ?? 'month');
  const [waivedFrom, setWaivedFrom] = useState(member.fee_waived_from ?? '');
  const [waiverNote, setWaiverNote] = useState(member.fee_waiver_note ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    if (amount.trim() && !(Number(amount) > 0)) return setErr('认捐金额须大于 0，或留空表示未认捐');
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard/finance/members/${member.id}/pledge`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fee_pledge_amount: amount.trim() ? Number(amount) : null,
          fee_pledge_period: amount.trim() ? period : null,
          fee_waived_from: waivedFrom || null,
          fee_waiver_note: waivedFrom ? waiverNote.trim() || null : null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? '保存失败');
      else onDone({ id: member.id, fee_pledge_amount: amount.trim() ? Number(amount) : null, fee_pledge_period: amount.trim() ? period : null, fee_waived_from: waivedFrom || null, fee_waiver_note: waivedFrom ? waiverNote.trim() || null : null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`认捐 / 豁免 · ${member.name_cn}`} onClose={onClose}>
      <ErrLine msg={err} />
      <div className="text-xs text-ink-muted bg-surface-soft rounded-lg px-3 py-2 mb-3 leading-relaxed">认捐与豁免<b>互相独立</b>：豁免的会员也可保留历史认捐额。留空认捐金额 = 未认捐。</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="认捐金额 RM（留空=未认捐）"><input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} /></Field>
        <Field label="周期"><select value={period} onChange={(e) => setPeriod(e.target.value)} className={inputCls}><option value="month">每月</option><option value="year">每年</option></select></Field>
        <Field label="豁免起始（留空=不豁免）"><input type="date" value={waivedFrom} onChange={(e) => setWaivedFrom(e.target.value)} className={inputCls} /></Field>
        <Field label="豁免说明"><input value={waiverNote} onChange={(e) => setWaiverNote(e.target.value)} className={inputCls} placeholder="如：理事会决议" /></Field>
      </div>
      <div className="flex gap-2 justify-end mt-3">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? '保存中…' : '保存'}</button>
      </div>
    </ModalShell>
  );
}

function VoidModal({ title, url, onClose, onDone }: { title: string; url: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr('');
    if (!reason.trim()) return setErr('请填写作废原因');
    setBusy(true);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? '作废失败');
      else onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell title={title} onClose={onClose}>
      <ErrLine msg={err} />
      <p className="text-xs text-ink-muted mb-2">作废保留审计痕迹（不删除）。请说明原因。</p>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputCls} />
      <div className="flex gap-2 justify-end mt-3">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
        <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm border border-[#E5C4BF] text-[#B4402E] rounded-lg bg-surface hover:border-[#B4402E]">{busy ? '处理中…' : '确认作废'}</button>
      </div>
    </ModalShell>
  );
}
