// src/app/api/dashboard/finance/payments/next-receipt/route.ts
// GET ?centre_id= (finance:edit, SCOPE-FORCED) — the next receipt number for the centre's book
// (sequential, zero-padded). Prefills the 记录收款 form; the 财政 may still edit it (衔接旧收据簿),
// and the POST is the real guard against a clash (unique (centre_id, receipt_no)).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { financeScope, enforceScope, nextReceiptNo } from '@/lib/finance';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const access = await requireModuleAccess('finance', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const scope = await financeScope(supabaseAdmin, access.volunteer.id);
  const enforced = enforceScope(scope, new URL(req.url).searchParams.get('centre_id'));
  if (!enforced.ok) return NextResponse.json({ error: enforced.error }, { status: 400 });
  if (!enforced.centreId) return NextResponse.json({ error: '请选择中心' }, { status: 400 });

  const receiptNo = await nextReceiptNo(supabaseAdmin, enforced.centreId);
  return NextResponse.json({ receiptNo });
}
