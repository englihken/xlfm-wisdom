// src/app/dashboard/inventory/catalog/page.tsx
// 品项管理 — the catalog: category_cn chips + search, the item list (停用 items shown too so
// they can be 启用), ＋新品项 / 编辑 modals (photo optional, uploaded to inventory-media) and a
// 停用/启用 toggle. Row click opens the shared drawer (its 编辑 reuses this page's modal).
// inventory:edit required for every mutation. NO Excel import / labels / 盘点模式 (those are 023B).

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { InventoryTabs, InventorySearchRow, type SearchItem } from '@/components/inventory-chrome';
import { InventoryItemDrawer } from '@/components/inventory-item-drawer';
import { categoryPillClass } from '@/lib/inventory-display';
import { useT } from '@/lib/i18n-react';

type Item = {
  id: string;
  stock_id: string | null;
  name_cn: string;
  category_cn: string | null;
  remark: string | null;
  pack_qty: number | null;
  low_stock_line: number | null;
  photo_path: string | null;
  is_active: boolean;
};

export default function CatalogPage() {
  const t = useT();
  return (
    <ErpGate active="inventory" module="inventory" titleSuffix={t('inv.suffix.catalog')}>
      {(me) => <Catalog me={me} />}
    </ErpGate>
  );
}

function Catalog({ me }: { me: ErpMe }) {
  const t = useT();
  const canEdit = grantAllows(me.grants, 'inventory', 'edit');

  const [items, setItems] = useState<Item[]>([]);
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [categoriesCn, setCategoriesCn] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const printLabels = () => {
    if (selected.size === 0) return;
    window.open(`/dashboard/inventory/labels?ids=${[...selected].join(',')}`, '_blank');
  };

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/dashboard/inventory/items?include_inactive=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) setItems(j.items ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/inventory/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (!active || !meta) return;
        setSearchItems(meta.items ?? []);
        setCategoriesCn(meta.categoriesCn ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (i) =>
        (!category || i.category_cn === category) &&
        (!q || i.name_cn.toLowerCase().includes(q) || (i.stock_id ?? '').toLowerCase().includes(q))
    );
  }, [items, category, search]);

  const toggleActive = async (it: Item) => {
    await fetch(`/api/dashboard/inventory/items/${it.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !it.is_active }),
    });
    load();
  };

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold font-serif text-ink">{t('inv.catalog.title')}</h2>
        <span className="text-sm text-ink-faint">Catalog · {items.length}</span>
      </div>

      <InventorySearchRow items={searchItems} onPick={setDrawerId} />
      <InventoryTabs active="catalog" />

      {/* category chips + search + add */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip label={t('inv.all')} active={category === ''} onClick={() => setCategory('')} />
        {categoriesCn.map((c) => (
          <Chip key={c} label={c} active={category === c} onClick={() => setCategory(c)} />
        ))}
        <span className="flex-1" />
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('inv.searchNameCode')}
          className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent w-44" />
        <button onClick={printLabels} disabled={selected.size === 0} className="px-3 py-2 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition disabled:opacity-45">
          {selected.size > 0 ? t('inv.catalog.printLabelsN', { n: selected.size }) : t('inv.catalog.printLabels')}
        </button>
        {canEdit && (
          <>
            <button onClick={() => setShowImport(true)} className="px-3 py-2 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">{t('inv.catalog.csvImport')}</button>
            <button onClick={() => setEditing('new')} className="px-4 py-2 text-sm btn-primary">{t('inv.catalog.newItem')}</button>
          </>
        )}
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">{t('inv.loading')}</p>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center"><p className="text-2xl mb-1">🪷</p><p className="text-sm text-ink">{t('inv.catalog.noMatch')}</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <th className="pl-4 pr-1 py-2.5 font-normal w-8"></th>
                  <Th>{t('inv.th.code')}</Th><Th>{t('inv.th.item')}</Th><Th>{t('inv.th.category')}</Th>
                  <th className="px-4 py-2.5 font-normal text-right">{t('inv.th.lowLine')}</th>
                  <Th>{t('inv.th.status')}</Th>{canEdit && <Th>{t('inv.th.actions')}</Th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <tr key={it.id} className="border-b border-border last:border-b-0 hover:bg-accent/5">
                    <td className="pl-4 pr-1 py-2.5">
                      <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleSel(it.id)} className="accent-[#B8860B]" aria-label={t('inv.catalog.selectForLabels')} />
                    </td>
                    <td className="px-4 py-2.5 cursor-pointer" onClick={() => setDrawerId(it.id)}>
                      {it.stock_id ? <span className="font-mono text-xs text-ink">{it.stock_id}</span> : <span className="pill-muted inline-block px-2 py-0.5 rounded-full text-[11px]">{t('inv.unnumbered')}</span>}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-ink cursor-pointer" onClick={() => setDrawerId(it.id)}>{it.name_cn}</td>
                    <td className="px-4 py-2.5">
                      {it.category_cn ? <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${categoryPillClass(it.category_cn)}`}>{it.category_cn}</span> : <span className="text-ink-faint">–</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-faint">{it.low_stock_line ?? '–'}</td>
                    <td className="px-4 py-2.5">
                      {it.is_active
                        ? <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#E7F0E0] text-[#3F6B2E]">{t('inv.catalog.active')}</span>
                        : <span className="pill-muted inline-block px-2 py-0.5 rounded-full text-[11px]">{t('inv.catalog.inactive')}</span>}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1.5">
                          <button onClick={() => setEditing(it)} className="px-2 py-1 text-xs border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">{t('inv.edit')}</button>
                          <button onClick={() => toggleActive(it)} className="px-2 py-1 text-xs border border-border-strong rounded-lg bg-surface text-ink-muted hover:border-accent transition">{it.is_active ? t('inv.deactivate') : t('inv.activate')}</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <ItemFormModal
          item={editing === 'new' ? null : editing}
          categories={categoriesCn}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onDone={() => load()}
        />
      )}

      <InventoryItemDrawer itemId={drawerId} onClose={() => setDrawerId(null)} canEdit={canEdit} onEdit={(it) => { setDrawerId(null); setEditing(it as Item); }} />
    </div>
  );
}

