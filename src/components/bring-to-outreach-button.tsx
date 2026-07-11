// src/components/bring-to-outreach-button.tsx
// 带入渡人名单 — an additive per-registration button on the events queue. Bridges an attendee into
// the 渡人 workbench: POST a 善缘 with display_name=applicant_name, phone=applicant_phone,
// source_type='event', source_event_id=this event. A same-name+same-event person already on the
// list → 已在名单中 with a link to their 渡人卡. Render only for outreach:edit holders.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n-react';

export function BringToOutreachButton({ eventId, name, phone }: { eventId: string; name: string; phone: string | null }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'exists'>('idle');
  const [existingId, setExistingId] = useState<string | null>(null);

  const bring = async () => {
    setState('busy');
    try {
      const res = await fetch('/api/dashboard/outreach/persons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name, phone: phone || undefined, source_type: 'event', source_event_id: eventId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) { setExistingId(j.existing?.id ?? null); setState('exists'); }
      else if (res.ok) setState('done');
      else setState('idle');
    } catch {
      setState('idle');
    }
  };

  if (state === 'done') return <span className="text-[11px] text-[#3F6B2E]">{t('duren.addedToList')}</span>;
  if (state === 'exists')
    return (
      <span className="text-[11px] text-ink-faint">
        {t('duren.alreadyOnList')}{existingId && <> · <Link href={`/dashboard/outreach?contact=${existingId}`} className="text-accent-deep hover:underline">{t('duren.view')}</Link></>}
      </span>
    );
  return (
    <button disabled={state === 'busy'} onClick={bring} className="px-3 py-1 text-xs btn-secondary disabled:opacity-40" title={t('duren.bringTitle')}>
      {state === 'busy' ? '…' : t('duren.bring')}
    </button>
  );
}
