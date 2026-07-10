import type { ReactNode } from 'react';

export const metadata = { title: '共修会来信 · 心灵法门马来西亚' };

export default function MailFormLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-ink flex flex-col items-center px-4 py-6">
      <header className="w-full max-w-[460px] text-center mb-3">
        <div className="text-[11px] tracking-wide text-[#8A7444]">心灵法门马来西亚</div>
        <div className="font-serif text-lg font-bold text-ink">共修会来信</div>
      </header>
      <main className="w-full max-w-[460px] flex-1">{children}</main>
      <footer className="w-full max-w-[460px] mt-8 pt-4 border-t border-border text-[11px] leading-relaxed text-ink-muted text-center">
        感恩您的来信 · 我们会用心回复 🙏
      </footer>
    </div>
  );
}
