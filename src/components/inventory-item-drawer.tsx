// src/components/inventory-item-drawer.tsx
// Shared right-side drawer = one品项's full档案, opened from search / dashboard / any list.
// Loads /api/dashboard/inventory/items/[id]: photo (private, via a signed media-url), the
// per-location balances, and the last 10 movements. Quick links jump to 记录变动 / 变动记录
// pre-filtered to this item. 编辑 shows only with an edit grant (calls onEdit, else links to
// 品项管理).

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  MOVEMENT_TYPE_LABELS,
  MOVEMENT_TYPE_STYLES,
  categoryPillClass,
} from '@/lib/inventory-display';

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
type Balance = { location_id: string; location_kind: string; location_name: string; qty: number };
type Lite = { name_cn: string } | { name_cn: string }[] | null;
type Movement = {
  id: string;
  movement_type: string;
  qty: number;
  moved_at: string;
  photo_path: string | null;
  reversal_of: string | null;
  from_location: Lite;
  to_location: Lite;
};

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export function InventoryItemDrawer({
  itemId,
  onClose,
  canEdit,
  onEdit,
}: {
  itemId: string | null;
  onClose: () => void;
  canEdit: boolean;
  onEdit?: (item: Item) => void;
}) {
  const [item, setItem] = useState<Item | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [photoUrl, setPhotoUrl] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!itemId) return;
    let active = true;
    setLoading(true);
    setItem(null);
    setBalances([]);
    setMovements([]);
    setPhotoUrl('');
    fetch(`/api/dashboard/inventory/items/${itemId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!active || !j) return;
        setItem(j.item);
        setBalances(j.balances ?? []);
        setMovements(j.movements ?? []);
        if (j.item?.photo_path) {
          fetch(`/api/dashboard/inventory/media-url?path=${encodeURIComponent(j.item.photo_path)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((m) => {
              if (active && m?.url) setPhotoUrl(m.url);
            })
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [itemId]);

  if (!itemId) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-[min(460px,94vw)] bg-surface border-l border-border overflow-y-auto p-5">
        <button onClick={onClose} className="float-right text-lg text-ink-faint hover:text-ink" aria-label="关闭">
          ✕
        </button>

        {loading && !item ? (
          <p className="text-sm text-ink-muted">加载中…</p>
        ) : !item ? (
          <p className="text-sm text-ink-muted">无法加载此品项。</p>
        ) : (
          <>
            <div className="flex gap-3 items-start">
              <div className="w-20 h-20 rounded-xl bg-surface-soft border border-border grid place-items-center overflow-hidden shrink-0 text-3xl">
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl} alt={item.name_cn} className="w-full h-full object-cover" />
                ) : (
                  '📦'
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-ink">{item.name_cn}</h3>
                <p className="text-xs text-ink-faint mt-0.5">
                  {item.stock_id ? <span className="font-mono">{item.stock_id}</span> : '未编号'}
                  {item.category_cn && (
                    <span className={`ml-1.5 inline-block px-2 py-0.5 rounded-full text-[11px] ${categoryPillClass(item.category_cn)}`}>
                      {item.category_cn}
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-faint mt-1">
                  {item.pack_qty ? `每包 ${item.pack_qty}` : '每包 –'} · 低库存线 {item.low_stock_line ?? '–'}
                  {!item.is_active && <span className="ml-1.5 pill-muted inline-block px-2 py-0.5 rounded-full text-[11px]">已停用</span>}
                </p>
              </div>
            </div>

            {item.remark && <p className="mt-3 text-xs text-ink-muted bg-surface-soft rounded-lg px-3 py-2 leading-relaxed">{item.remark}</p>}

            <div className="flex flex-wrap gap-1.5 my-3">
              {canEdit && (
                <Link href={`/dashboard/inventory/movements/new?item=${item.id}`} className="px-3 py-1.5 text-xs border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">
                  ＋记录变动
                </Link>
              )}
              <Link href={`/dashboard/inventory/movements?item=${item.id}`} className="px-3 py-1.5 text-xs border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">
                变动记录
              </Link>
              {canEdit &&
                (onEdit ? (
                  <button onClick={() => onEdit(item)} className="px-3 py-1.5 text-xs border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">
                    ✏️ 编辑
                  </button>
                ) : (
                  <Link href="/dashboard/inventory/catalog" className="px-3 py-1.5 text-xs border border-border-strong rounded-lg bg-surface text-ink hover:border-accent transition">
                    ✏️ 编辑
                  </Link>
                ))}
            </div>

            <h4 className="text-sm font-semibold text-ink mt-4 mb-1">📍 各仓分布</h4>
            {balances.length === 0 ? (
              <p className="text-xs text-ink-faint py-1.5">各仓皆无库存。</p>
            ) : (
              balances.map((b) => (
                <div key={b.location_id} className="flex justify-between text-[13px] py-1.5 border-b border-dashed border-border">
                  <span className="text-ink">{b.location_kind === 'hq_warehouse' ? `🏛️ ${b.location_name}` : b.location_name}</span>
                  <b className="tabular-nums text-ink">{b.qty.toLocaleString()}</b>
                </div>
              ))
            )}

            <h4 className="text-sm font-semibold text-ink mt-4 mb-1">🕘 最近变动</h4>
            {movements.length === 0 ? (
              <p className="text-xs text-ink-faint py-1.5">还没有变动记录。</p>
            ) : (
              movements.map((m) => {
                const fromL = one(m.from_location);
                const toL = one(m.to_location);
                const isReversal = !!m.reversal_of;
                return (
                  <div key={m.id} className="flex justify-between items-start gap-2 text-[12px] py-1.5 border-b border-dashed border-border">
                    <span className="text-ink-muted">
                      <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] mr-1 ${isReversal ? 'bg-surface-soft text-ink-faint border border-border' : MOVEMENT_TYPE_STYLES[m.movement_type] ?? ''}`}>
                        {isReversal ? '更正撤销' : MOVEMENT_TYPE_LABELS[m.movement_type] ?? m.movement_type}
                      </span>
                      {m.photo_path && <span title="有存证照片">📷 </span>}
                      <span className="text-ink-faint">{m.moved_at}</span>
                      <span className="block text-ink-faint mt-0.5">{fromL?.name_cn ?? '—'} → {toL?.name_cn ?? '—'}</span>
                    </span>
                    <b className="tabular-nums text-ink whitespace-nowrap">{m.qty.toLocaleString()}</b>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
