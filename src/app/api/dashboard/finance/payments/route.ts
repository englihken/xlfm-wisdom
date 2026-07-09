// src/app/api/dashboard/finance/payments/route.ts
// POST — record a fee payment (finance:edit, SCOPE-FORCED). Body { centre_id, member_id,
// receipt_no, paid_at, amount, channel, months_from, months_to, note? }. The covered month range
// is stored EXPLICITLY (first-of-month dates), never derived from amount. receipt_no is editable
// (衔接旧收据簿); a clash on (centre_id, receipt_no) → friendly 400 so two 财政 never silently
// collide. Audited. NO overdue/derivation logic anywhere.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { financeScope, enforceScope, monthInputToDate, monthRangeValid, FEE_CHANNELS } from '@/lib/finance';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
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

  const memberId = typeof body.member_id === 'string' ? body.member_id : '';
  if (!memberId) return NextResponse.json({ error: '请选择赞助者' }, { status: 400 });
  const { data: member } = await supabaseAdmin
    .from('members')
    .select('id, name_cn, gyt_centre_id')
    .eq('id', memberId)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: '赞助者无效' }, { status: 400 });
  if (member.gyt_centre_id !== centreId) return NextResponse.json({ error: '该赞助者不属于此中心' }, { status: 400 });

  const receiptNo = typeof body.receipt_no === 'string' ? body.receipt_no.trim() : '';
  if (!receiptNo) return NextResponse.json({ error: '请填写收据号' }, { status: 400 });

  const paidAt = typeof body.paid_at === 'string' && DATE_RE.test(body.paid_at) ? body.paid_at : '';
  if (!paidAt) return NextResponse.json({ error: '收款日期无效' }, { status: 400 });

  const amount = Number(body.amount);
  if (!(amount > 0)) return NextResponse.json({ error: '金额须大于 0' }, { status: 400 });

  const channel = typeof body.channel === 'string' ? body.channel : '';
  if (!(FEE_CHANNELS as readonly string[]).includes(channel)) return NextResponse.json({ error: '渠道无效' }, { status: 400 });

  const monthsFrom = monthInputToDate(body.months_from);
  const monthsTo = monthInputToDate(body.months_to);
  if (!monthsFrom || !monthsTo) return NextResponse.json({ error: '覆盖月份无效（格式 2026-09）' }, { status: 400 });
  if (!monthRangeValid(monthsFrom, monthsTo)) return NextResponse.json({ error: '「至」月份不能早于「从」月份' }, { status: 400 });

  const me = access.volunteer;
  const { data: payment, error: insErr } = await supabaseAdmin
    .from('fee_payments')
    .insert({
      centre_id: centreId,
      member_id: memberId,
      receipt_no: receiptNo,
      paid_at: paidAt,
      amount,
      channel,
      months_from: monthsFrom,
      months_to: monthsTo,
      note: typeof body.note === 'string' ? body.note.trim() || null : null,
      entered_by: me.id,
    })
    .select('id, receipt_no, amount, months_from, months_to')
    .single();
  if (insErr || !payment) {
    if (insErr?.code === '23505') return NextResponse.json({ error: '收据号已被使用，请刷新号码' }, { status: 400 });
    console.error('[finance/payments] insert failed:', insErr);
    return NextResponse.json({ error: '保存收款失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'create',
    tableName: 'fee_payments',
    recordId: (payment as unknown as { id: string }).id,
    after: { centre_id: centreId, member: member.name_cn, receipt_no: receiptNo, amount, months_from: monthsFrom, months_to: monthsTo, channel },
  });

  return NextResponse.json({ payment }, { status: 201 });
}
