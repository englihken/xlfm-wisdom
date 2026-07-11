// src/components/charts/FunnelBars.tsx
// The 善缘 funnel (brief §1): emerald sequential ramp, conversion-% rows between
// bars, ink text on the two lightest steps. Widths scale to the first step.

'use client';

import { ChartShell, useTip } from './bits';
import { INK, RAMP } from './palette';

export type FunnelStep = { label: string; value: number };

export function FunnelBars({
  steps,
  valueHeader,
  labelHeader,
}: {
  steps: FunnelStep[];
  valueHeader: string;
  labelHeader: string;
}) {
  const { show, hide, layer } = useTip();
  const base = Math.max(1, steps[0]?.value ?? 1);

  return (
    <ChartShell
      table={{ headers: [labelHeader, valueHeader], rows: steps.map((s) => [s.label, s.value]) }}
    >
      <div>
        {steps.map((s, i) => {
          const pct = Math.min(100, (s.value / base) * 100);
          const conv = i > 0 && steps[i - 1].value > 0 ? Math.round((s.value / steps[i - 1].value) * 100) : null;
          return (
            <div key={s.label}>
              {i > 0 && (
                <div className="text-[10.5px] text-ink-faint pl-[118px] leading-tight">
                  → {conv === null ? '—' : `${conv}%`}
                </div>
              )}
              <div className="flex items-center gap-2.5 my-[3px]">
                <span className="w-[104px] shrink-0 text-right text-[12.5px] text-[#5D5443]">{s.label}</span>
                <div
                  className="h-[26px] rounded-[4px] text-[12px] font-bold flex items-center pl-2 min-w-[26px] border-2 border-white present-funnel-bar"
                  style={{
                    width: `${Math.max(pct, s.value > 0 ? 5 : 3)}%`,
                    background: RAMP[Math.min(i, RAMP.length - 1)],
                    color: i < 2 ? INK : '#FFFFFF',
                  }}
                  onMouseEnter={(e) => show(e, `${s.label}：${s.value}`)}
                  onMouseMove={(e) => show(e, `${s.label}：${s.value}`)}
                  onMouseLeave={hide}
                >
                  {s.value}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {layer}
    </ChartShell>
  );
}