// ---- CSV import ----
const IMPORT_COLS = ['name_cn', 'category_cn', 'stock_id', 'pack_qty', 'low_stock_line', 'remark'] as const;
type ImportRow = Record<(typeof IMPORT_COLS)[number], string>;

// Minimal RFC-4180-ish parser: handles quoted fields containing commas / quotes / newlines.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Returns an i18n key for the first validation failure, or null when the row is valid.
function validateRow(r: ImportRow): string | null {
  if (!r.name_cn.trim()) return 'inv.import.errNoName';
  if (!r.category_cn.trim()) return 'inv.import.errNoCategory';
  for (const k of ['pack_qty', 'low_stock_line'] as const) {
    const v = r[k].trim();
    if (v && (!/^\d+$/.test(v) || Number(v) <= 0)) return k === 'pack_qty' ? 'inv.import.errPackQtyInt' : 'inv.import.errLowLineInt';
  }
  return null;
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [results, setResults] = useState<{ row: number; ok: boolean; name_cn: string; error?: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [parseErr, setParseErr] = useState('');

  const downloadTemplate = () => {
    const csv = IMPORT_COLS.join(',') + '\r\n' + '念佛机,法器·念佛机,,1,50,示例备注\r\n';
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = t('inv.import.templateFile');
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File) => {
    setParseErr('');
    setResults(null);
    const text = await file.text();
    const grid = parseCsv(text);
    if (grid.length < 2) {
      setParseErr(t('inv.import.errMinRows'));
      setRows([]);
      return;
    }
    const header = grid[0].map((h) => h.trim().toLowerCase());
    const idx: Record<string, number> = {};
    for (const col of IMPORT_COLS) idx[col] = header.indexOf(col);
    if (idx.name_cn < 0 || idx.category_cn < 0) {
      setParseErr(t('inv.import.errHeader'));
      setRows([]);
      return;
    }
    const parsed: ImportRow[] = grid.slice(1).map((cells) => {
      const r = {} as ImportRow;
      for (const col of IMPORT_COLS) r[col] = idx[col] >= 0 ? (cells[idx[col]] ?? '').trim() : '';
      return r;
    });
    setRows(parsed);
  };

  const validCount = rows.filter((r) => validateRow(r) === null).length;

  const doImport = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/inventory/items/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rows.map((r) => ({ ...r })) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setParseErr(j.error ?? t('inv.import.failed'));
      } else {
        setResults(j.results ?? []);
        onDone();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-ink/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl max-w-2xl w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-ink mb-1">{t('inv.import.title')}</h3>
        <p className="text-xs text-ink-muted mb-3">
          {t('inv.import.colsHint')}
          <button onClick={downloadTemplate} className="ml-1 text-accent-deep hover:underline">{t('inv.import.downloadTemplate')}</button>
        </p>

        {parseErr && <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2 mb-2">{parseErr}</p>}

        {!results && (
          <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            className="w-full text-xs text-ink-muted mb-3 file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border-strong file:bg-surface file:text-ink" />
        )}

        {!results && rows.length > 0 && (
          <>
            <p className="text-xs text-ink-muted mb-1">{t('inv.import.preview', { n: rows.length, valid: validCount })}</p>
            <div className="border border-border rounded-lg overflow-auto max-h-64 mb-3">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-soft">
                  <tr className="text-left text-ink-faint"><th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">{t('inv.import.thName')}</th><th className="px-2 py-1.5">{t('inv.th.category')}</th><th className="px-2 py-1.5">{t('inv.th.code')}</th><th className="px-2 py-1.5">{t('inv.import.thValidate')}</th></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const err = validateRow(r);
                    return (
                      <tr key={i} className="border-t border-border">
                        <td className="px-2 py-1 text-ink-faint">{i + 1}</td>
                        <td className="px-2 py-1 text-ink">{r.name_cn}</td>
                        <td className="px-2 py-1 text-ink-muted">{r.category_cn}</td>
                        <td className="px-2 py-1 font-mono text-ink-muted">{r.stock_id || '—'}</td>
                        <td className={`px-2 py-1 ${err ? 'text-[#B4402E]' : 'text-[#3F6B2E]'}`}>{err ? t(err) : '✓'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {results && (
          <div className="border border-border rounded-lg overflow-auto max-h-72 mb-3">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-soft"><tr className="text-left text-ink-faint"><th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">{t('inv.import.thName')}</th><th className="px-2 py-1.5">{t('inv.import.thResult')}</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.row} className="border-t border-border">
                    <td className="px-2 py-1 text-ink-faint">{r.row}</td>
                    <td className="px-2 py-1 text-ink">{r.name_cn}</td>
                    <td className={`px-2 py-1 ${r.ok ? 'text-[#3F6B2E]' : 'text-[#B4402E]'}`}>{r.ok ? t('inv.import.imported') : r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{results ? t('inv.done') : t('inv.cancel')}</button>
          {!results && (
            <button disabled={busy || validCount === 0} onClick={doImport} className="px-5 py-1.5 text-sm btn-primary">
              {busy ? t('inv.import.importing') : t('inv.import.importN', { n: validCount })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-full text-xs border transition ${active ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border-strong hover:border-accent'}`}>
      {label}
    </button>
  );
}

function ItemFormModal({ item, categories, onClose, onDone }: { item: Item | null; categories: string[]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [nameCn, setNameCn] = useState(item?.name_cn ?? '');
  const [categoryCn, setCategoryCn] = useState(item?.category_cn ?? '');
  const [stockId, setStockId] = useState(item?.stock_id ?? '');
  const [remark, setRemark] = useState(item?.remark ?? '');
  const [packQty, setPackQty] = useState(item?.pack_qty != null ? String(item.pack_qty) : '');
  const [lowLine, setLowLine] = useState(item?.low_stock_line != null ? String(item.low_stock_line) : '');
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    if (!nameCn.trim()) return setErr(t('inv.form.errName'));
    if (!categoryCn.trim()) return setErr(t('inv.form.errCategory'));
    setBusy(true);
    try {
      let photoPath: string | undefined;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        const up = await fetch('/api/dashboard/inventory/upload?kind=photo', { method: 'POST', body: fd });
        const uj = await up.json().catch(() => ({}));
        if (!up.ok || !uj.path) {
          setErr(uj.error ?? t('inv.photoUploadFailed'));
          setBusy(false);
          return;
        }
        photoPath = uj.path;
      }
      const payload: Record<string, unknown> = {
        name_cn: nameCn.trim(),
        category_cn: categoryCn.trim(),
        stock_id: stockId.trim() || null,
        remark: remark.trim() || null,
        pack_qty: packQty.trim() || null,
        low_stock_line: lowLine.trim() || null,
      };
      if (photoPath) payload.photo_path = photoPath;

      const res = item
        ? await fetch(`/api/dashboard/inventory/items/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/dashboard/inventory/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? t('inv.saveFailed'));
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-ink/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-ink mb-3">{item ? t('inv.form.editTitle') : t('inv.form.newTitle')}</h3>
        {err && <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2 mb-2">{err}</p>}

        <Field label={t('inv.form.nameLabel')}><input value={nameCn} onChange={(e) => setNameCn(e.target.value)} className={inputCls} /></Field>
        <Field label={t('inv.form.categoryLabel')}>
          <input list="cat-list" value={categoryCn} onChange={(e) => setCategoryCn(e.target.value)} className={inputCls} placeholder={t('inv.form.categoryPlaceholder')} />
          <datalist id="cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('inv.form.stockIdLabel')}><input value={stockId} onChange={(e) => setStockId(e.target.value)} className={inputCls} /></Field>
          <Field label={t('inv.form.packQtyLabel')}><input type="number" min={1} value={packQty} onChange={(e) => setPackQty(e.target.value)} className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('inv.form.lowLineLabel')}><input type="number" min={1} value={lowLine} onChange={(e) => setLowLine(e.target.value)} className={inputCls} /></Field>
          <Field label={t('inv.form.photoLabel')}><input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full text-xs text-ink-muted file:mr-2 file:px-2 file:py-1 file:rounded file:border file:border-border-strong file:bg-surface file:text-ink" /></Field>
        </div>
        <Field label={t('inv.form.remarkLabel')}><input value={remark} onChange={(e) => setRemark(e.target.value)} className={inputCls} /></Field>

        <div className="flex gap-2 justify-end mt-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">{t('inv.cancel')}</button>
          <button disabled={busy} onClick={submit} className="px-5 py-1.5 text-sm btn-primary">{busy ? t('inv.saving') : t('inv.save')}</button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <label className="block text-xs text-ink-muted mb-1">{label}</label>
      {children}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-normal">{children}</th>;
}
