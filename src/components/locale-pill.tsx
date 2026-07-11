// src/components/locale-pill.tsx
// The public-page language switcher: a small 中文 | EN | ID pill (top-right on
// /m /f /s /r). Sets the NEXT_LOCALE cookie (1 year) via useChangeLocale and calls
// router.refresh() so the SSR-rendered page re-renders in the new language with no
// full reload. No persistence to any account (public visitors have no session).
// Language names always shown in their own language.

'use client';

import { useRouter } from 'next/navigation';
import { LOCALES, LOCALE_SHORT_NAME } from '@/lib/i18n';
import { useLocale, useChangeLocale } from '@/lib/i18n-react';

export function LocalePill() {
  const router = useRouter();
  const locale = useLocale();
  const change = useChangeLocale();
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface/85 backdrop-blur px-0.5 py-0.5 text-[11px] shadow-sm">
      {LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          aria-pressed={locale === loc}
          onClick={async () => {
            await change(loc);
            router.refresh();
          }}
          className={`px-2 py-0.5 rounded-full transition ${
            locale === loc ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {LOCALE_SHORT_NAME[loc]}
        </button>
      ))}
    </div>
  );
}
