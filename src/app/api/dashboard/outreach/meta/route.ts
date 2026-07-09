// src/app/api/dashboard/outreach/meta/route.ts
// GET (outreach:view) — reference data for the 渡人 filters + pickers: active centres and recent
// events. Served under the OUTREACH grant on purpose — 关怀义工 hold outreach but NOT members:view
// or events:view, so the workbench must not depend on those modules to filter by centre or tag an
// activity. Read-only, lightweight.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const access = await requireModuleAccess('outreach', 'view');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const [{ data: centres, error: cErr }, { data: events, error: eErr }] = await Promise.all([
    supabaseAdmin.from('centres').select('id, code, name_cn').eq('is_active', true).order('name_cn', { ascending: true }),
    supabaseAdmin.from('events').select('id, code, title, starts_on').order('starts_on', { ascending: false }).limit(50),
  ]);
  if (cErr || eErr) {
    console.error('[outreach/meta] failed:', cErr ?? eErr);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
  return NextResponse.json({ centres: centres ?? [], events: events ?? [] });
}
