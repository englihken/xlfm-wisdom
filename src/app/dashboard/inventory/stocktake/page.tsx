// src/app/dashboard/inventory/stocktake/page.tsx
// 盘点模式 — guided stock-take. List of sessions + 新盘点 (location + scope 分类/全仓); a session
// view with a lines table (品项 / 系统数 / 实点数 input / 差异 live), progress, 存草稿, 打印盘点清单
// (opens a print window), 📷 扫码 to jump to a row, and a confirm modal ("N 笔差异, M 项未点").
// Confirming applies counted-wins adjustments (server) and returns any drift warnings. Confirmed
// sessions render read-only with their linked adjustments. inventory:edit to count/confirm.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { InventoryTabs, InventorySearchRow, ScanButton, type SearchItem } from '@/components/inventory-chrome';
import { InventoryItemDrawer } from '@/components/inventory-item-drawer';

type Loc = { id: string; name_cn: string; kind: string };
type SessionMeta = {
  id: string;
  category_cn: string | null;
  status: string;
  created_at: string;
  confirmed_at: string | null;
  location: Loc | Loc[] | null;
  lineCount: number;
  countedCount: number;
};
type ItemLite = { id: string; stock_id: string | null; name_cn: string; category_cn: string | null };
type Line = { id: string; item_id: string; system_qty: number; counted_qty: number | null; item: ItemLite | ItemLite[] | null };

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
const locName = (l: Loc | null) => (l ? (l.kind === 'hq_warehouse' ? `🏛️ ${l.name_cn}` : l.name_cn) : '—');

export default function StocktakePage() {
  return (
    <ErpGate active="inventory" module="inventory" titleSuffix="盘点模式">
      {(me) => <Stocktake me={me} />}
    </ErpGate>
  );
}

function Stocktake({ me }: { me: ErpMe }) {
  const canEdit = grantAllows(me.grants, 'inventory', 'edit');
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    fetch('/api/dashboard/inventory/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (m) setItems(m.items ?? []);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold font-serif text-ink">📋 盘点模式</h2>
        <span className="text-sm text-ink-faint">Stock-take</span>
      </div>

      <InventorySearchRow items={items} onPick={setDrawerId} />
      <InventoryTabs active="stocktake" />

      {flash && <p className="text-sm text-[#3F6B2E] bg-[#E7F0E0] border border-[#3F6B2E]/20 rounded-lg px-3 py-2">{flash}</p>}

      {selected ? (
        <SessionView id={selected} canEdit={canEdit} onBack={() => setSelected(null)} onFlash={setFlash} />
      ) : (
        <SessionList canEdit={canEdit} onOpen={(id) => { setFlash(''); setSelected(id); }} />
      )}

      <InventoryItemDrawer itemId={drawerId} onClose={() => setDrawerId(null)} canEdit={canEdit} />
    </div>
  );
}

