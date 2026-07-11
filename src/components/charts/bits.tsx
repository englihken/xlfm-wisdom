// src/components/charts/bits.tsx
// Shared plumbing for the E3 hand-rolled SVG charts (brief §1): the legend-chip
// row, the 表格 accessibility toggle (every chart can swap to a plain table of
// the same data), and the absolutely-positioned HTML hover tooltip layer.

'use client';

import { useState, type ReactNode, type MouseEvent } from 'react';
import { useT } from '@/lib/i18n-react';

export type LegendItem = { label: string; color: string };
export type TableSpec = { headers: string[]; rows: (string | number)[][] };

// Hover tooltip state + layer. Charts call show(e, text) from their marks'
// onMouseEnter/Move and hide() on leave; the tip positions inside the chart's
// relative container.
export function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const show = (e: MouseEvent, text: string) => {
    const host = (e.currentTarget as Element).closest('[data-chart-host]');
    if (!host) return;
    const r = host.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text });
  };
  const hide = () => setTip(null);
  const layer = tip ? (
    <div
      className="pointer-events-none absolute z-10 px-2.5 py-1 rounded-lg bg-[#33302A] text-white text-[11.5px] whitespace-nowrap shadow-md"
      style={{ left: tip.x + 10, top: tip.y - 30 }}
    >
      {tip.text}
    </div>
  ) : null;
  return { show, hide, layer };
}

// Wraps a chart with: legend chips (only when ≥2 series — single series is named
// by the card title, per spec), the 表格 toggle, and the table view itself.
export function ChartShell({
  legend,
  table,
  children,
}: {
  legend?: LegendItem[];
  table: TableSpec;
  children: ReactNode;
}) {
  const t = useT();
  const [showTable, setShowTable] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-1 min-h-[20px]">
        {legend && legend.length >= 2 && !showTable && (
          <span className="text-[11.5px] text-[#948A76] mr-auto">
            {legend.map((l) => (
              <span key={l.label} className="mr-2.5">
                <i
                  className="inline-block w-2.5 h-2.5 rounded-[3px] mr-1 align-[-1px]"
                  style={{ background: l.color }}
                />
                {l.label}
              </span>
            ))}
          </span>
        )}
        <button
          onClick={() => setShowTable((v) => !v)}
          className="text-[11px] text-ink-faint hover:text-accent-deep border border-border rounded-full px-2 py-0.5 transition"
          aria-pressed={showTable}
        >
          {showTable ? t('charts.showChart') : t('charts.showTable')}
        </button>
      </div>
      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                {table.headers.map((h) => (
                  <th key={h} className="px-2 py-1.5 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-b-0">
                  {r.map((c, j) => (
                    <td key={j} className={`px-2 py-1.5 ${j === 0 ? 'text-ink' : 'text-ink-muted'}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative" data-chart-host>
          {children}
        </div>
      )}
    </div>
  );
}
