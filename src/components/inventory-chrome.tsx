// src/components/inventory-chrome.tsx
// Shared chrome for every 库存 page: the tab row (仪表板 · 库存明细 · 分会申请 · 变动记录 ·
// 品项管理) and the global item search box (client-side over the meta item list — the front
// door to 245+ items; a hit opens the shared item drawer via onPick). No server imports.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { itemLabel } from '@/lib/inventory-display';

export type InvTabKey = 'dash' | 'stock' | 'requests' | 'ledger' | 'catalog' | 'stocktake';

const TABS: { key: InvTabKey; label: string; href: string }[] = [
  { key: 'dash', label: '📊 仪表板', href: '/dashboard/inventory' },
  { key: 'stock', label: '库存明细', href: '/dashboard/inventory/stock' },
  { key: 'requests', label: '分会申请', href: '/dashboard/inventory/requests' },
  { key: 'stocktake', label: '📋 盘点', href: '/dashboard/inventory/stocktake' },
  { key: 'ledger', label: '变动记录', href: '/dashboard/inventory/movements' },
  { key: 'catalog', label: '品项管理', href: '/dashboard/inventory/catalog' },
];

export function InventoryTabs({ active }: { active: InvTabKey }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`px-3.5 py-2 rounded-lg text-sm border transition ${
            t.key === active
              ? 'bg-accent text-white border-accent'
              : 'bg-surface text-ink border-border-strong hover:border-accent'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export type SearchItem = { id: string; stock_id: string | null; name_cn: string; category_cn?: string | null };

// The shared front-door row on every 库存 page: global item search + 📷 扫码, both opening the
// item drawer via onPick.
export function InventorySearchRow({ items, onPick }: { items: SearchItem[]; onPick: (id: string) => void }) {
  return (
    <div className="flex items-start gap-2">
      <GlobalItemSearch items={items} onPick={onPick} />
      <ScanButton items={items} onPick={onPick} />
    </div>
  );
}

// ---- 手机扫码: camera scan → item drawer ----

// Resolve a scanned QR/barcode payload to an item id: our own `…?item=<uuid>` URL, a raw uuid,
// or an exact StockID (looked up in the meta item list). Returns null if it's not ours.
function resolveScan(raw: string, items: SearchItem[]): string | null {
  const s = raw.trim();
  const m = s.match(/[?&]item=([0-9a-fA-F-]{36})/);
  if (m) return m[1];
  if (/^[0-9a-fA-F-]{36}$/.test(s)) return s;
  const byStock = items.find((i) => (i.stock_id ?? '').toLowerCase() === s.toLowerCase());
  return byStock ? byStock.id : null;
}

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

export function ScanButton({ items, onPick }: { items: SearchItem[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="px-4 py-2.5 text-sm border border-border-strong rounded-xl bg-surface text-ink hover:border-accent transition whitespace-nowrap">
        📷 扫码
      </button>
      {open && <ScanModal items={items} onClose={() => setOpen(false)} onPick={(id) => { setOpen(false); onPick(id); }} />}
    </>
  );
}

function ScanModal({ items, onClose, onPick }: { items: SearchItem[]; onClose: () => void; onPick: (id: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const itemsRef = useRef(items);
  const pickRef = useRef(onPick);
  itemsRef.current = items;
  pickRef.current = onPick;
  const [err, setErr] = useState('');
  const [status, setStatus] = useState('正在开启相机…');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let detector: Detector | null = null;
    type JsQr = (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null;
    let jsQR: JsQr | null = null;
    const canvas = document.createElement('canvas');

    const cleanup = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };

    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          let raw: string | null = null;
          if (detector) {
            const codes = await detector.detect(video);
            if (codes.length) raw = codes[0].rawValue;
          } else if (jsQR) {
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (w && h) {
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(video, 0, 0, w, h);
                const img = ctx.getImageData(0, 0, w, h);
                const code = jsQR(img.data, w, h);
                if (code) raw = code.data;
              }
            }
          }
          if (raw) {
            const id = resolveScan(raw, itemsRef.current);
            if (id) {
              cleanup();
              pickRef.current(id);
              return;
            }
            setStatus('扫到了内容，但不是本系统的品项码 — 请对准品项标签上的二维码');
          }
        } catch {
          /* transient decode error — keep scanning */
        }
      }
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        if (BD) {
          try {
            detector = new BD({ formats: ['qr_code'] });
          } catch {
            detector = null;
          }
        }
        if (!detector) {
          try {
            jsQR = (await import('jsqr')).default as unknown as JsQr;
          } catch {
            jsQR = null;
          }
        }
        if (!detector && !jsQR) {
          setErr('此浏览器不支持扫码，请改用上方搜索框查找品项。');
          cleanup();
          return;
        }
        setStatus('把品项标签上的二维码对准取景框…');
        raf = requestAnimationFrame(tick);
      } catch {
        setErr('无法使用相机（未授权或没有摄像头）。请改用上方搜索框查找品项。');
      }
    })();

    return () => cleanup();
  }, []);

  return (
    <div className="fixed inset-0 z-[70] bg-ink/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl max-w-sm w-full p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-base font-semibold text-ink">📷 手机扫码</h3>
          <button onClick={onClose} className="text-ink-faint hover:text-ink text-lg" aria-label="关闭">✕</button>
        </div>
        {err ? (
          <p className="text-sm text-ink-muted bg-surface-soft rounded-lg px-3 py-4 text-center leading-relaxed">{err}</p>
        ) : (
          <>
            <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              <div className="absolute inset-6 border-2 border-white/70 rounded-xl pointer-events-none" />
            </div>
            <p className="mt-2 text-xs text-ink-muted text-center">{status}</p>
          </>
        )}
      </div>
    </div>
  );
}

export type PickItem = { id: string; stock_id: string | null; name_cn: string };

// Clickable-row item picker — replaces a native multi-row <select size=N> whose change
// event some browsers/automation don't fire on a plain click. Search filters the list; a
// row click selects (persisting even if a later search hides it); the 已选 line confirms it.
export function ItemPicker({ items, value, onChange }: { items: PickItem[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => i.name_cn.toLowerCase().includes(s) || (i.stock_id ?? '').toLowerCase().includes(s));
  }, [items, q]);
  const selected = items.find((i) => i.id === value) ?? null;

  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="输入名称 / 编号筛选…"
        className="w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
      />
      <div role="listbox" className="mt-1.5 max-h-48 overflow-auto border border-border-strong rounded-lg bg-surface divide-y divide-border">
        {filtered.length === 0 ? (
          <p className="px-3 py-3 text-xs text-ink-faint">没有匹配的品项</p>
        ) : (
          filtered.map((i) => {
            const isSel = i.id === value;
            return (
              <button
                key={i.id}
                type="button"
                role="option"
                aria-selected={isSel}
                onClick={() => onChange(i.id)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition ${
                  isSel ? 'bg-accent/10 text-accent-deep font-medium' : 'text-ink hover:bg-accent/5'
                }`}
              >
                <span className={`w-3.5 shrink-0 ${isSel ? 'text-accent-deep' : 'text-transparent'}`}>✓</span>
                <span className="truncate">{itemLabel(i)}</span>
              </button>
            );
          })
        )}
      </div>
      <p className="mt-1 text-[11.5px] min-h-[16px]">
        {selected
          ? <span className="text-accent-deep">已选：{itemLabel(selected)}</span>
          : <span className="text-ink-faint">在上方列表点选一个品项（共 {filtered.length} 项）</span>}
      </p>
    </div>
  );
}

