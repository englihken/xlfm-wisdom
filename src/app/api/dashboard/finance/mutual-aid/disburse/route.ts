// src/app/api/dashboard/finance/mutual-aid/disburse/route.ts
// POST — record a fund disbursement (finance:ADMIN only). Body { amount>0, description,
// resolution_no (REQUIRED — a disbursement must cite a 理事会 resolution; the DB CHECK enforces
// this too), month }. Inserts mutual_aid_entries('out'). Audited.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { monthInputToDate } from '@/lib/finance';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const access = await requireModuleAccess('finance', 'admin');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const amount = Number(body?.amount);
  if (!(amount > 0)) return NextResponse.json({ error: '金额须大于 0' }, { status: 400 });
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  if (!description) return NextResponse.json({ error: '请填写说明' }, { status: 400 });
  const resolutionNo = typeof body?.resolution_no === 'string' ? body.resolution_no.trim() : '';
  if (!resolutionNo) return NextResponse.json({ error: '支用必须填写理事会决议编号' }, { status: 400 });
  const month = monthInputToDate(typeof body?.month === 'string' ? body.month.slice(0, 7) : '');
  if (!month) return NextResponse.json({ error: '月份无效（格式 2026-07）' }, { status: 400 });

  const me = access.volunteer;
  const { data: entry, error } = await supabaseAdmin
    .from('mutual_aid_entries')
    .insert({ entry_type: 'out', amount, description, resolution_no: resolutionNo, month, created_by: me.id })
    .select('id')
    .single();
  if (error || !entry) {
    console.error('[finance/mutual-aid/disburse] insert failed:', error);
    return NextResponse.json({ error: '记支用失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'create',
    tableName: 'mutual_aid_entries',
    recordId: (entry as unknown as { id: string }).id,
    after: { entry_type: 'out', amount, resolution_no: resolutionNo, month: month.slice(0, 7) },
  });

  return NextResponse.json({ entry }, { status: 201 });
}
