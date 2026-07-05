// src/app/api/dashboard/registrations/[id]/decision/route.ts
// POST — decide a registration (events:edit):
//   { decision: 'approve' }                     — from pending
//   { decision: 'reject', reason: '…' }         — from pending; reason REQUIRED
//   { decision: 'cancel' }                      — from pending or approved
// Sets status (+ decided_by/at on approve/reject, rejected_reason on reject). On
// approve, if the event has a capacity and the approved count reaches it, the event
// is flipped open→full (a second audit row). No delete — cancel is a status.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireModuleAccess('events', 'edit');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { decision?: unknown; reason?: unknown } | null;
  const decision = typeof body?.decision === 'string' ? body.decision : '';
  if (!['approve', 'reject', 'cancel'].includes(decision)) {
    return NextResponse.json({ error: '决定无效（approve/reject/cancel）' }, { status: 400 });
  }

  const { data: reg, error: regErr } = await supabaseAdmin
    .from('registrations')
    .select('id, event_id, status')
    .eq('id', id)
    .maybeSingle();
  if (regErr) {
    console.error('[decision] registration fetch failed:', regErr);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
  if (!reg) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Transition guards.
  if ((decision === 'approve' || decision === 'reject') && reg.status !== 'pending') {
    return NextResponse.json({ error: '只有待处理（pending）的报名可以批准或拒绝' }, { status: 400 });
  }
  if (decision === 'cancel' && !['pending', 'approved'].includes(reg.status)) {
    return NextResponse.json({ error: '只有待处理或已批准的报名可以取消' }, { status: 400 });
  }

  const me = access.volunteer;
  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = { updated_at: nowIso, updated_by: me.id };
  let reason: string | null = null;

  if (decision === 'approve') {
    update.status = 'approved';
    update.decided_by = me.id;
    update.decided_at = nowIso;
  } else if (decision === 'reject') {
    reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) return NextResponse.json({ error: '请填写拒绝原因' }, { status: 400 });
    update.status = 'rejected';
    update.decided_by = me.id;
    update.decided_at = nowIso;
    update.rejected_reason = reason;
  } else {
    update.status = 'cancelled';
  }

  const { data: updated, error } = await supabaseAdmin
    .from('registrations')
    .update(update)
    .eq('id', id)
    .select('id, status')
    .single();
  if (error || !updated) {
    console.error('[decision] update failed:', error);
    return NextResponse.json({ error: '操作失败，请重试' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'events',
    action: 'update',
    tableName: 'registrations',
    recordId: id,
    before: { status: reg.status },
    after: reason ? { status: updated.status, rejected_reason: reason } : { status: updated.status },
  });

  // Capacity rule: on approve, if the event has capacity and it is now reached, flip
  // the event open→full (second audit).
  if (decision === 'approve') {
    const { data: event } = await supabaseAdmin
      .from('events')
      .select('id, status, capacity')
      .eq('id', reg.event_id)
      .maybeSingle();
    if (event && event.capacity && event.status === 'open') {
      const { count } = await supabaseAdmin
        .from('registrations')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', reg.event_id)
        .eq('status', 'approved');
      if ((count ?? 0) >= event.capacity) {
        const { error: evErr } = await supabaseAdmin
          .from('events')
          .update({ status: 'full', updated_at: nowIso, updated_by: me.id })
          .eq('id', reg.event_id);
        if (evErr) {
          console.error('[decision] event full flip failed:', evErr);
        } else {
          await writeAudit({
            actorId: me.id,
            actorEmail: me.email,
            module: 'events',
            action: 'update',
            tableName: 'events',
            recordId: reg.event_id,
            before: { status: 'open' },
            after: { status: 'full', note: 'capacity reached' },
          });
        }
      }
    }
  }

  return NextResponse.json({ registration: updated });
}
