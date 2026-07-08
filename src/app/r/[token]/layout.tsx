// src/app/r/[token]/layout.tsx
// Standalone PUBLIC layout for the login-free registration flow. Deliberately NOT inside
// the /dashboard shell: NO ErpGate, NO DashboardNav, NO auth/session read — these pages
// are anonymous. Mobile-first, warm palette, centered ~460px column. The root layout
// (src/app/layout.tsx) still supplies <html>/<body> + the serif font.

import type { ReactNode } from 'react';

export const metadata = {
  title: '活动报名 · 心灵法门马来西亚',
};

export default function PublicRegLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-ink flex flex-col items-center px-4 py-6">
      <header className="w-full max-w-[460px] flex items-center gap-2 mb-4">
        <span className="text-2xl leading-none" aria-hidden>🪷</span>
        <div className="leading-tight">
          <div className="font-semibold tracking-wide text-ink">心灵法门马来西亚</div>
          <div className="text-[11px] text-ink-muted">Xin Ling Fa Men Malaysia · 活动报名</div>
        </div>
      </header>

      <main className="w-full max-w-[460px] flex-1">{children}</main>

      <footer className="w-full max-w-[460px] mt-8 pt-4 border-t border-border text-[11px] leading-relaxed text-ink-muted">
        {/* PLACEHOLDER — 理事会 / PDPA final wording pending before real launch. */}
        提交即表示您同意本会为活动联络与安排保存您提供的资料。
        <span className="opacity-60"> （PLACEHOLDER · 待理事会确认）</span>
      </footer>
    </div>
  );
}
