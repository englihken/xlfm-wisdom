// src/app/api/reports/pack/route.ts
// GET ?month=YYYY-MM — the whole 月度检讨包, server-assembled in ONE response
// (brief §2: no client fan-out). Gate: role_grants module 'reports' ≥ view
// (migration 032: admin/erp_admin/committee/finance_director national,
// centre_head own-centre slice — scoping lives in lib/reports-pack).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { assembleReportsPack } from '@/lib/reports-pack';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const access = await requireModuleAccess('reports', 'view');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  try {
    const month = new URL(req.url).searchParams.get('month');
    const pack = await assembleReportsPack(access.volunteer, month);
    return NextResponse.json(pack);
  } catch (e) {
    console.error('[reports/pack] assembly failed:', e);
    return NextResponse.json({ error: 'Failed to load report pack' }, { status: 500 });
  }
}
