// src/components/charts/StatTile.tsx
// Hero-number stat tile with an optional delta chip (brief §1): ▲ emerald for
// up, — muted for flat/down. Deltas appear ONLY on aggregate tiles — per-centre
// visuals stay 随喜 tone and never carry one. Rose value color is allowed only
// for status tiles (crisis) and must come with an icon in the label.

'use client';

import { EMERALD, INK_MUTED } from './palette';

export function StatTile({
  value,
  label,
  sub,
  delta,
  valueColor,
}: {
  value: string | number;
  label: string;
  sub?: string;
  // dir 'up' renders ▲ emerald; anything else renders — muted (no rose deltas).
  delta?: { dir: 'up' | 'flat' | 'down'; text: string };
  valueColor?: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl px-[18px] py-[14px]">
      <div
        className="text-[27px] leading-tight font-extrabold tabular-nums text-ink present-hero"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
        {delta && (
          <span
            className="text-[11px] font-bold align-[6px] ml-1.5"
            style={{ color: delta.dir === 'up' ? EMERALD : INK_MUTED }}
          >
            {delta.dir === 'up' ? '▲ ' : '— '}
            {delta.text}
          </span>
        )}
      </div>
      <div className="text-[12.5px] text-ink-muted mt-0.5 present-k">{label}</div>
      {sub && <div className="text-[11px] text-ink-faint mt-0.5">{sub}</div>}
    </div>
  );
}
