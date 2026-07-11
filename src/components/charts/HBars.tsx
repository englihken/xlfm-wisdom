// src/components/charts/HBars.tsx
// Horizontal bars with direct labels inside the fill (brief §1). Optional
// `track` variant renders each bar over a full-width surface track for
// vs-capacity readings (报名 vs 名额, 当前 vs 警戒线). `warn` rows render rose —
// status color, so callers MUST pair it with an icon/label in the row text.

'use client';

import { ChartShell, useTip } from './bits';
import { ROSE, TRACK } from './palette';

export type HBarRow = {
  label: string;
  value: number;
  // Text inside the bar (defaults to value).
  display?: string;
  // Right-side small annotation (e.g. 「/ 200」 or 「新结缘 14」).
  sub?: string;
  // Rose status row (low stock etc.) — icon+label lives in `label`/`sub`.
  warn?: boolean;
};

export function HBars({
  rows,
  color,
  track = false,
  max,
  valueHeader,
  labelHeader,
}: {
  rows: HBarRow[];
  color: string;
  track?: boolean;
  // Denominator for width; defaults to the row max.
  max?: number;
  valueHeader: string;
  labelHeader: string;
}) {
  const { show, hide, layer } = useTip();
  const denom = Math.max(1, max ?? Math.max(...rows.map((r) => r.value), 1));

  return (
    <ChartShell
      table={{
        headers: [labelHeader, valueHeader],
        rows: rows.map((r) => [r.label, `${r.display ?? r.value}${r.sub ? ` ${r.sub}` : ''}`]),
      }}
    >
      <div>
        {rows.map((r) => {
          const pct = Math.min(100, (r.value / denom) * 100);
          const fill = (
            <div
              className="h-5 rounded-[4px] text-white text-[11.5px] font-bold flex items-center pl-1.5 min-w-[20px] border-2"
              style={{
                width: `${Math.max(pct, r.value > 0 ? 5 : 0)}%`,
                background: r.warn ? ROSE : color,
                borderColor: track ? TRACK : '#FFFFFF',
              }}
              onMouseEnter={(e) => show(e, `${r.label}：${r.display ?? r.value}${r.sub ? ` ${r.sub}` : ''}`)}
              onMouseMove={(e) => show(e, `${r.label}：${r.display ?? r.value}${r.sub ? ` ${r.sub}` : ''}`)}
              onMouseLeave={hide}
            >
              {r.display ?? r.value}
            </div>
          );
          return (
            <div key={r.label} className="flex items-center gap-2.5 my-[7px]">
              <span className="w-[104px] shrink-0 text-right text-[12.5px] text-[#5D5443] truncate" title={r.label}>
                {r.label}
              </span>
              {track ? <div className="flex-1 rounded-[4px]" style={{ background: TRACK }}>{fill}</div> : <div className="flex-1">{fill}</div>}
              {r.sub && <span className="text-[11px] text-ink-faint whitespace-nowrap">{r.sub}</span>}
            </div>
          );
        })}
      </div>
      {layer}
    </ChartShell>
  );
}
