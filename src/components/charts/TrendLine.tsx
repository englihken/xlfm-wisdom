// src/components/charts/TrendLine.tsx
// ≤2-series trend line (brief §1 mark specs): 2px lines, ≥8px endpoint marker,
// end-value direct label in ink, 1px recessive gridlines with 3–4 ticks, legend
// chips when 2 series, hover tooltip per point, 表格 toggle.

'use client';

import { ChartShell, useTip } from './bits';
import { GRID, INK, INK_MUTED } from './palette';
import { useT } from '@/lib/i18n-react';

export type TrendSeries = { label: string; color: string; points: number[] };

const W = 560;
const H = 190;
const L = 46; // left gutter for y labels
const R = 40; // right gutter for end-value labels
const T = 14;
const B = 20;

export function TrendLine({ series, labels }: { series: TrendSeries[]; labels: string[] }) {
  const t = useT();
  const { show, hide, layer } = useTip();
  const n = labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.points));
  const x = (i: number) => (n <= 1 ? L : L + ((W - L - R) * i) / (n - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [max, Math.round(max / 2), 0];

  return (
    <ChartShell
      legend={series.map((s) => ({ label: s.label, color: s.color }))}
      table={{
        headers: ['', ...series.map((s) => s.label)],
        rows: labels.map((l, i) => [l, ...series.map((s) => s.points[i] ?? 0)]),
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
        <g stroke={GRID} strokeWidth="1">
          {ticks.map((v) => (
            <line key={v} x1={L} y1={y(v)} x2={W - R + 34} y2={y(v)} />
          ))}
        </g>
        <g fill={INK_MUTED} fontSize="11" textAnchor="end">
          {ticks.map((v) => (
            <text key={v} x={L - 6} y={y(v) + 4}>
              {v}
            </text>
          ))}
        </g>
        <g fill={INK_MUTED} fontSize="11" textAnchor="middle">
          {labels.map((l, i) => (
            <text key={i} x={x(i)} y={H - 4}>
              {l}
            </text>
          ))}
        </g>
        {series.map((s) => (
          <g key={s.label}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              points={s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
            />
            {/* hover targets on every point; visible marker on the endpoint (≥8px) */}
            {s.points.map((v, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(v)}
                r={i === s.points.length - 1 ? 4.5 : 8}
                fill={i === s.points.length - 1 ? s.color : 'transparent'}
                onMouseEnter={(e) => show(e, `${labels[i]} · ${s.label} ${v}`)}
                onMouseMove={(e) => show(e, `${labels[i]} · ${s.label} ${v}`)}
                onMouseLeave={hide}
              />
            ))}
            <text
              x={x(s.points.length - 1) + 10}
              y={y(s.points[s.points.length - 1]) + 4}
              fontSize="12"
              fontWeight="700"
              fill={INK}
            >
              {s.points[s.points.length - 1]}
            </text>
          </g>
        ))}
      </svg>
      {layer}
      {series.every((s) => s.points.every((p) => p === 0)) && (
        <p className="text-sm text-ink-faint text-center -mt-6 mb-3">{t('charts.noData')}</p>
      )}
    </ChartShell>
  );
}
