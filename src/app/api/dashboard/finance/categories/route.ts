// src/app/api/dashboard/finance/categories/route.ts
// GET (finance:view) — the org-wide 收支类别 taxonomy from migration 039 (25 seeded
// rows). NOT centre-scoped: the taxonomy is shared by every centre, so there is no
// enforceScope call here on purpose — the rows carry no centre data to leak.
// READ-ONLY in Phase 1 (no category editing UI); trilingual names ride along as
// data (name_cn/name_en/name_id) and the client picks by locale.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const access = await requireModuleAccess('finance', 'view');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { data, error } = await supabaseAdmin
    .from('finance_categories')
    .select('id, kind, grp, name_cn, name_en, name_id, sort')
    .eq('is_active', true)
    .order('kind', { ascending: true })
    .order('sort', { ascending: true });
  if (error) {
    console.error('[finance/categories] list failed:', error);
    return NextResponse.json({ error: 'Failed to load categories' }, { status: 500 });
  }
  return NextResponse.json({ categories: data ?? [] });
}
