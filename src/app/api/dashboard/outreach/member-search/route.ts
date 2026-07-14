// src/app/api/dashboard/outreach/member-search/route.ts
// GET ?q= (outreach:view) — a tiny name/phone member lookup for the 渡人卡 member-link picker.
// Lives under the outreach grant on purpose: an outreach volunteer links a 结缘人 to a member
// record WITHOUT needing members:view. Returns at most 10 lightweight rows — never full members.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { outreachScope } from '@/lib/outreach-scope';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const access = await requireModuleAccess('outreach', 'view');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ members: [] });
  const safe = q.replace(/[,.()%*"\\]/g, ' ').trim();
  // ≥2 chars (security audit H6): blunt single-character prefix enumeration.
  if (safe.length < 2) return NextResponse.json({ members: [] });

  // CENTRE-SCOPE WALL (security audit H6): same wall as every other outreach route —
  // a locked (own_center) caller only searches members of their own centre.
  const scope = await outreachScope(supabaseAdmin, access.volunteer.id);
  if (scope.locked && !scope.centreId) return NextResponse.json({ members: [] });

  let query = supabaseAdmin
    .from('members')
    .select('id, name_cn, name_en, phone')
    .eq('status', 'active')
    .or(`name_cn.ilike.%${safe}%,name_en.ilike.%${safe}%,phone.ilike.%${safe}%`)
    .order('name_cn', { ascending: true })
    .limit(10);
  if (scope.locked) query = query.eq('gyt_centre_id', scope.centreId);

  const { data, error } = await query;
  if (error) {
    console.error('[outreach/member-search] failed:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
  return NextResponse.json({ members: data ?? [] });
}
