// src/app/dashboard/inventory/movements/new/page.tsx
// 记录变动 — the single entry form for every ledger write: 入库 / 调拨 / 结缘发放 /
// 退回 / 盘点调增 / 盘点调减. 从仓/到仓 appear per the type's direction rule (the same
// rule the API and the DB CHECK enforce). Item picker = search box filtering a select
// (239 items). Submitting POSTs /api/dashboard/inventory/movements and returns to the
// ledger. inventory:edit required (the API enforces; the gate here is view — the form
// simply 403s on submit for view-only users, matching the house's server-first rule).

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErpGate } from '@/components/erp-gate';
import { MOVEMENT_DIRECTION, MOVEMENT_TYPE_OPTIONS, itemLabel } from '@/lib/inventory-display';

type Meta = {
  locations: { id: string; kind: string; name_cn: string }[];
  items: { id: string; stock_id: string | null; name_cn: string; category: string | null }[];
  events: { id: string; code: string; title: string; status: string }[];
};

function todayMYT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

export default function NewMovementPage() {
  return (
    <ErpGate active="inventory" module="inventory" titleSuffix="记录变动">
      {() => <NewMovementForm />}
    </ErpGate>
  );
}

function NewMovementForm() {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta>({ locations: [], items: [], events: [] });

  const [type, setType] = useState('stock_in');
  const [itemSearch, setItemSearch] = useState('');
  const [itemId, setItemId] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [qty, setQty] = useState('');
  const [eventId, setEventId] = useState('');
  const [movedAt, setMovedAt] = useState(todayMYT());
  const [note, setNote] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/inventory/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!active || !j) return;
        setMeta({ locations: j.locations ?? [], items: j.items ?? [], events: j.events ?? [] });
        // Sensible defaults: 总会仓库 as the acting warehouse on both sides.
        const hq = (j.locations ?? []).find((l: Meta['locations'][number]) => l.kind === 'hq_warehouse');
        if (hq) {
          setFromId(hq.id);
          setToId(hq.id);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const rule = MOVEMENT_DIRECTION[type] ?? { from: false, to: true };

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return meta.items;
    return meta.items.filter(
      (i) => i.name_cn.toLowerCase().includes(q) || (i.stock_id ?? '').toLowerCase().includes(q)
    );
  }, [meta.items, itemSearch]);

  // Keep the selection valid when the search narrows past it.
  useEffect(() => {
    if (itemId && !filteredItems.some((i) => i.id === itemId)) setItemId('');
  }, [filteredItems, itemId]);

  const submit = async () => {
    setError('');
    if (!itemId) return setError('请选择品项');
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) return setError('数量须为大于 0 的整数');
    if (rule.from && rule.to && fromId === toId) return setError('「从仓」与「到仓」不能相同');

    setSaving(true);
    try {
      const res = await fetch('/api/dashboard/inventory/movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movement_type: type,
          item_id: itemId,
          qty: n,
          from_location_id: rule.from ? fromId : null,
          to_location_id: rule.to ? toId : null,
          event_id: eventId || null,
          moved_at: movedAt || null,
          note,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? '记录失败，请重试');
        setSaving(false);
        return;
      }
      router.push('/dashboard/inventory/movements');
    } catch {
      setError('网络异常，请重试');
      setSaving(false);
    }
  };

  const locOptions: [string, string][] = meta.locations.map((l) => [
    l.id,
    l.kind === 'hq_warehouse' ? `🏛️ ${l.name_cn}` : l.name_cn,
  ]);

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold font-serif text-ink">📦 记录变动</h2>
        <span className="text-sm text-ink-faint">New movement</span>
      </div>

      <div className="bg-surface border border-border rounded-2xl p-5 space-y-4">
        {/* type */}
        <Field label="变动类型">
          <div className="flex flex-wrap gap-1.5">
            {MOVEMENT_TYPE_OPTIONS.map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setType(v)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                  type === v
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface text-ink border-border-strong hover:border-accent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        {/* item picker */}
        <Field label="品项">
          <input
            type="search"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            placeholder="输入名称 / 编号筛选…"
            className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
          />
          <select
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            size={Math.min(8, Math.max(3, filteredItems.length))}
            className="mt-1.5 w-full text-sm px-2 py-1.5 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent"
          >
            {filteredItems.map((i) => (
              <option key={i.id} value={i.id}>{itemLabel(i)}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-ink-faint">{filteredItems.length} 个品项</p>
        </Field>

        {/* locations per direction rule */}
        <div className="grid sm:grid-cols-2 gap-4">
          {rule.from && (
            <Field label="从仓（出）">
              <SelBox value={fromId} onChange={setFromId} options={locOptions} />
            </Field>
          )}
          {rule.to && (
            <Field label="到仓（入）">
              <SelBox value={toId} onChange={setToId} options={locOptions} />
            </Field>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="数量">
            <input
              type="number"
              min={1}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent tabular-nums"
            />
          </Field>
          <Field label="日期">
            <input
              type="date"
              value={movedAt}
              onChange={(e) => setMovedAt(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent"
            />
          </Field>
          <Field label="关联活动（可选）">
            <SelBox value={eventId} onChange={setEventId}
              options={[['', '（无）'], ...meta.events.map((e) => [e.id, `${e.code} ${e.title}`] as [string, string])]} />
          </Field>
        </div>

        <Field label="备注（可选）">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="如：新到货 / 823 法会拣货 / 盘点差异…"
            className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
          />
        </Field>

        {error && (
          <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button onClick={submit} disabled={saving} className="px-5 py-2 text-sm btn-primary">
            {saving ? '记录中…' : '记录变动'}
          </button>
          <button
            onClick={() => router.push('/dashboard/inventory/movements')}
            className="px-4 py-2 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition"
          >
            取消
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-faint">
        出库类变动（调拨/结缘发放/盘点调减）不允许超出该仓当前推算库存；数量与实物不符时，请先用盘点调增/调减对齐。
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-ink-muted mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function SelBox({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>{label}</option>
      ))}
    </select>
  );
}
