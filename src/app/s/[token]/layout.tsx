// src/app/s/[token]/layout.tsx
// Standalone PUBLIC layout for the read-only 结缘品库存 share page. Like /r/[token]: NO ErpGate,
// NO nav, NO auth — anonymous, mobile-first, warm palette, centered column. The root layout
// supplies <html>/<body> + fonts. SSR-localized with a top-right language pill.

import type { ReactNode } from 'react';
import { getServerT } from '@/lib/i18n-server';
import { LocalePill } from '@/components/locale-pill';

export const metadata = {
  title: '结缘品库存 · 心灵法门马来西亚',
};

export default async function ShareLayout({ children }: { children: ReactNode }) {
  const t = await getServerT();
  return (
    <div className="min-h-screen bg-bg text-ink flex flex-col items-center px-4 py-6">
      <div className="fixed top-3 right-3 z-50"><LocalePill /></div>
      <header className="w-full max-w-[560px] flex items-center gap-2 mb-4">
        <span className="text-2xl leading-none" aria-hidden>🪷</span>
        <div className="leading-tight">
          <div className="font-semibold tracking-wide text-ink">{t('public.org')}</div>
          <div className="text-[11px] text-ink-muted">{t('publicLayout.s.title')}</div>
        </div>
      </header>
      <main className="w-full max-w-[560px] flex-1">{children}</main>
      <footer className="w-full max-w-[560px] mt-8 pt-4 border-t border-border text-[11px] leading-relaxed text-ink-muted">
        {t('publicLayout.s.footer')}
      </footer>
    </div>
  );
}
