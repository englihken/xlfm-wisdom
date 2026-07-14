// src/app/api/dashboard/finance/meta/route.ts
// GET — finance reference data (finance:view), SCOPE-FILTERED: the active centres the caller may
// see (own_center → just theirs), each with its current receipt-book position (highest receipt_no)
// and this month's collection-pause state. Batched — no per-centre N+1.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { financeScope } from '@/lib/finance';

export const runtime = 'nodejs';

function thisMonthFirst(): string {
  return new Date().toISOString().slice(0, 8) + '01';
}

export async function GET() {
  const access = await requireModuleAccess('finance', 'view');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const scope = financeScope(access.volunteer);

  let centreQ = supabaseAdmin.from('centres').select('id, code, name_cn').eq('is_active', true);
  if (scope.locked) {
    if (!scope.centreId) return NextResponse.json({ centres: [], scope, month: thisMonthFirst() });
    centreQ = centreQ.eq('id', scope.centreId);
  }
  const { data: centres, error: cErr } = await centreQ.order('name_cn', { ascending: true });
  if (cErr) {
    console.error('[finance/meta] centres failed:', cErr);
    return NextResponse.json({ error: 'Failed to load centres' }, { status: 500 });
  }
  const ids = (centres ?? []).map((c) => c.id);
  const month = thisMonthFirst();

  const [{ data: pays }, { data: months }] = await Promise.all([
    ids.length ? supabaseAdmin.from('fee_payments').select('centre_id, receipt_no').in('centre_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? supabaseAdmin.from('centre_finance_months').select('centre_id, collection_paused, paused_note').eq('month', month).in('centre_id', ids) : Promise.resolve({ data: [] }),
  ]);

  // Highest receipt number per centre (numeric part).
  const bookAt = new Map<string, { no: string; num: number }>();
  for (const p of (pays ?? []) as { centre_id: string; receipt_no: string }[]) {
    const m = String(p.receipt_no).match(/(\d+)/);
    const num = m ? parseInt(m[1], 10) : 0;
    const cur = bookAt.get(p.centre_id);
    if (!cur || num >= cur.num) bookAt.set(p.centre_id, { no: p.receipt_no, num });
  }
  const pauseMap = new Map<string, { collection_paused: boolean; paused_note: string | null }>();
  for (const r of (months ?? []) as { centre_id: string; collection_paused: boolean; paused_note: string | null }[]) {
    pauseMap.set(r.centre_id, { collection_paused: r.collection_paused, paused_note: r.paused_note });
  }

  const out = (centres ?? []).map((c) => ({
    id: c.id,
    code: c.code,
    name_cn: c.name_cn,
    receiptBookAt: bookAt.get(c.id)?.no ?? null,
    paused: pauseMap.get(c.id)?.collection_paused ?? false,
    pausedNote: pauseMap.get(c.id)?.paused_note ?? null,
  }));

  return NextResponse.json({ centres: out, scope, month });
}
