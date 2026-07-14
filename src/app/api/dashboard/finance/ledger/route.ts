// src/app/api/dashboard/finance/ledger/route.ts
// GET — the 月费台账 data for one centre + year (finance:view, SCOPE-FORCED): the centre's active
// members with their four fee_* pledge fields, plus every NON-VOID fee_payment whose covered
// month range intersects the year. ?include_void=1 additionally returns voided payments (detail
// panel). The client assembles the 12-month grid. Batched — two queries, no N+1.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { financeScope, enforceScope } from '@/lib/finance';

export const runtime = 'nodejs';

const PAYMENT_SELECT =
  'id, member_id, receipt_no, paid_at, amount, months_from, months_to, channel, note, voided_at, void_reason, ' +
  'enterer:volunteers!entered_by ( display_name, email )';

export async function GET(req: Request) {
  const access = await requireModuleAccess('finance', 'view');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const scope = financeScope(access.volunteer);
  const enforced = enforceScope(scope, sp.get('centre_id'));
  if (!enforced.ok) return NextResponse.json({ error: enforced.error }, { status: 400 });
  const centreId = enforced.centreId;
  if (!centreId) return NextResponse.json({ error: '请选择中心' }, { status: 400 });

  const year = parseInt(sp.get('year') ?? '', 10) || new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-01`;
  const includeVoid = sp.get('include_void') === '1';

  // Members of this centre (active) with pledge fields.
  const { data: members, error: mErr } = await supabaseAdmin
    .from('members')
    .select('id, name_cn, name_en, phone, fee_pledge_amount, fee_pledge_period, fee_waived_from, fee_waiver_note')
    .eq('gyt_centre_id', centreId)
    .eq('status', 'active')
    .order('name_cn', { ascending: true });
  if (mErr) {
    console.error('[finance/ledger] members failed:', mErr);
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }

  // Non-void payments intersecting the year (months_from <= yearEnd AND months_to >= yearStart).
  const { data: payments, error: pErr } = await supabaseAdmin
    .from('fee_payments')
    .select(PAYMENT_SELECT)
    .eq('centre_id', centreId)
    .is('voided_at', null)
    .lte('months_from', yearEnd)
    .gte('months_to', yearStart)
    .order('paid_at', { ascending: true });
  if (pErr) {
    console.error('[finance/ledger] payments failed:', pErr);
    return NextResponse.json({ error: 'Failed to load payments' }, { status: 500 });
  }

  let voided: unknown[] | undefined;
  if (includeVoid) {
    const { data: v } = await supabaseAdmin
      .from('fee_payments')
      .select(PAYMENT_SELECT)
      .eq('centre_id', centreId)
      .not('voided_at', 'is', null)
      .lte('months_from', yearEnd)
      .gte('months_to', yearStart)
      .order('paid_at', { ascending: true });
    voided = v ?? [];
  }

  return NextResponse.json({ centreId, year, members: members ?? [], payments: payments ?? [], ...(voided ? { voided } : {}) });
}
