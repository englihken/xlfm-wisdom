// src/app/api/dashboard/events/[id]/status/route.ts
// POST { status } — move an event through its status machine (events:edit).
// Allowed: draft→open · open→full/closed/completed · full→open/completed ·
// closed→completed. Anything else → 400 with the allowed list. Audited.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { EVENT_STATUSES, STATUS_TRANSITIONS } from '@/lib/events';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireModuleAccess('events', 'edit');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { status?: unknown } | null;
  const nextStatus = typeof body?.status === 'string' ? body.status : '';
  if (!(EVENT_STATUSES as readonly string[]).includes(nextStatus)) {
    return NextResponse.json({ error: '状态无效' }, { status: 400 });
  }

  const { data: current, error: curErr } = await supabaseAdmin
    .from('events')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (curErr) {
    console.error('[events] status pre-fetch failed:', curErr);
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });
  }
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const allowed = STATUS_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    return NextResponse.json(
      { error: `不允许从「${current.status}」变更为「${nextStatus}」`, allowed },
      { status: 400 }
    );
  }

  const me = access.volunteer;
  const { data: updated, error } = await supabaseAdmin
    .from('events')
    .update({ status: nextStatus, updated_at: new Date().toISOString(), updated_by: me.id })
    .eq('id', id)
    .select('id, status')
    .single();
  if (error || !updated) {
    console.error('[events] status update failed:', error);
    return NextResponse.json({ error: '操作失败，请重试' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'events',
    action: 'update',
    tableName: 'events',
    recordId: id,
    before: { status: current.status },
    after: { status: updated.status },
  });

  return NextResponse.json({ event: updated });
}
