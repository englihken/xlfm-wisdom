// src/app/dashboard/inventory/movements/new/page.tsx
// 记录变动 — the single entry form for every ledger write: 入库 / 调拨 / 结缘发放 /
// 退回 / 盘点调增 / 盘点调减. 从仓/到仓 appear per the type's direction rule (the same
// rule the API and the DB CHECK enforce). Item picker = search box filtering a select
// (239 items). Submitting POSTs /api/dashboard/inventory/movements and returns to the
// ledger. inventory:edit required (the API enforces; the gate here is view — the form
// simply 403s on submit for view-only users, matching the house's server-first rule).

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ErpGate } from '@/components/erp-gate';
import { MOVEMENT_DIRECTION, MOVEMENT_TYPE_OPTIONS } from '@/lib/inventory-display';
import { ItemPicker } from '@/components/inventory-chrome';
import { useT } from '@/lib/i18n-react';

type Meta = {
  locations: { id: string; kind: string; name_cn: string }[];
  items: { id: string; stock_id: string | null; name_cn: string; category: string | null }[];
  events: { id: string; code: string; title: string; status: string }[];
};

function todayMYT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

export default function NewMovementPage() {
  const t = useT();
  return (
    <ErpGate active="inventory" module="inventory" titleSuffix={t('inv.suffix.newMovement')}>
      {() => (
        <Suspense fallback={<p className="p-6 text-sm text-ink-muted">{t('inv.loading')}</p>}>
          <NewMovementForm />
        </Suspense>
      )}
    </ErpGate>
  );
}

function NewMovementForm() {
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const [meta, setMeta] = useState<Meta>({ locations: [], items: [], events: [] });

  const [type, setType] = useState('stock_in');
  const [itemId, setItemId] = useState(sp.get('item') ?? '');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [qty, setQty] = useState('');
  const [eventId, setEventId] = useState('');
  const [movedAt, setMovedAt] = useState(todayMYT());
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);

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

  const submit = async () => {
    setError('');
    if (!itemId) return setError(t('inv.errPickItem'));
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) return setError(t('inv.new.errQty'));
    if (rule.from && rule.to && fromId === toId) return setError(t('inv.new.errSameLoc'));

    setSaving(true);
    try {
      // Optional photo (e.g. a 到货 delivery photo) → upload first, attach the path.
      let photoPath: string | undefined;
      if (photo) {
        const fd = new FormData();
        fd.append('file', photo);
        const up = await fetch('/api/dashboard/inventory/upload?kind=photo', { method: 'POST', body: fd });
        const uj = await up.json().catch(() => ({}));
        if (!up.ok || !uj.path) {
          setError(uj.error ?? t('inv.photoUploadFailed'));
          setSaving(false);
          return;
        }
        photoPath = uj.path;
      }
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
          photo_path: photoPath ?? null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? t('inv.new.errSave'));
        setSaving(false);
        return;
      }
      router.push('/dashboard/inventory/movements');
    } catch {
      setError(t('inv.new.errNetwork'));
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
        <h2 className="text-xl font-bold font-serif text-ink">{t('inv.new.title')}</h2>
        <span className="text-sm text-ink-faint">New movement</span>
      </div>

      <div className="bg-surface border border-border rounded-2xl p-5 space-y-4">
        {/* type */}
        <Field label={t('inv.new.typeLabel')}>
          <div className="flex flex-wrap gap-1.5">
            {MOVEMENT_TYPE_OPTIONS.map(([v]) => (
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
                {t(`inv.mv.opt.${v}`)}
              </button>
            ))}
          </div>
        </Field>

        {/* item picker */}
        <Field label={t('inv.field.item')}>
          <ItemPicker items={meta.items} value={itemId} onChange={setItemId} />
        </Field>

        {/* locations per direction rule */}
        <div className="grid sm:grid-cols-2 gap-4">
          {rule.from && (
            <Field label={t('inv.new.fromLabel')}>
              <SelBox value={fromId} onChange={setFromId} options={locOptions} />
            </Field>
          )}
          {rule.to && (
            <Field label={t('inv.new.toLabel')}>
              <SelBox value={toId} onChange={setToId} options={locOptions} />
            </Field>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label={t('inv.new.qtyLabel')}>
            <input
              type="number"
              min={1}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent tabular-nums"
            />
          </Field>
          <Field label={t('inv.field.date')}>
            <input
              type="date"
              value={movedAt}
              onChange={(e) => setMovedAt(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent"
            />
          </Field>
          <Field label={t('inv.field.eventOptional')}>
            <SelBox value={eventId} onChange={setEventId}
              options={[['', t('inv.none')], ...meta.events.map((e) => [e.id, `${e.code} ${e.title}`] as [string, string])]} />
          </Field>
        </div>

        <Field label={t('inv.field.remarkOptional')}>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('inv.new.notePlaceholder')}
            className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
          />
        </Field>

        <Field label={t('inv.new.photoLabel')}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-ink-muted file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border-strong file:bg-surface file:text-ink"
          />
        </Field>

        {error && (
          <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button onClick={submit} disabled={saving} className="px-5 py-2 text-sm btn-primary">
            {saving ? t('inv.new.saving') : t('inv.new.submit')}
          </button>
          <button
            onClick={() => router.push('/dashboard/inventory/movements')}
            className="px-4 py-2 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition"
          >
            {t('inv.cancel')}
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-faint">
        {t('inv.new.footer')}
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
