// src/app/api/dashboard/finance/payments/[id]/void/route.ts
// POST — void a fee payment (finance:edit, SCOPE-FORCED): body { reason } required. Corrections
// are voids, never deletes (no DELETE anywhere). Only a non-void payment may be voided. Sets
// voided_at/by/reason. Audited with before/after.

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

  const { data: payment } = await supabaseAdmin
    .from('fee_payments')
    .select('id, centre_id, voided_at')
    .eq('id', id)
    .maybeSingle();
  if (!payment) return NextResponse.json({ error: '收款记录不存在' }, { status: 404 });

  const scope = await financeScope(supabaseAdmin, access.volunteer.id);
  const enforced = enforceScope(scope, payment.centre_id);
  if (!enforced.ok) return NextResponse.json({ error: enforced.error }, { status: 400 });
  if (payment.voided_at) return NextResponse.json({ error: '该记录已作废' }, { status: 400 });

  const me = access.volunteer;
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('fee_payments')
    .update({ voided_at: new Date().toISOString(), voided_by: me.id, void_reason: reason })
    .eq('id', id)
    .select('id, voided_at')
    .single();
  if (updErr || !updated) {
    console.error('[finance/payments/void] update failed:', updErr);
    return NextResponse.json({ error: '作废失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'update',
    tableName: 'fee_payments',
    recordId: id,
    before: { voided: false },
    after: { voided: true, void_reason: reason },
  });

  return NextResponse.json({ payment: updated });
}
