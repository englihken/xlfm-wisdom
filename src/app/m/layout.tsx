import type { ReactNode } from 'react';
import { getServerT } from '@/lib/i18n-server';
import { LocalePill } from '@/components/locale-pill';

export const metadata = { title: '共修会来信 · 心灵法门马来西亚' };

export default async function MailFormLayout({ children }: { children: ReactNode }) {
  const t = await getServerT();
  return (
    <div className="min-h-screen bg-bg text-ink flex flex-col items-center px-4 py-6">
      <div className="fixed top-3 right-3 z-50"><LocalePill /></div>
      <header className="w-full max-w-[460px] text-center mb-3">
        <div className="text-[11px] tracking-wide text-[#8A7444]">{t('public.org')}</div>
        <div className="font-serif text-lg font-bold text-ink">{t('publicLayout.m.title')}</div>
      </header>
      <main className="w-full max-w-[460px] flex-1">{children}</main>
      <footer className="w-full max-w-[460px] mt-8 pt-4 border-t border-border text-[11px] leading-relaxed text-ink-muted text-center">
        {t('publicLayout.m.footer')}
      </footer>
    </div>
  );
}
