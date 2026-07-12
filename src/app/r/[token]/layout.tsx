// src/app/r/[token]/layout.tsx
// Standalone PUBLIC layout for the login-free registration flow. Deliberately NOT inside
// the /dashboard shell: NO ErpGate, NO DashboardNav, NO auth/session read — these pages
// are anonymous. Mobile-first, warm palette, centered ~460px column. The root layout
// (src/app/layout.tsx) still supplies <html>/<body> + the serif font. SSR-localized with
// a top-right language pill.

import type { ReactNode } from 'react';
import { getServerT } from '@/lib/i18n-server';
import { LocalePill } from '@/components/locale-pill';

export async function generateMetadata() {
  const t = await getServerT();
  return { title: t('reg.pageTitle') };
}

export default async function PublicRegLayout({ children }: { children: ReactNode }) {
  const t = await getServerT();
  return (
    <div className="min-h-screen bg-bg text-ink flex flex-col items-center px-4 py-6">
      <div className="fixed top-3 right-3 z-50"><LocalePill /></div>
      <header className="w-full max-w-[460px] flex items-center gap-2 mb-4">
        <span className="text-2xl leading-none" aria-hidden>🪷</span>
        <div className="leading-tight">
          <div className="font-semibold tracking-wide text-ink">{t('public.org')}</div>
          <div className="text-[11px] text-ink-muted">Xin Ling Fa Men Malaysia · {t('publicLayout.r.title')}</div>
        </div>
      </header>

      <main className="w-full max-w-[460px] flex-1">{children}</main>

      <footer className="w-full max-w-[460px] mt-8 pt-4 border-t border-border text-[11px] leading-relaxed text-ink-muted">
        {t('publicLayout.r.footer')}
        <span className="opacity-60"> {t('publicLayout.r.footerNote')}</span>
      </footer>
    </div>
  );
}
