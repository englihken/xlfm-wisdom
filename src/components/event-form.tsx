// src/components/event-form.tsx
// Shared create/edit form for an event (used by /dashboard/events/new and /[id]/edit).
// Warm palette, bilingual. Fetches centres + teams from /api/dashboard/erp/meta. The
// 费率设置 table has SIX fixed rows (enable toggle + amount + fixed billing label);
// disabled rows are not sent. Status is NOT set here (draft on create; status actions
// live on the detail page). Create → POST (server codes it) → toast the code → detail.

'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { FEE_ROWS, BILLING_LABELS, MEAL_BILLING_OPTIONS, MEAL_COLS, EVENT_TYPE_OPTIONS, weekdayCn } from '@/lib/events-display';
import { datesInRange, mealSlotKey } from '@/lib/events';

export type EventFormValues = {
  title: string;
  event_type: string;
  organizing_centre_id: string;
  starts_on: string;
  ends_on: string;
  location: string;
  capacity: string;
  reg_deadline: string;
  requires_approval: 'yes' | 'no';
  reg_edit_cutoff_days: string;
  description: string;
  // meal carries a per-event billing (每餐/per_item default; 每天/per_day legacy); the
  // other five rows use their fixed FEE_ROWS billing.
  fees: Record<string, { enabled: boolean; amount: string; billing?: string }>;
  needs: { team_id: string; needed: string }[];
  mealClosed: string[]; // 'YYYY-MM-DD:meal' cells the kitchen does NOT offer (default: all offered)
};

export const EMPTY_EVENT: EventFormValues = {
  title: '',
  event_type: 'fahui',
  organizing_centre_id: '',
  starts_on: '',
  ends_on: '',
  location: '',
  capacity: '',
  reg_deadline: '',
  requires_approval: 'yes',
  reg_edit_cutoff_days: '3',
  description: '',
  fees: Object.fromEntries(FEE_ROWS.map((r) => [r.item, { enabled: false, amount: '', billing: r.billing }])),
  needs: [],
  mealClosed: [],
};

type Centre = { id: string; code: string; name_cn: string; name_en: string };
type Team = { id: string; name_cn: string; slug: string };

const mealBillingOf = (v: EventFormValues) => v.fees.meal?.billing || 'per_item';
const mealGridOn = (v: EventFormValues) => !!v.fees.meal?.enabled && mealBillingOf(v) === 'per_item' && !!v.starts_on;

function toBody(v: EventFormValues): Record<string, unknown> {
  const fees = FEE_ROWS.filter((r) => v.fees[r.item]?.enabled && v.fees[r.item].amount !== '').map((r) => ({
    item: r.item,
    amount: Number(v.fees[r.item].amount),
    billing: r.item === 'meal' ? mealBillingOf(v) : r.billing,
  }));
  const team_needs = v.needs
    .filter((n) => n.team_id && Number(n.needed) > 0)
    .map((n) => ({ team_id: n.team_id, needed: Number(n.needed) }));
  const body: Record<string, unknown> = {
    title: v.title.trim(),
    event_type: v.event_type,
    organizing_centre_id: v.organizing_centre_id,
    starts_on: v.starts_on,
    ends_on: v.ends_on || null,
    location: v.location.trim() || null,
    capacity: v.capacity ? Number(v.capacity) : null,
    reg_deadline: v.reg_deadline || null,
    requires_approval: v.requires_approval === 'yes',
    reg_edit_cutoff_days: v.reg_edit_cutoff_days === '' ? 3 : Number(v.reg_edit_cutoff_days),
    description: v.description.trim() || null,
    fees,
    team_needs,
  };
  // Send the offering grid only for per_item meal events (kitchen toggles). Otherwise the
  // server defaults every cell to offered — harmless for per_day / no-meal events.
  if (mealGridOn(v)) {
    const closed = new Set(v.mealClosed);
    const dates = datesInRange(v.starts_on, v.ends_on || null);
    body.meal_slots = dates.flatMap((d) =>
      MEAL_COLS.map((c) => ({ slot_date: d, meal: c.meal, offered: !closed.has(mealSlotKey(d, c.meal)) }))
    );
  }
  return body;
}

