// src/app/dashboard/events/[id]/edit/page.tsx
// 编辑活动 — loads the event (+ fees + team needs), maps into EventForm values, and
// renders the shared form in edit mode (PATCH). events:edit required.

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { EventForm, EMPTY_EVENT, type EventFormValues } from '@/components/event-form';
import { grantAllows } from '@/lib/access';
import { FEE_ROWS } from '@/lib/events-display';

type MealSlot = { slot_date: string; meal: string; offered: boolean };

function toForm(
  event: Record<string, unknown>,
  fees: { item: string; amount: number; billing?: string }[],
  teamNeeds: { team_id: string; needed: number }[],
  mealSlots: MealSlot[],
): EventFormValues {
  const feeState = Object.fromEntries(FEE_ROWS.map((r) => [r.item, { enabled: false, amount: '', billing: r.billing }])) as EventFormValues['fees'];
  for (const f of fees) {
    if (feeState[f.item]) feeState[f.item] = { enabled: true, amount: String(f.amount), billing: f.billing || feeState[f.item].billing };
  }
  const mealClosed = mealSlots.filter((s) => !s.offered).map((s) => `${s.slot_date}:${s.meal}`);
  return {
    ...EMPTY_EVENT,
    title: String(event.title ?? ''),
    event_type: String(event.event_type ?? 'fahui'),
    organizing_centre_id: String(event.organizing_centre_id ?? ''),
    starts_on: String(event.starts_on ?? ''),
    ends_on: event.ends_on ? String(event.ends_on) : '',
    location: event.location ? String(event.location) : '',
    capacity: event.capacity != null ? String(event.capacity) : '',
    reg_deadline: event.reg_deadline ? String(event.reg_deadline) : '',
    requires_approval: event.requires_approval === false ? 'no' : 'yes',
    reg_edit_cutoff_days: String(event.reg_edit_cutoff_days ?? 3),
    description: event.description ? String(event.description) : '',
    fees: feeState,
    needs: teamNeeds.map((n) => ({ team_id: n.team_id, needed: String(n.needed) })),
    mealClosed,
  };
}

export default function EditEventPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ErpGate active="events" module="events" titleSuffix="编辑">
      {(me) => <EditBody me={me} id={id} />}
    </ErpGate>
  );
}

function EditBody({ me, id }: { me: ErpMe; id: string }) {
  const canEdit = grantAllows(me.grants, 'events', 'edit');
  const [initial, setInitial] = useState<EventFormValues | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`/api/dashboard/events/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) setInitial(toForm(j.event, j.fees ?? [], j.teamNeeds ?? [], j.mealSlots ?? []));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (!canEdit) return <p className="max-w-3xl mx-auto px-4 py-10 text-sm text-[#8B6F47]">您没有编辑活动的权限。</p>;
  if (loading) return <p className="max-w-3xl mx-auto px-4 py-10 text-sm text-[#8B6F47]">加载中…</p>;
  if (!initial) return <p className="max-w-3xl mx-auto px-4 py-10 text-sm text-[#8B6F47]">无法加载该活动。</p>;

  return <EventForm mode="edit" eventId={id} initial={initial} />;
}
