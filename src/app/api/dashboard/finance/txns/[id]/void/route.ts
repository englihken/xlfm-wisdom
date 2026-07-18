// src/app/api/dashboard/finance/txns/[id]/void/route.ts
// POST — void a 流水 row (finance:edit, SCOPE-FORCED): body { reason } required.
// Corrections are voids, never deletes — a cash book must keep its history, and
// the balance math simply skips voided rows (see computeBalances). Record-first
// scoping: checked against the ROW's centre_id. Audited with before/after.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { financeScope, enforceScope } from '@/lib/finance';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('finance', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: '请填写作废原因' }, { status: 400 });

  const { data: txn } = await supabaseAdmin
    .from('finance_transactions')
    .select('id, centre_id, voided_at, amount, direction')
    .eq('id', id)
    .maybeSingle();
  if (!txn) return NextResponse.json({ error: '记录不存在' }, { status: 404 });

  const enforced = enforceScope(financeScope(access.volunteer), txn.centre_id);
  if (!enforced.ok) return NextResponse.json({ error: enforced.error }, { status: 400 });
  if (txn.voided_at) return NextResponse.json({ error: '该记录已作废' }, { status: 400 });

  const me = access.volunteer;
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('finance_transactions')
    .update({ voided_at: new Date().toISOString(), voided_by: me.id, void_reason: reason })
    .eq('id', id)
    .select('id, voided_at, void_reason')
    .single();
  if (updErr || !updated) {
    console.error('[finance/txns/void] update failed:', updErr);
    return NextResponse.json({ error: '作废失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'update',
    tableName: 'finance_transactions',
    recordId: id,
    before: { voided: false },
    after: { voided: true, void_reason: reason },
  });

  return NextResponse.json({ txn: updated });
}
