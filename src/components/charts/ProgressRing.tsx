// src/components/charts/ProgressRing.tsx
// Single-value progress ring (收缴率 etc.): emerald arc over a recessive track,
// center % in ink. Positive-tone metric → emerald per brief §1.

'use client';

import { EMERALD, GRID, INK } from './palette';

export function ProgressRing({ pct, size = 64 }: { pct: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = 34;
  const circ = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 84 84" width={size} role="img" aria-label={`${Math.round(clamped)}%`}>
      <circle cx="42" cy="42" r={r} fill="none" stroke={GRID} strokeWidth="9" />
      <circle
        cx="42"
        cy="42"
        r={r}
        fill="none"
        stroke={EMERALD}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${(clamped / 100) * circ} ${circ}`}
        transform="rotate(-90 42 42)"
      />
      <text x="42" y="47" textAnchor="middle" fontSize="17" fontWeight="800" fill={INK}>
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}
