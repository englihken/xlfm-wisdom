// src/app/dashboard/events/new/page.tsx
// 新建活动 — the shared EventForm in create mode. events:edit required.

'use client';

import { ErpGate } from '@/components/erp-gate';
import { EventForm } from '@/components/event-form';
import { grantAllows } from '@/lib/access';
import { useT } from '@/lib/i18n-react';

export default function NewEventPage() {
  const t = useT();
  return (
    <ErpGate active="events" module="events" titleSuffix={t('events.suffix.new')}>
      {(me) =>
        grantAllows(me.grants, 'events', 'edit') ? (
          <EventForm mode="create" />
        ) : (
          <p className="max-w-3xl mx-auto px-4 py-10 text-sm text-ink-muted">{t('events.noCreatePerm')}</p>
        )
      }
    </ErpGate>
  );
}
