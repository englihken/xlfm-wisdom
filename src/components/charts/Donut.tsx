// src/components/charts/Donut.tsx
// Donut with a center hero number (brief §1). Callers pass ≤4 named segments +
// an optional 其他 fold (neutral) — the fold itself is done by the data layer.
// Legend list beside the ring; hover tooltip per arc; 表格 toggle.

'use client';

import { ChartShell, useTip } from './bits';
import { INK, INK_MUTED } from './palette';

export type DonutSegment = { label: string; value: number; color: string };

const R = 48;
const CIRC = 2 * Math.PI * R; // ≈ 301.6

export function Donut({
  segments,
  centerValue,
  centerLabel,
  valueHeader,
}: {
  segments: DonutSegment[];
  centerValue: string | number;
  centerLabel: string;
  valueHeader: string;
}) {
  const { show, hide, layer } = useTip();
  const total = Math.max(
    1,
    segments.reduce((s, x) => s + x.value, 0)
  );
  let offset = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const len = (s.value / total) * CIRC;
      const a = { ...s, len, offset };
      offset += len + (len > 0 ? 2 : 0); // 2px surface gap between adjacent fills
      return a;
    });

  return (
    <ChartShell
      table={{
        headers: [centerLabel, valueHeader],
        rows: segments.map((s) => [s.label, s.value]),
      }}
    >
      <div className="flex items-center gap-[18px] flex-wrap">
        <svg viewBox="0 0 140 140" width="132" role="img">
          <g transform="rotate(-90 70 70)" fill="none" strokeWidth="22" strokeLinecap="butt">
            {arcs.map((a) => (
              <circle
                key={a.label}
                cx="70"
                cy="70"
                r={R}
                stroke={a.color}
                strokeDasharray={`${Math.max(a.len - 2, 0.5)} ${CIRC}`}
                strokeDashoffset={-a.offset}
                onMouseEnter={(e) => show(e, `${a.label} ${a.value}`)}
                onMouseMove={(e) => show(e, `${a.label} ${a.value}`)}
                onMouseLeave={hide}
              />
            ))}
          </g>
          <text x="70" y="66" textAnchor="middle" fontSize="24" fontWeight="800" fill={INK}>
            {centerValue}
          </text>
          <text x="70" y="84" textAnchor="middle" fontSize="10.5" fill={INK_MUTED}>
            {centerLabel}
          </text>
        </svg>
        <div className="text-[12.5px] leading-8">
          {segments.map((s) => (
            <div key={s.label}>
              <i
                className="inline-block w-2.5 h-2.5 rounded-[3px] mr-1.5 align-[-1px]"
                style={{ background: s.color }}
              />
              <span className="text-ink">{s.label}</span>
              <b className="ml-1.5 tabular-nums text-ink">{s.value}</b>
            </div>
          ))}
        </div>
      </div>
      {layer}
    </ChartShell>
  );
}
