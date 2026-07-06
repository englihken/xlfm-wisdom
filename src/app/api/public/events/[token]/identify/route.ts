// src/app/api/public/events/[token]/identify/route.ts
// PUBLIC ANONYMOUS ROUTE — no login; gate is token+enabled+open; touches only this
// event + its own registration; must never read members beyond a masked phone match,
// never care.
//
// POST { phone } — normalize the phone, silently match ONE active member by it, and
//   return ONLY { matched, maskedName?, maskedCentre? }. NEVER returns member_id, full
//   name, or any other field. Matched and unmatched share an identical shape (no leak).
//   A masked initial is the entire harvestable surface — Ken's chosen privacy stance.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizePhone } from '@/lib/members';
import { loadPublicEvent, sameOrigin, rateLimit, clientIp, readJsonCapped, hasUnknownKeys, maskName } from '@/lib/public-event';

export const runtime = 'nodejs';

const ALLOWED = ['phone'] as const;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!rateLimit(`pub:identify:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { token } = await params;
  // Gate FIRST: an invalid/disabled/closed token reveals nothing (404) — no phone lookup.
  const ev = await loadPublicEvent(token);
  if (!ev.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await readJsonCapped(req);
  if (!body || hasUnknownKeys(body, ALLOWED)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { phone, error } = normalizePhone(String(body.phone ?? ''));
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!phone) return NextResponse.json({ error: '请填写电话号码' }, { status: 400 });

  // Match exactly one ACTIVE member by normalized phone (phone is partial-unique). An
  // inactive/no match returns the SAME { matched:false } shape — no existence leak.
  const { data: member } = await supabaseAdmin
    .from('members')
    .select('name_cn, name_en, centre:centres!gyt_centre_id ( name_cn )')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (!member) return NextResponse.json({ matched: false });

  const centreRaw = (member as { centre?: { name_cn: string } | { name_cn: string }[] | null }).centre;
  const centre = Array.isArray(centreRaw) ? centreRaw[0] ?? null : centreRaw ?? null;

  return NextResponse.json({
    matched: true,
    maskedName: maskName(member.name_cn, member.name_en),
    // Coarse centre confirmation (one of ~36) to help the real owner recognise themselves.
    // Not further masked; it is the mild-privacy lever if the policy tightens.
    maskedCentre: centre?.name_cn ?? undefined,
  });
}
