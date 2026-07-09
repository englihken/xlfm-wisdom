// src/app/api/dashboard/finance/mutual-aid/route.ts
// GET ?year= (finance:view) — the 盈余互助 fund ledger (aggregate, fund-level — 理事会 sees this,
// never individual payments). Returns the year's entries (with centre + creator) plus stats:
// cumulative (all-time in − out), this calendar month's in and out.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const ENTRY_SELECT =
  'id, entry_type, amount, description, resolution_no, month, centre_id, created_at, ' +
  'centre:centres!centre_id ( name_cn ), creator:volunteers!created_by ( display_name, email )';

export async function GET(req: Request) {
  const access = await requireModuleAccess('finance', 'view');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const year = parseInt(sp.get('year') ?? '', 10) || new Date().getFullYear();
  const thisMonth = new Date().toISOString().slice(0, 8) + '01';

  const [{ data: entries, error }, { data: all, error: aErr }] = await Promise.all([
    supabaseAdmin
      .from('mutual_aid_entries')
      .select(ENTRY_SELECT)
      .gte('month', `${year}-01-01`)
      .lte('month', `${year}-12-01`)
      .order('month', { ascending: false })
      .order('created_at', { ascending: false }),
    supabaseAdmin.from('mutual_aid_entries').select('entry_type, amount, month'),
  ]);
  if (error || aErr) {
    console.error('[finance/mutual-aid] load failed:', error ?? aErr);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  let cumulative = 0;
  let monthIn = 0;
  let monthOut = 0;
  for (const e of (all ?? []) as { entry_type: string; amount: number; month: string }[]) {
    const amt = Number(e.amount);
    cumulative += e.entry_type === 'in' ? amt : -amt;
    if (e.month === thisMonth) {
      if (e.entry_type === 'in') monthIn += amt;
      else monthOut += amt;
    }
  }

  return NextResponse.json({ year, entries: entries ?? [], stats: { cumulative, monthIn, monthOut } });
}
