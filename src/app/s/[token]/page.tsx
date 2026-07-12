// src/app/s/[token]/page.tsx
// PUBLIC read-only 结缘品库存 (总会) — opened from a 分享库存表 link. NO auth, NO dashboard
// imports. On mount GETs /api/public/inventory/<token>; an invalid/revoked token shows a warm
// 链接已失效 card. Search box + category filter over the returned HQ stock list. No prices, no
// per-location breakdown, no edits.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useT } from '@/lib/i18n-react';

type Row = { name_cn: string; stock_id: string | null; category_cn: string | null; qty: number };

export default function SharePage() {
  const t = useT();
  const { token } = useParams<{ token: string }>();
  const [rows, setRows] = useState<Row[]>([]);
  const [label, setLabel] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'invalid'>('loading');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/public/inventory/${token}`);
        if (!alive) return;
        if (res.ok) {
          const j = await res.json();
          setRows(j.items ?? []);
          setLabel(j.label ?? null);
          setState('ok');
        } else setState('invalid');
      } catch {
        if (alive) setState('invalid');
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const categories = useMemo(() => Array.from(new Set(rows.map((r) => r.category_cn).filter(Boolean))) as string[], [rows]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter(
      (r) => (!cat || r.category_cn === cat) && (!s || r.name_cn.toLowerCase().includes(s) || (r.stock_id ?? '').toLowerCase().includes(s))
    );
  }, [rows, q, cat]);

  if (state === 'loading') return <p className="text-sm text-ink-muted text-center py-10">{t('share.loading')}</p>;
  if (state === 'invalid') {
    return (
      <div className="bg-surface border border-border rounded-2xl p-8 text-center">
        <p className="text-3xl mb-2">🪷</p>
        <p className="text-base font-semibold text-ink">{t('share.invalidTitle')}</p>
        <p className="mt-1 text-sm text-ink-muted">{t('share.invalidBody')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold font-serif text-ink">{t('share.title')}</h1>
        {label && <p className="text-xs text-ink-faint">{label}</p>}
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder={t('share.searchPlaceholder')}
        className="w-full text-sm px-3 py-2.5 border border-border-strong rounded-xl bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent" />

      <div className="flex flex-wrap gap-1.5">
        <Chip label={t('share.all')} active={cat === ''} onClick={() => setCat('')} />
        {categories.map((c) => <Chip key={c} label={c} active={cat === c} onClick={() => setCat(c)} />)}
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-muted">{t('share.noMatch')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{r.name_cn}</div>
                  <div className="text-[11px] text-ink-faint">
                    {r.stock_id ? <span className="font-mono">{r.stock_id}</span> : t('share.unnumbered')}
                    {r.category_cn && <span> · {r.category_cn}</span>}
                  </div>
                </div>
                <span className="text-sm font-semibold tabular-nums text-ink whitespace-nowrap">{r.qty.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-ink-faint text-center">{t('share.footer', { n: filtered.length })}</p>
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