// ---------------- session list + new ----------------
function SessionList({ canEdit, onOpen }: { canEdit: boolean; onOpen: (id: string) => void }) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/dashboard/inventory/stocktakes')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) setSessions(j.stocktakes ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm text-ink-muted">法会前全仓盘点用这个，不用一项一项改。</p>
        {canEdit && <button onClick={() => setShowNew(true)} className="px-4 py-1.5 text-sm btn-primary">＋ 新盘点</button>}
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">加载中…</p>
        ) : sessions.length === 0 ? (
          <div className="p-10 text-center"><p className="text-2xl mb-1">🪷</p><p className="text-sm text-ink">还没有盘点记录。</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                <th className="px-4 py-2.5 font-normal">地点 / 范围</th><th className="px-4 py-2.5 font-normal">进度</th>
                <th className="px-4 py-2.5 font-normal">状态</th><th className="px-4 py-2.5 font-normal">时间</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const l = one(s.location);
                return (
                  <tr key={s.id} onClick={() => onOpen(s.id)} className="border-b border-border last:border-b-0 hover:bg-accent/5 cursor-pointer">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-ink">{locName(l)}</span>
                      <span className="ml-1.5 text-xs text-ink-muted">{s.category_cn ?? '全仓'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted tabular-nums">已点 {s.countedCount} / {s.lineCount}</td>
                    <td className="px-4 py-2.5"><StatusPill status={s.status} /></td>
                    <td className="px-4 py-2.5 text-xs text-ink-faint">{(s.confirmed_at ?? s.created_at)?.slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showNew && <NewSessionModal onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); onOpen(id); }} />}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    draft: ['进行中', 'bg-white border border-gold-border text-accent-deep'],
    confirmed: ['已确认', 'bg-[#E7F0E0] text-[#3F6B2E]'],
    cancelled: ['已取消', 'bg-surface-soft text-ink-faint border border-border'],
  };
  const [label, cls] = map[status] ?? [status, ''];
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${cls}`}>{label}</span>;
}

function NewSessionModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [locations, setLocations] = useState<Loc[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [scope, setScope] = useState(''); // '' = 全仓
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/dashboard/inventory/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!m) return;
        setLocations(m.locations ?? []);
        setCategories(m.categoriesCn ?? []);
        const hq = (m.locations ?? []).find((l: Loc) => l.kind === 'hq_warehouse');
        setLocation((c) => c || hq?.id || m.locations?.[0]?.id || '');
      })
      .catch(() => {});
  }, []);

  const create = async () => {
    setErr('');
    if (!location) return setErr('请选择盘点地点');
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/inventory/stocktakes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: location, category_cn: scope || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? '创建失败');
      else onCreated(j.stocktake.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-ink/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-ink mb-3">新盘点</h3>
        {err && <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2 mb-2">{err}</p>}
        <label className="block text-xs text-ink-muted mb-1">盘点地点</label>
        <select value={location} onChange={(e) => setLocation(e.target.value)} className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent mb-2">
          {locations.map((l) => <option key={l.id} value={l.id}>{locName(l)}</option>)}
        </select>
        <label className="block text-xs text-ink-muted mb-1">范围</label>
        <select value={scope} onChange={(e) => setScope(e.target.value)} className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent mb-3">
          <option value="">全仓（所有分类）</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">取消</button>
          <button disabled={busy} onClick={create} className="px-5 py-1.5 text-sm btn-primary">{busy ? '创建中…' : '开始盘点'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- session view ----------------
function SessionView({ id, canEdit, onBack, onFlash }: { id: string; canEdit: boolean; onBack: () => void; onFlash: (m: string) => void }) {
  const [session, setSession] = useState<SessionMeta | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [adjustments, setAdjustments] = useState<{ movement_type: string; qty: number; item: { stock_id: string | null; name_cn: string } | { stock_id: string | null; name_cn: string }[] | null }[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/dashboard/inventory/stocktakes/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setSession(j.stocktake);
        setLines(j.lines ?? []);
        setAdjustments(j.adjustments ?? []);
        const init: Record<string, string> = {};
        for (const l of j.lines ?? []) if (l.counted_qty !== null) init[l.item_id] = String(l.counted_qty);
        setCounts(init);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const isDraft = session?.status === 'draft';
  const countsPayload = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const l of lines) {
      const v = counts[l.item_id];
      out[l.item_id] = v === undefined || v === '' ? null : Number(v);
    }
    return out;
  }, [counts, lines]);

  const countedN = lines.filter((l) => counts[l.item_id] !== undefined && counts[l.item_id] !== '').length;
  const diffN = lines.filter((l) => {
    const v = counts[l.item_id];
    return v !== undefined && v !== '' && Number(v) !== l.system_qty;
  }).length;

  const saveDraft = async (silent = false) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/dashboard/inventory/stocktakes/${id}/lines`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counts: countsPayload }),
      });
      if (res.ok && !silent) onFlash('已存草稿。');
      return res.ok;
    } finally {
      setSaving(false);
    }
  };

  const confirm = async () => {
    setConfirming(true);
    try {
      const saved = await saveDraft(true);
      if (!saved) {
        setConfirming(false);
        setShowConfirm(false);
        onFlash('保存失败，请重试。');
        return;
      }
      const res = await fetch(`/api/dashboard/inventory/stocktakes/${id}/confirm`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      setShowConfirm(false);
      if (!res.ok) {
        onFlash(j.error ?? '确认失败。');
      } else {
        const drift = (j.driftWarnings ?? []).length;
        onFlash(`✅ 盘点已确认 — ${j.adjustments} 笔调整已入账，${j.skipped} 项未点跳过${drift ? `，${drift} 项在盘点中有变动（以实点为准）` : ''}。`);
        onBack();
      }
    } finally {
      setConfirming(false);
    }
  };

  const jumpTo = (itemId: string) => {
    const line = lines.find((l) => l.item_id === itemId);
    if (!line) {
      onFlash('扫到的品项不在本次盘点范围内。');
      return;
    }
    setHighlight(itemId);
    const el = inputRefs.current[itemId];
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus();
    }
  };

  const printSheet = () => {
    const l = one(session?.location ?? null);
    const rows = lines
      .map((ln) => {
        const it = one(ln.item);
        return `<tr><td>${it?.stock_id ?? '未编号'}</td><td>${escapeHtml(it?.name_cn ?? '')}</td><td class="sys">${ln.system_qty}</td><td class="blank"></td></tr>`;
      })
      .join('');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>盘点清单</title>
      <style>
        body{font-family:'Noto Sans SC',sans-serif;color:#2B2620;padding:16px}
        h1{font-size:18px;margin:0 0 4px} .meta{font-size:12px;color:#6B6154;margin-bottom:12px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th,td{border:1px solid #D9D2C2;padding:6px 8px;text-align:left}
        th{background:#F5F1E9;font-weight:600} td.sys{text-align:right;width:70px}
        td.blank{width:90px} @media print{@page{margin:12mm}}
      </style></head><body>
      <h1>📋 盘点清单 — ${escapeHtml(l ? l.name_cn : '')}</h1>
      <div class="meta">范围：${escapeHtml(session?.category_cn ?? '全仓')} · 共 ${lines.length} 项 · 拿笔逐项点，回来输入系统</div>
      <table><thead><tr><th>编号</th><th>品项</th><th>系统数</th><th>实点数</th></tr></thead><tbody>${rows}</tbody></table>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  if (loading) return <p className="p-6 text-sm text-ink-muted">加载中…</p>;
  if (!session) return <p className="p-6 text-sm text-ink-muted">盘点不存在。</p>;

  const loc = one(session.location);
  const scanItems: SearchItem[] = lines.map((l) => {
    const it = one(l.item);
    return { id: l.item_id, stock_id: it?.stock_id ?? null, name_cn: it?.name_cn ?? '' };
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button onClick={onBack} className="text-sm text-accent-deep hover:underline">← 返回列表</button>
          <p className="text-sm text-ink mt-1">
            <b>{locName(loc)}</b> · {session.category_cn ?? '全仓'} · <StatusPill status={session.status} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={printSheet} className="px-3 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">🖨️ 打印盘点清单</button>
          {isDraft && canEdit && <ScanButton items={scanItems} onPick={jumpTo} />}
        </div>
      </div>

      {isDraft && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <span className="tabular-nums">已点 {countedN} / {lines.length}</span>
          <span className="h-1.5 flex-1 max-w-xs bg-surface-soft rounded-full overflow-hidden">
            <span className="block h-full bg-accent" style={{ width: `${lines.length ? (countedN / lines.length) * 100 : 0}%` }} />
          </span>
        </div>
      )}

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                <th className="px-4 py-2.5 font-normal">品项</th>
                <th className="px-4 py-2.5 font-normal text-right">系统数</th>
                <th className="px-4 py-2.5 font-normal text-right">实点数</th>
                <th className="px-4 py-2.5 font-normal text-right">差异</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const it = one(l.item);
                const v = counts[l.item_id];
                const counted = v !== undefined && v !== '' ? Number(v) : null;
                const diff = counted === null ? null : counted - l.system_qty;
                return (
                  <tr key={l.id} className={`border-b border-border last:border-b-0 ${highlight === l.item_id ? 'bg-accent/10' : ''}`}>
                    <td className="px-4 py-2">
                      <span className="font-medium text-ink">{it?.name_cn}</span>
                      {it?.stock_id && <span className="ml-1.5 font-mono text-[10px] text-ink-muted">{it.stock_id}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{l.system_qty.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">
                      {isDraft && canEdit ? (
                        <input
                          ref={(el) => { inputRefs.current[l.item_id] = el; }}
                          type="number"
                          min={0}
                          value={v ?? ''}
                          onChange={(e) => setCounts((c) => ({ ...c, [l.item_id]: e.target.value }))}
                          placeholder="待点"
                          className="w-20 text-sm px-2 py-1 border border-border-strong rounded-lg bg-surface text-ink text-right focus:outline-none focus:border-accent tabular-nums"
                        />
                      ) : (
                        <span className="tabular-nums text-ink">{l.counted_qty ?? '—'}</span>
                      )}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums font-semibold ${diff == null ? 'text-ink-faint' : diff > 0 ? 'text-[#3F6B2E]' : diff < 0 ? 'text-[#B4402E]' : 'text-ink-faint'}`}>
                      {diff == null ? '–' : diff === 0 ? '0' : diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {isDraft && canEdit && (
        <div className="flex flex-wrap gap-2">
          <button disabled={confirming || countedN === 0} onClick={() => setShowConfirm(true)} className="px-5 py-2 text-sm btn-primary">确认盘点</button>
          <button disabled={saving} onClick={() => saveDraft()} className="px-4 py-2 text-sm border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">{saving ? '保存中…' : '存草稿'}</button>
          <CancelDraft id={id} onDone={onBack} />
        </div>
      )}

      {session.status === 'confirmed' && adjustments.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-ink mb-2">本次盘点产生的调整（{adjustments.length}）</h3>
          <div className="space-y-1">
            {adjustments.map((a, i) => {
              const it = one(a.item);
              return (
                <div key={i} className="flex justify-between text-xs text-ink-muted border-b border-dashed border-border pb-1 last:border-b-0">
                  <span>{it?.name_cn} {it?.stock_id && <span className="font-mono text-[10px]">{it.stock_id}</span>}</span>
                  <span className={a.movement_type === 'adjust_in' ? 'text-[#3F6B2E]' : 'text-[#B4402E]'}>{a.movement_type === 'adjust_in' ? '+' : '−'}{a.qty}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 z-[70] bg-ink/45 flex items-center justify-center p-4" onClick={() => setShowConfirm(false)}>
          <div className="bg-surface rounded-2xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-ink mb-2">确认盘点</h3>
            <p className="text-sm text-ink-muted mb-3 leading-relaxed">
              有 <b className="text-ink">{diffN}</b> 笔差异，<b className="text-ink">{lines.length - countedN}</b> 项未点（未点的会跳过，不改动）。确认后为每笔差异生成盘点调增/调减，系统数对齐实点数。差异不追究。
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-1.5 text-sm border border-border-strong rounded-lg bg-surface text-ink">再想想</button>
              <button disabled={confirming} onClick={confirm} className="px-5 py-1.5 text-sm btn-primary">{confirming ? '确认中…' : '确认入账'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CancelDraft({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    setBusy(true);
    try {
      await fetch(`/api/dashboard/inventory/stocktakes/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button disabled={busy} onClick={cancel} className="px-4 py-2 text-sm border border-border-strong rounded-lg bg-surface text-ink-muted hover:border-[#B4402E] transition">
      {busy ? '…' : '取消盘点'}
    </button>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}
