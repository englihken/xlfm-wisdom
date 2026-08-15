// src/app/api/dashboard/reviews/[id]/route.ts
// PATCH — disposition a 复盘队列 item (P1 §1.5). care ≥ edit (matches the
// table's UPDATE RLS policy).
//   { action: 'dismiss', reason: string }  → status='dismissed' + dismissed_reason (required)
//   { action: 'handle' }                   → status='handled' + handled_by/handled_at
// Only OPEN reviews can be dispositioned; each write leaves an audit_log row
// (module='care', action='review_dismissed'/'review_handled').

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireModuleAccess('care', 'edit');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }
  const me = access.volunteer;

  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; reason?: unknown }
    | null;
  const action = body?.action;
  if (action !== 'dismiss' && action !== 'handle') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (action === 'dismiss' && !reason) {
    return NextResponse.json({ error: '请填写忽略原因' }, { status: 400 });
  }

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('conversation_reviews')
    .select('id, status, verdict, conversation_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    console.error('[dashboard/reviews] fetch failed:', fetchError);
    return NextResponse.json({ error: 'Failed to load review' }, { status: 500 });
  }
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.status !== 'open') {
    return NextResponse.json({ error: '该条目已处理' }, { status: 409 });
  }

  const updates =
    action === 'dismiss'
      ? { status: 'dismissed', dismissed_reason: reason.slice(0, 500) }
      : { status: 'handled', handled_by: me.id, handled_at: new Date().toISOString() };

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('conversation_reviews')
    .update(updates)
    .eq('id', id)
    .eq('status', 'open') // double-guard against a concurrent disposition
    .select('id, status, dismissed_reason, handled_by, handled_at')
    .maybeSingle();
  if (updateError || !updated) {
    console.error('[dashboard/reviews] update failed:', updateError);
    return NextResponse.json({ error: '操作失败，请重试' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'care',
    action: action === 'dismiss' ? 'review_dismissed' : 'review_handled',
    tableName: 'conversation_reviews',
    recordId: id,
    before: { status: 'open', verdict: existing.verdict, conversation_id: existing.conversation_id },
    after: updates,
  });

  return NextResponse.json({ ok: true, review: updated });
}