export function GlobalItemSearch({ items, onPick }: { items: SearchItem[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return items
      .filter(
        (i) =>
          i.name_cn.toLowerCase().includes(s) ||
          (i.stock_id ?? '').toLowerCase().includes(s) ||
          (i.category_cn ?? '').includes(s)
      )
      .slice(0, 8);
  }, [items, q]);

  return (
    <div className="relative flex-1 min-w-[240px]">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint text-sm">🔍</span>
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={`搜索任何品项 — 名称 / 编号 / 分类…（${items.length} 项）`}
        className="w-full text-sm pl-9 pr-3 py-2.5 border-[1.5px] border-border-strong rounded-xl bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
      />
      {open && q.trim() && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-30 bg-surface border border-border-strong rounded-xl shadow-lg max-h-72 overflow-auto">
          {hits.length === 0 ? (
            <div className="px-4 py-3 text-sm text-ink-faint">没找到 — 试试别的关键字，或到「品项管理」＋新品项</div>
          ) : (
            hits.map((i) => (
              <button
                key={i.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(i.id);
                  setQ('');
                  setOpen(false);
                }}
                className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-2 border-b border-border last:border-b-0 hover:bg-accent/5"
              >
                <span className="text-sm text-ink truncate">{itemLabel(i)}</span>
                {i.category_cn && <span className="text-[11px] text-ink-faint whitespace-nowrap">{i.category_cn}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
