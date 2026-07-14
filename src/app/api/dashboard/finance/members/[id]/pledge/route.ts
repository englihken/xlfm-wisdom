// src/app/api/dashboard/finance/members/[id]/pledge/route.ts
// PATCH — edit a member's 认捐/豁免 (finance:edit, SCOPE-FORCED on the member's gyt_centre_id).
// Pledge and waiver are INDEPENDENT: fee_pledge_amount (null=未认捐, else >0) with a required
// fee_pledge_period (month|year) when an amount is set; fee_waived_from (date|null, first-class
// 豁免) + fee_waiver_note. A waived member may keep a historical pledge — the two never collapse
// into one field. Audited (module 'finance', table 'members').

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { financeScope, enforceScope } from '@/lib/finance';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('finance', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { data: member } = await supabaseAdmin
    .from('members')
    .select('id, name_cn, gyt_centre_id, fee_pledge_amount, fee_pledge_period, fee_waived_from, fee_waiver_note')
    .eq('id', id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: '会员不存在' }, { status: 404 });

  const scope = financeScope(access.volunteer);
  const enforced = enforceScope(scope, member.gyt_centre_id);
  if (!enforced.ok) return NextResponse.json({ error: enforced.error }, { status: 400 });

  const patch: Record<string, unknown> = {};

  // Pledge (amount + period travel together).
  if ('fee_pledge_amount' in body) {
    const raw = body.fee_pledge_amount;
    if (raw === null || raw === '') {
      patch.fee_pledge_amount = null;
      patch.fee_pledge_period = null;
    } else {
      const amt = Number(raw);
      if (!(amt > 0)) return NextResponse.json({ error: '认捐金额须大于 0，或留空表示未认捐' }, { status: 400 });
      const period = typeof body.fee_pledge_period === 'string' ? body.fee_pledge_period : '';
      if (period !== 'month' && period !== 'year') return NextResponse.json({ error: '请选择认捐周期（月/年）' }, { status: 400 });
      patch.fee_pledge_amount = amt;
      patch.fee_pledge_period = period;
    }
  }

  // Waiver (independent of pledge).
  if ('fee_waived_from' in body) {
    const raw = body.fee_waived_from;
    if (raw === null || raw === '') {
      patch.fee_waived_from = null;
      patch.fee_waiver_note = null;
    } else {
      if (typeof raw !== 'string' || !DATE_RE.test(raw)) return NextResponse.json({ error: '豁免起始日期无效' }, { status: 400 });
      patch.fee_waived_from = raw;
      if ('fee_waiver_note' in body) patch.fee_waiver_note = typeof body.fee_waiver_note === 'string' ? body.fee_waiver_note.trim() || null : null;
    }
  } else if ('fee_waiver_note' in body) {
    patch.fee_waiver_note = typeof body.fee_waiver_note === 'string' ? body.fee_waiver_note.trim() || null : null;
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });

  const before = {
    fee_pledge_amount: member.fee_pledge_amount,
    fee_pledge_period: member.fee_pledge_period,
    fee_waived_from: member.fee_waived_from,
    fee_waiver_note: member.fee_waiver_note,
  };

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('members')
    .update(patch)
    .eq('id', id)
    .select('id, fee_pledge_amount, fee_pledge_period, fee_waived_from, fee_waiver_note')
    .single();
  if (updErr || !updated) {
    console.error('[finance/members/pledge] update failed:', updErr);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }

  const me = access.volunteer;
  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'update',
    tableName: 'members',
    recordId: id,
    before,
    after: patch,
  });

  return NextResponse.json({ member: updated });
}
