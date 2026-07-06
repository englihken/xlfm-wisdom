// src/app/api/dashboard/registrations/[id]/payment/route.ts
// POST — staff payment action on a registration (events:edit), a track SEPARATE from
// approve/reject (approval must work with payment still unpaid — payment never gates it):
//   { action: 'verify', paid_amount?, note? } — acknowledge payment. paid_amount defaults to
//        fee_total, editable; records payment_verified_by/at.
//   { action: 'waive',  note? }               — 已豁免 (guilt-free), paid_amount 0, records who.
//   { action: 'revoke' }                      — undo → 'proof_submitted' if a receipt is on
//        file, else 'unpaid'; clears paid_amount / verifier / note.
// Audited (module 'events'). No delete. Gentle by design: nothing here is coercive.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireModuleAccess('events', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { action?: unknown; paid_amount?: unknown; note?: unknown } | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  if (!['verify', 'waive', 'revoke'].includes(action)) {
    return NextResponse.json({ error: '操作无效（verify/waive/revoke）' }, { status: 400 });
  }

  const { data: reg, error: regErr } = await supabaseAdmin
    .from('registrations')
    .select('id, fee_total, payment_status, payment_proof_path, paid_amount, payment_note')
    .eq('id', id)
    .maybeSingle();
  if (regErr) {
    console.error('[payment] registration fetch failed:', regErr);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
  if (!reg) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const me = access.volunteer;
  const nowIso = new Date().toISOString();
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const update: Record<string, unknown> = { updated_at: nowIso, updated_by: me.id };

  if (action === 'verify') {
    let paid = Number(reg.fee_total) || 0; // default = the fee snapshot
    if (body?.paid_amount !== undefined && body?.paid_amount !== null && body?.paid_amount !== '') {
      const p = Number(body.paid_amount);
      if (!Number.isFinite(p) || p < 0) return NextResponse.json({ error: '金额无效' }, { status: 400 });
      paid = Math.round(p * 100) / 100;
    }
    update.payment_status = 'verified';
    update.paid_amount = paid;
    update.payment_note = note;
    update.payment_verified_by = me.id;
    update.payment_verified_at = nowIso;
  } else if (action === 'waive') {
    update.payment_status = 'waived';
    update.paid_amount = 0;
    update.payment_note = note; // e.g. 'HQ 决定豁免'
    update.payment_verified_by = me.id;
    update.payment_verified_at = nowIso;
  } else {
    // revoke → back to proof_submitted if a receipt exists, else unpaid; clear verification.
    update.payment_status = reg.payment_proof_path ? 'proof_submitted' : 'unpaid';
    update.paid_amount = null;
    update.payment_note = null;
    update.payment_verified_by = null;
    update.payment_verified_at = null;
  }

  const { data: updated, error } = await supabaseAdmin
    .from('registrations')
    .update(update)
    .eq('id', id)
    .select('id, payment_status, paid_amount, payment_note, payment_verified_at')
    .single();
  if (error || !updated) {
    console.error('[payment] update failed:', error);
    return NextResponse.json({ error: '操作失败，请重试' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'events',
    action: 'update',
    tableName: 'registrations',
    recordId: id,
    before: { payment_status: reg.payment_status, paid_amount: reg.paid_amount ?? null, payment_note: reg.payment_note ?? null },
    after: { payment_status: updated.payment_status, paid_amount: updated.paid_amount ?? null, payment_note: updated.payment_note ?? null },
  });

  return NextResponse.json({ registration: updated });
}
