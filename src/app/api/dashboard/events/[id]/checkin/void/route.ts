// src/app/api/dashboard/events/[id]/checkin/void/route.ts
// POST { attendance_id } (events:edit + hosting-centre wall) — undo a check-in.
// NEVER deletes: sets voided_at/voided_by, which both drops the row out of the
// counters AND releases the partial unique index, so the person can be checked in
// again cleanly if the void was itself a mistake. Audited as reg.check_in_void.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { eventsScope } from '@/lib/members-scope';
import { UUID_RE } from '@/lib/finance-cashbook';
import { mayRunCheckin } from '@/lib/event-checkin';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireModuleAccess('events', 'edit');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const attId = typeof body?.attendance_id === 'string' ? body.attendance_id.trim() : '';
  if (!attId || !UUID_RE.test(attId)) return NextResponse.json({ error: '签到记录无效' }, { status: 400 });

  const { data: ev, error: evErr } = await supabaseAdmin
    .from('events')
    .select('id, organizing_centre_id, co_centre_ids')
    .eq('id', id)
    .maybeSingle();
  if (evErr) {
    console.error('[checkin/void] event fetch failed:', evErr);
    return NextResponse.json({ error: 'Failed to undo check-in' }, { status: 500 });
  }
  if (!ev || !mayRunCheckin(eventsScope(access.volunteer), ev)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Scope is proven against the EVENT in the path, so the row must belong to it —
  // otherwise an id from another event would ride this event's wall.
  const { data: att } = await supabaseAdmin
    .from('event_attendance')
    .select('id, event_id, registration_id, voided_at')
    .eq('id', attId)
    .maybeSingle();
  if (!att || att.event_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (att.voided_at) return NextResponse.json({ error: '该签到已取消' }, { status: 400 });

  const me = access.volunteer;
  const { data: updated, error } = await supabaseAdmin
    .from('event_attendance')
    .update({ voided_at: new Date().toISOString(), voided_by: me.id })
    .eq('id', attId)
    .select('id, voided_at')
    .single();
  if (error || !updated) {
    console.error('[checkin/void] update failed:', error);
    return NextResponse.json({ error: '取消失败，请重试' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'events',
    action: 'reg.check_in_void',
    tableName: 'event_attendance',
    recordId: attId,
    before: { voided: false },
    after: { voided: true, event_id: id, registration_id: att.registration_id },
  });

  return NextResponse.json({ attendance: updated });
}
