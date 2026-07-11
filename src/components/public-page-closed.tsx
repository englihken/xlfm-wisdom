// src/components/public-page-closed.tsx
// The gentle 暂停 card a PUBLIC page (/f · /m) renders when its org_settings
// switch is off (brief §3.5) — a calm message, never an error page. The pages
// fail OPEN when the key is missing; only an explicit false lands here.

import { t } from '@/lib/i18n';

export function PublicPageClosed() {
  return (
    <div className="bg-surface border border-border rounded-2xl p-8 text-center">
      <p className="text-4xl mb-3">🪷</p>
      <p className="font-serif font-semibold text-ink text-lg">{t('public.closed')}</p>
      <p className="mt-2 text-sm text-ink-muted">{t('public.closedSub')}</p>
    </div>
  );
}
