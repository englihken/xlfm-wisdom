// src/app/api/dashboard/inventory/requests/[id]/status/route.ts
// PATCH — cancel a 分会 request (inventory:edit): body { status: 'cancelled' }. Only
// pending/partial requests can be cancelled (already-transferred stock stays where it
// is — a cancellation closes the REMAINDER, it does not undo past拨付). Audited.
// Mirrors the events [id]/status route shape.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { REQUEST_SELECT } from '@/lib/inventory';

export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('inventory', 'edit');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.status !== 'cancelled') {
    return NextResponse.json({ error: '仅支持取消（cancelled）' }, { status: 400 });
  }

  const { data: request, error: reqErr } = await supabaseAdmin
    .from('inventory_requests')
    .select('id, status, qty_requested, qty_fulfilled')
    .eq('id', id)
    .maybeSingle();
  if (reqErr) {
    console.error('[inventory/requests/status] load failed:', reqErr);
    return NextResponse.json({ error: 'Failed to load request' }, { status: 500 });
  }
  if (!request) return NextResponse.json({ error: '申请不存在' }, { status: 404 });
  if (request.status !== 'pending' && request.status !== 'partial') {
    return NextResponse.json({ error: '该申请已结案，无需取消' }, { status: 400 });
  }

  const me = access.volunteer;
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('inventory_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', request.id)
    .select(REQUEST_SELECT)
    .single();
  if (updErr || !updated) {
    console.error('[inventory/requests/status] update failed:', updErr);
    return NextResponse.json({ error: '取消失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: 'update',
    tableName: 'inventory_requests',
    recordId: request.id,
    before: { status: request.status },
    after: { status: 'cancelled' },
  });

  return NextResponse.json({ request: updated });
}
