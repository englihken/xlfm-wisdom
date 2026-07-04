// src/app/api/dashboard/erp/meta/route.ts
// GET — reference data for ERP form dropdowns (members:view): active centres and
// active teams, each ordered by sort. Small, cacheable-shaped payload.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const access = await requireModuleAccess('members', 'view');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  const { data: centres, error: cErr } = await supabaseAdmin
    .from('centres')
    .select('id, code, name_cn, name_en')
    .eq('is_active', true)
    .order('sort', { ascending: true });

  const { data: teams, error: tErr } = await supabaseAdmin
    .from('teams')
    .select('id, name_cn, slug')
    .eq('is_active', true)
    .order('sort', { ascending: true });

  if (cErr || tErr) {
    console.error('[erp/meta] load failed:', cErr ?? tErr);
    return NextResponse.json({ error: 'Failed to load reference data' }, { status: 500 });
  }

  return NextResponse.json({ centres: centres ?? [], teams: teams ?? [] });
}
