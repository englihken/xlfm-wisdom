// src/app/api/reports/pack.csv/route.ts
// GET ?month=YYYY-MM&page=outreach|care|ops|eventsInv|inbox — flat CSV rows for
// one dept page of the 月度检讨包 (brief §2, the quiet link in the UI). Same
// gate + same assembly as /api/reports/pack, so the numbers can never diverge.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { assembleReportsPack, packPageToCsv } from '@/lib/reports-pack';

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
    const sp = new URL(req.url).searchParams;
    const pack = await assembleReportsPack(access.volunteer, sp.get('month'));
    const page = sp.get('page') ?? 'outreach';
    // A locked account never gets a page that isn't in its payload (uniform wall).
    if (!pack.pages.includes(page) && page !== 'outreach') {
      return NextResponse.json({ error: '不存在' }, { status: 404 });
    }
    const csv = packPageToCsv(pack, page);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pack-${pack.month}-${page}.csv"`,
      },
    });
  } catch (e) {
    console.error('[reports/pack.csv] failed:', e);
    return NextResponse.json({ error: 'Failed to export CSV' }, { status: 500 });
  }
}
