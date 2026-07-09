// src/app/f/layout.tsx
// Standalone PUBLIC layout for 会员月费自查 (D5). Like /r and /s: NO ErpGate, NO nav, NO auth —
// anonymous, mobile-first, warm palette, centered column. The root layout supplies <html>/<body>.

import type { ReactNode } from 'react';

export const metadata = {
  title: '月费查询 · 心灵法门马来西亚',
};

export default function FeeLookupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-ink flex flex-col items-center px-4 py-6">
      <header className="w-full max-w-[420px] text-center mb-3">
        <div className="text-[11px] tracking-wide text-[#8A7444]">心灵法门马来西亚</div>
        <div className="font-serif text-lg font-bold text-ink">月费查询</div>
      </header>
      <main className="w-full max-w-[420px] flex-1">{children}</main>
      <footer className="w-full max-w-[420px] mt-8 pt-4 border-t border-border text-[11px] leading-relaxed text-ink-muted text-center">
        缴费自愿 · 功德无量 🙏
      </footer>
    </div>
  );
}
