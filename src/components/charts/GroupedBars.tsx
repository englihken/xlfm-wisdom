// src/components/charts/GroupedBars.tsx
// Two-series grouped columns (近六个月收支): 4px rounded data-ends, 2px surface
// gaps, recessive 1px gridlines with 3 ticks, legend chips, direct label on the
// last primary column, hover tooltip, 表格 toggle.

'use client';

import { ChartShell, useTip } from './bits';
import { GRID, INK, INK_MUTED } from './palette';

export type GroupedBarsGroup = { label: string; values: [number, number] };

const W = 560;
const H = 190;
const L = 46;
const T = 14;
const B = 20;

function fmtShort(v: number): string {
  if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
  return String(Math.round(v));
}

export function GroupedBars({
  groups,
  series,
}: {
  groups: GroupedBarsGroup[];
  series: [{ label: string; color: string }, { label: string; color: string }];
}) {
  const { show, hide, layer } = useTip();
  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  const plotW = W - L - 20;
  const slot = plotW / Math.max(1, groups.length);
  const barW = Math.min(26, slot / 2 - 6);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [max, max / 2, 0];

  return (
    <ChartShell
      legend={[
        { label: series[0].label, color: series[0].color },
        { label: series[1].label, color: series[1].color },
      ]}
      table={{
        headers: ['', series[0].label, series[1].label],
        rows: groups.map((g) => [g.label, Math.round(g.values[0]), Math.round(g.values[1])]),
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
        <g stroke={GRID} strokeWidth="1">
          {ticks.map((v, i) => (
            <line key={i} x1={L} y1={y(v)} x2={W - 20} y2={y(v)} />
          ))}
        </g>
        <g fill={INK_MUTED} fontSize="11" textAnchor="end">
          {ticks.map((v, i) => (
            <text key={i} x={L - 6} y={y(v) + 4}>
              {fmtShort(v)}
            </text>
          ))}
        </g>
        {groups.map((g, i) => {
          const cx = L + slot * i + slot / 2;
          return (
            <g key={g.label}>
              {([0, 1] as const).map((si) => {
                const v = g.values[si];
                const bx = si === 0 ? cx - barW - 1 : cx + 1; // 2px surface gap between fills
                const by = y(v);
                return (
                  <rect
                    key={si}
                    x={bx}
                    y={by}
                    width={barW}
                    height={Math.max(H - B - by, v > 0 ? 2 : 0)}
                    rx="4"
                    fill={series[si].color}
                    onMouseEnter={(e) => show(e, `${g.label} · ${series[si].label} ${Math.round(v).toLocaleString()}`)}
                    onMouseMove={(e) => show(e, `${g.label} · ${series[si].label} ${Math.round(v).toLocaleString()}`)}
                    onMouseLeave={hide}
                  />
                );
              })}
              <text x={cx} y={H - 4} fontSize="11" fill={INK_MUTED} textAnchor="middle">
                {g.label}
              </text>
              {i === groups.length - 1 && g.values[0] > 0 && (
                <text x={cx - barW / 2 - 1} y={y(g.values[0]) - 6} fontSize="12" fontWeight="700" fill={INK} textAnchor="middle">
                  {fmtShort(g.values[0])}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {layer}
    </ChartShell>
  );
}