export function EventForm({
  mode,
  eventId,
  initial,
}: {
  mode: 'create' | 'edit';
  eventId?: string;
  initial?: EventFormValues;
}) {
  const router = useRouter();
  const [v, setV] = useState<EventFormValues>(initial ?? EMPTY_EVENT);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/erp/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) {
          setCentres(j.centres ?? []);
          setTeams(j.teams ?? []);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const set = <K extends keyof EventFormValues>(k: K, val: EventFormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const setFee = (item: string, patch: Partial<{ enabled: boolean; amount: string; billing: string }>) =>
    setV((p) => ({ ...p, fees: { ...p.fees, [item]: { ...p.fees[item], ...patch } } }));

  const submit = async () => {
    if (saving) return;
    if (!v.title.trim()) return setError('请填写活动名称');
    if (!v.organizing_centre_id) return setError('请选择主办中心');
    if (!v.starts_on) return setError('请选择开始日期');
    setSaving(true);
    setError(null);
    try {
      const url = mode === 'create' ? '/api/dashboard/events' : `/api/dashboard/events/${eventId}`;
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toBody(v)),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? '保存失败，请重试');
        return;
      }
      if (mode === 'create') {
        const ev = json.event;
        setToast(`活动已创建：${ev.code}`);
        setTimeout(() => router.push(`/dashboard/events/${ev.id}`), 1100);
      } else {
        router.push(`/dashboard/events/${eventId}`);
      }
    } catch {
      setError('保存失败，请重试');
    } finally {
      if (mode !== 'create') setSaving(false);
    }
  };

  const availableTeams = teams.filter((t) => !v.needs.some((n) => n.team_id === t.id));

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#583A0F] text-white text-sm shadow-lg">
          {toast}
        </div>
      )}

      {/* 基本资料 */}
      <Section title="基本资料" en="Basic">
        <Grid>
          <Text label="活动名称 *" value={v.title} onChange={(x) => set('title', x)} />
          <Sel label="类型 / Type" value={v.event_type} onChange={(x) => set('event_type', x)} options={EVENT_TYPE_OPTIONS} />
          <Sel label="主办中心 *" value={v.organizing_centre_id} onChange={(x) => set('organizing_centre_id', x)}
            options={[['', '请选择'], ...centres.map((c) => [c.id, `${c.name_cn} ${c.code}`] as [string, string])]} />
          <Text label="地点 / Location" value={v.location} onChange={(x) => set('location', x)} />
          <Text label="开始日期 *" type="date" value={v.starts_on} onChange={(x) => set('starts_on', x)} />
          <Text label="结束日期（可选）" type="date" value={v.ends_on} onChange={(x) => set('ends_on', x)} />
          <Text label="总名额（空=不限）" value={v.capacity} onChange={(x) => set('capacity', x)} placeholder="不限" />
          <Text label="报名截止（可选）" type="date" value={v.reg_deadline} onChange={(x) => set('reg_deadline', x)} />
          <Sel label="报名需审核" value={v.requires_approval} onChange={(x) => set('requires_approval', x as 'yes' | 'no')}
            options={[['yes', '是（需批准）'], ['no', '否（自动批准）']]} />
          <Text label="选项修改截止（开始前 N 天）" type="number" min="0" value={v.reg_edit_cutoff_days}
            onChange={(x) => set('reg_edit_cutoff_days', x)} placeholder="3" />
        </Grid>
        <label className="block mt-4">
          <span className="block text-xs font-medium text-[#B89968] mb-1">说明 / Description</span>
          <textarea value={v.description} onChange={(e) => set('description', e.target.value)} rows={2}
            className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] resize-y focus:outline-none focus:border-[#D89938]" />
        </label>
      </Section>

      {/* 费率设置 */}
      <Section title="费率设置" en="Fees">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-[#B89968] border-b border-[#EFE3BF]">
                <th className="px-2 py-2 font-medium">启用</th>
                <th className="px-2 py-2 font-medium">项目</th>
                <th className="px-2 py-2 font-medium">金额 (RM)</th>
                <th className="px-2 py-2 font-medium">计费方式</th>
              </tr>
            </thead>
            <tbody>
              {FEE_ROWS.map((r) => {
                const f = v.fees[r.item];
                return (
                  <tr key={r.item} className="border-b border-[#EFE3BF] last:border-b-0">
                    <td className="px-2 py-2">
                      <input type="checkbox" checked={f.enabled} onChange={(e) => setFee(r.item, { enabled: e.target.checked })} />
                    </td>
                    <td className={`px-2 py-2 ${f.enabled ? 'text-[#583A0F]' : 'text-[#B89968]'}`}>{r.label}</td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={f.amount}
                        disabled={!f.enabled}
                        onChange={(e) => setFee(r.item, { amount: e.target.value })}
                        placeholder="0.00"
                        className="w-28 text-sm p-1.5 border border-[#EFE3BF] rounded bg-white text-[#583A0F] disabled:bg-[#FAF7EE] disabled:text-[#B89968] focus:outline-none focus:border-[#D89938]"
                      />
                    </td>
                    <td className="px-2 py-2 text-[#8B6F47]">
                      {r.item === 'meal' ? (
                        <select
                          value={mealBillingOf(v)}
                          disabled={!f.enabled}
                          onChange={(e) => setFee('meal', { billing: e.target.value })}
                          className="text-sm p-1.5 border border-[#EFE3BF] rounded bg-white text-[#583A0F] disabled:bg-[#FAF7EE] disabled:text-[#B89968] focus:outline-none focus:border-[#D89938]"
                        >
                          {MEAL_BILLING_OPTIONS.map(([val, lbl]) => (
                            <option key={val} value={val}>{lbl}</option>
                          ))}
                        </select>
                      ) : (
                        BILLING_LABELS[r.billing]
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 餐点供应 — kitchen's per-day-per-meal offering grid (per_item meal events only) */}
      {mealGridOn(v) && (
        <Section title="餐点供应" en="Meals offered">
          <p className="text-xs text-[#8B6F47] mb-3">点选取消供应的餐次（灰色虚线＝不供应）。报名者只能勾选供应的餐次。</p>
          <MealOfferGrid
            startsOn={v.starts_on}
            endsOn={v.ends_on}
            closed={v.mealClosed}
            onChange={(closed) => set('mealClosed', closed)}
          />
        </Section>
      )}

      {/* 义工团队需求 */}
      <Section title="义工团队需求" en="Team needs">
        <div className="space-y-2">
          {v.needs.map((n, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={n.team_id}
                onChange={(e) => setV((p) => ({ ...p, needs: p.needs.map((x, j) => (j === i ? { ...x, team_id: e.target.value } : x)) }))}
                className="flex-1 text-sm p-2 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] focus:outline-none focus:border-[#D89938]"
              >
                <option value="">请选择组别</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.id !== n.team_id && v.needs.some((x) => x.team_id === t.id)}>
                    {t.name_cn}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                value={n.needed}
                onChange={(e) => setV((p) => ({ ...p, needs: p.needs.map((x, j) => (j === i ? { ...x, needed: e.target.value } : x)) }))}
                placeholder="人数"
                className="w-24 text-sm p-2 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] focus:outline-none focus:border-[#D89938]"
              />
              <button onClick={() => setV((p) => ({ ...p, needs: p.needs.filter((_, j) => j !== i) }))}
                className="px-3 py-2 text-xs text-red-700 border border-[#FCA5A5] rounded-lg hover:bg-[#FEF2F2]">移除</button>
            </div>
          ))}
          {availableTeams.length > 0 && (
            <button
              onClick={() => setV((p) => ({ ...p, needs: [...p.needs, { team_id: '', needed: '1' }] }))}
              className="px-3 py-1.5 text-xs text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0]"
            >
              ＋添加组别需求
            </button>
          )}
        </div>
      </Section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={saving}
          className="px-5 py-2 text-sm text-white bg-[#D89938] rounded-full hover:bg-[#A87929] transition disabled:opacity-50">
          {saving ? '保存中…' : mode === 'create' ? '创建活动' : '保存修改'}
        </button>
        <button onClick={() => router.back()} disabled={saving}
          className="px-5 py-2 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition disabled:opacity-50">
          取消
        </button>
      </div>
    </div>
  );
}

// Kitchen offering grid — dates (rows) × 早/午/晚 (cols). Clicking a cell toggles whether
// that meal is offered; off cells render dashed-grey. 整天 toggles a whole row; 全选/清空
// offer/close every in-range cell. `closed` holds the 'YYYY-MM-DD:meal' keys NOT offered.
function MealOfferGrid({
  startsOn, endsOn, closed, onChange,
}: { startsOn: string; endsOn: string; closed: string[]; onChange: (closed: string[]) => void }) {
  const dates = useMemo(() => datesInRange(startsOn, endsOn || null), [startsOn, endsOn]);
  const inRangeKeys = useMemo(() => {
    const s = new Set<string>();
    for (const d of dates) for (const c of MEAL_COLS) s.add(mealSlotKey(d, c.meal));
    return s;
  }, [dates]);
  const closedSet = useMemo(() => new Set(closed), [closed]);
  const offCount = [...closedSet].filter((k) => inRangeKeys.has(k)).length;

  const outOfRange = () => closed.filter((k) => !inRangeKeys.has(k));
  const setClosed = (keys: Set<string>) => onChange([...keys]);

  const toggleCell = (key: string) => {
    const next = new Set(closed);
    if (next.has(key)) next.delete(key); else next.add(key);
    setClosed(next);
  };
  const toggleRow = (date: string) => {
    const keys = MEAL_COLS.map((c) => mealSlotKey(date, c.meal));
    const anyOffered = keys.some((k) => !closedSet.has(k));
    const next = new Set(closed);
    for (const k of keys) { if (anyOffered) next.add(k); else next.delete(k); }
    setClosed(next);
  };
  const offerAll = () => setClosed(new Set(outOfRange()));
  const closeAll = () => setClosed(new Set([...outOfRange(), ...inRangeKeys]));

  if (dates.length === 0) return <p className="text-sm text-[#8B6F47]">请先选择开始日期。</p>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button type="button" onClick={offerAll} className="px-3 py-1 text-xs text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0]">全选</button>
        <button type="button" onClick={closeAll} className="px-3 py-1 text-xs text-[#8B6F47] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0]">清空</button>
        <span className="text-[11px] text-[#B89968]">{offCount > 0 ? `已关闭 ${offCount} 餐次` : '全部供应'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse">
          <thead>
            <tr className="text-[11px] text-[#B89968]">
              <th className="px-2 py-1.5 text-left font-medium">日期</th>
              {MEAL_COLS.map((c) => <th key={c.meal} className="px-2 py-1.5 font-medium w-16">{c.label}</th>)}
              <th className="px-2 py-1.5 font-medium w-14">整天</th>
            </tr>
          </thead>
          <tbody>
            {dates.map((d) => (
              <tr key={d} className="border-t border-[#EFE3BF]">
                <td className="px-2 py-1.5 whitespace-nowrap text-[#583A0F]">
                  {d.slice(5)} <span className="text-[11px] text-[#B89968]">{weekdayCn(d)}</span>
                </td>
                {MEAL_COLS.map((c) => {
                  const key = mealSlotKey(d, c.meal);
                  const offered = !closedSet.has(key);
                  return (
                    <td key={c.meal} className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => toggleCell(key)}
                        className={`w-full px-2 py-1 rounded-md text-xs transition ${
                          offered
                            ? 'bg-[#FAEFD0] text-[#8A5A1E] border border-[#EFE3BF] hover:bg-[#F5E1B0]'
                            : 'bg-[#FAF7EE] text-[#C9B892] border border-dashed border-[#DCCDA2] hover:bg-white'
                        }`}
                      >
                        {offered ? c.label : '—'}
                      </button>
                    </td>
                  );
                })}
                <td className="px-1 py-1 text-center">
                  <button type="button" onClick={() => toggleRow(d)}
                    className="px-2 py-1 text-[11px] text-[#8B6F47] border border-[#EFE3BF] rounded-md hover:bg-[#FAEFD0]">切换</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Section({ title, en, children }: { title: string; en: string; children: ReactNode }) {
  return (
    <section className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl p-5">
      <h2 className="text-base font-semibold text-[#583A0F] mb-3">
        {title} <span className="text-xs font-normal text-[#B89968]">{en}</span>
      </h2>
      {children}
    </section>
  );
}
function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}
function Text({ label, value, onChange, type = 'text', placeholder, min }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; min?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#B89968] mb-1">{label}</span>
      <input type={type} min={min} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] placeholder:text-[#B89968] focus:outline-none focus:border-[#D89938]" />
    </label>
  );
}
function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#B89968] mb-1">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] focus:outline-none focus:border-[#D89938]">
        {options.map(([val, lbl]) => (
          <option key={val} value={val}>{lbl}</option>
        ))}
      </select>
    </label>
  );
}
