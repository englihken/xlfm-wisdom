// src/app/dashboard/inventory/labels/page.tsx
// 大件标签 print view — /dashboard/inventory/labels?ids=a,b,c. Renders an A4 grid (2 cols) of
// labels for the chosen items: name_cn LARGE, stock_id mono (or 未编号), category pill, and a QR
// encoding `${origin}/dashboard/inventory?item=<id>` (scanning it opens that item). Print with
// Ctrl+P — a print stylesheet shows ONLY the label sheet (the dashboard chrome is hidden).
// inventory:view. Selective by design: stick these on big items (菩萨像/器材/整箱) — books don't need one.

'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ErpGate } from '@/components/erp-gate';
import { QrSvg } from '@/components/qr-svg';
import { categoryPillClass } from '@/lib/inventory-display';

type Item = { id: string; stock_id: string | null; name_cn: string; category_cn: string | null };

export default function LabelsPage() {
  return (
    <ErpGate active="inventory" module="inventory" titleSuffix="打印标签">
      {() => (
        <Suspense fallback={<p className="p-6 text-sm text-ink-muted">加载中…</p>}>
          <Labels />
        </Suspense>
      )}
    </ErpGate>
  );
}

function Labels() {
  const sp = useSearchParams();
  const ids = useMemo(() => (sp.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean), [sp]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    fetch('/api/dashboard/inventory/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!m) return;
        const set = new Set(ids);
        setItems((m.items ?? []).filter((i: Item) => set.has(i.id)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ids]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      {/* print rule: show ONLY #label-sheet */}
      <style>{`@media print { body * { visibility: hidden !important; } #label-sheet, #label-sheet * { visibility: visible !important; } #label-sheet { position: absolute; left: 0; top: 0; width: 100%; } @page { margin: 12mm; } }`}</style>

      <div className="flex items-center justify-between gap-2 mb-4 print:hidden">
        <div>
          <h2 className="text-xl font-bold font-serif text-ink">🏷️ 打印标签</h2>
          <p className="text-sm text-ink-faint">{items.length} 张 · 用普通 A4 打印机印出，贴在大件/整箱上；手机扫 QR 直达品项。</p>
        </div>
        <button onClick={() => window.print()} disabled={items.length === 0} className="px-4 py-2 text-sm btn-primary">🖨️ 打印 (Ctrl+P)</button>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">加载中…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">没有可打印的品项。请从「品项管理」勾选后再打印。</p>
      ) : (
        <div id="label-sheet" className="grid grid-cols-2 gap-4">
          {items.map((it) => (
            <div key={it.id} className="border border-border rounded-xl p-4 flex items-center gap-4" style={{ breakInside: 'avoid' }}>
              <QrSvg text={`${origin}/dashboard/inventory?item=${it.id}`} px={110} />
              <div className="min-w-0">
                <div className="text-xl font-bold text-ink leading-tight break-words">{it.name_cn}</div>
                <div className="mt-1 font-mono text-xs text-ink-muted">{it.stock_id ?? '未编号'}</div>
                {it.category_cn && <span className={`mt-1.5 inline-block px-2 py-0.5 rounded-full text-[11px] ${categoryPillClass(it.category_cn)}`}>{it.category_cn}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
