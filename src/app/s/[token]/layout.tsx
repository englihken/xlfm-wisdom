// src/app/s/[token]/layout.tsx
// Standalone PUBLIC layout for the read-only 结缘品库存 share page. Like /r/[token]: NO ErpGate,
// NO nav, NO auth — anonymous, mobile-first, warm palette, centered column. The root layout
// supplies <html>/<body> + fonts.

import type { ReactNode } from 'react';

export const metadata = {
  title: '结缘品库存 · 心灵法门马来西亚',
};

export default function ShareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-ink flex flex-col items-center px-4 py-6">
      <header className="w-full max-w-[560px] flex items-center gap-2 mb-4">
        <span className="text-2xl leading-none" aria-hidden>🪷</span>
        <div className="leading-tight">
          <div className="font-semibold tracking-wide text-ink">心灵法门马来西亚</div>
          <div className="text-[11px] text-ink-muted">结缘品库存（总会仓库）· 只读</div>
        </div>
      </header>
      <main className="w-full max-w-[560px] flex-1">{children}</main>
      <footer className="w-full max-w-[560px] mt-8 pt-4 border-t border-border text-[11px] leading-relaxed text-ink-muted">
        本页为实时库存目录，仅供查阅；如需结缘请联系总会。
      </footer>
    </div>
  );
}
