// src/components/qr-svg.tsx
// Crisp inline-SVG QR of `text`, rendered with the dep-free generator in src/lib/qr.ts (the
// same one the 公开报名 card uses). 4-module quiet zone. Shared by the 大件标签 print view.

'use client';

import { useMemo } from 'react';
import { qrModules } from '@/lib/qr';

export function QrSvg({ text, px = 120, className }: { text: string; px?: number; className?: string }) {
  const mods = useMemo(() => {
    try {
      return qrModules(text, 'M');
    } catch {
      return null;
    }
  }, [text]);
  if (!mods) return null;
  const n = mods.length;
  const quiet = 4;
  const dim = n + quiet * 2;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (mods[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  return (
    <svg width={px} height={px} viewBox={`0 0 ${dim} ${dim}`} shapeRendering="crispEdges" role="img" aria-label="QR" className={className}>
      <rect width={dim} height={dim} fill="#FFFFFF" />
      <path d={d} fill="#2B2314" />
    </svg>
  );
}
