// src/components/public-page-closed.tsx
// The gentle 暂停 card a PUBLIC page (/f · /m) renders when its org_settings
// switch is off (brief §3.5) — a calm message, never an error page. The pages
// fail OPEN when the key is missing; only an explicit false lands here.

'use client';

import { useT } from '@/lib/i18n-react';

export function PublicPageClosed() {
  const t = useT();
  return (
    <div className="bg-surface border border-border rounded-2xl p-8 text-center">
      <p className="text-4xl mb-3">🪷</p>
      <p className="font-serif font-semibold text-ink text-lg">{t('publicClosed.closed')}</p>
      <p className="mt-2 text-sm text-ink-muted">{t('publicClosed.closedSub')}</p>
    </div>
  );
}
