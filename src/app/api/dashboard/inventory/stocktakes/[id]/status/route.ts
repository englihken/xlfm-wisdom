// src/app/api/dashboard/inventory/stocktakes/[id]/status/route.ts
// PATCH — cancel a 盘点 session (inventory:edit): body { status: 'cancelled' }. Draft only; a
// confirmed session is history and cannot be cancelled. Cancelling touches no stock. Audited.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { STOCKTAKE_SELECT } from '../../route';

export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('inventory', 'edit');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.status !== 'cancelled') return NextResponse.json({ error: '仅支持取消（cancelled）' }, { status: 400 });

  const { data: session } = await supabaseAdmin.from('inventory_stocktakes').select('id, status').eq('id', id).maybeSingle();
  if (!session) return NextResponse.json({ error: '盘点不存在' }, { status: 404 });
  if (session.status !== 'draft') return NextResponse.json({ error: '仅草稿状态可以取消' }, { status: 400 });

  const me = access.volunteer;
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('inventory_stocktakes')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .select(STOCKTAKE_SELECT)
    .single();
  if (updErr || !updated) {
    console.error('[inventory/stocktakes/status] update failed:', updErr);
    return NextResponse.json({ error: '取消失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: 'update',
    tableName: 'inventory_stocktakes',
    recordId: id,
    before: { status: 'draft' },
    after: { status: 'cancelled' },
  });

  return NextResponse.json({ stocktake: updated });
}
