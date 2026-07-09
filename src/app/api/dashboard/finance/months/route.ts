// src/app/api/dashboard/finance/months/route.ts
// PATCH — set a centre's monthly collection-pause (finance:edit, SCOPE-FORCED). Body
// { centre_id, month, collection_paused, paused_note? }. Upserts centre_finance_months
// (PK centre_id+month). This MANUAL pause is the transparency-over-cap model — there is no
// automatic ceiling. Audited.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { financeScope, enforceScope, monthInputToDate } from '@/lib/finance';

export const runtime = 'nodejs';

export async function PATCH(req: Request) {
  const access = await requireModuleAccess('finance', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const scope = await financeScope(supabaseAdmin, access.volunteer.id);
  const enforced = enforceScope(scope, typeof body.centre_id === 'string' ? body.centre_id : null);
  if (!enforced.ok) return NextResponse.json({ error: enforced.error }, { status: 400 });
  const centreId = enforced.centreId;
  if (!centreId) return NextResponse.json({ error: '请选择中心' }, { status: 400 });

  const month = monthInputToDate(typeof body.month === 'string' ? body.month.slice(0, 7) : '');
  if (!month) return NextResponse.json({ error: '月份无效（格式 2026-07）' }, { status: 400 });
  if (typeof body.collection_paused !== 'boolean') return NextResponse.json({ error: '缺少 collection_paused' }, { status: 400 });
  const note = typeof body.paused_note === 'string' ? body.paused_note.trim() || null : null;

  const me = access.volunteer;
  const { data: row, error } = await supabaseAdmin
    .from('centre_finance_months')
    .upsert(
      { centre_id: centreId, month, collection_paused: body.collection_paused, paused_note: note, updated_by: me.id, updated_at: new Date().toISOString() },
      { onConflict: 'centre_id,month' }
    )
    .select('centre_id, month, collection_paused, paused_note')
    .single();
  if (error || !row) {
    console.error('[finance/months] upsert failed:', error);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'update',
    tableName: 'centre_finance_months',
    recordId: `${centreId}:${month}`,
    after: { collection_paused: body.collection_paused, paused_note: note },
  });

  return NextResponse.json({ month: row });
}
