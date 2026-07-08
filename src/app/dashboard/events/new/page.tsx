// src/app/dashboard/events/new/page.tsx
// 新建活动 — the shared EventForm in create mode. events:edit required.

'use client';

import { ErpGate } from '@/components/erp-gate';
import { EventForm } from '@/components/event-form';
import { grantAllows } from '@/lib/access';

export default function NewEventPage() {
  return (
    <ErpGate active="events" module="events" titleSuffix="新建">
      {(me) =>
        grantAllows(me.grants, 'events', 'edit') ? (
          <EventForm mode="create" />
        ) : (
          <p className="max-w-3xl mx-auto px-4 py-10 text-sm text-ink-muted">您没有创建活动的权限。</p>
        )
      }
    </ErpGate>
  );
}
