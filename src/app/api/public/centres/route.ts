// src/app/api/public/centres/route.ts
// PUBLIC (no auth) list of centres that have an ENABLED mailbox — the 共修会 picker on /m.
// Only enabled mailboxes are offered so a write-in can't be routed to a dormant centre.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sameOrigin, rateLimit, clientIp } from '@/lib/public-event';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!rateLimit(`pub:centres:${clientIp(req)}`, 60, 60_000)) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { data } = await supabaseAdmin
    .from('inbox_mailboxes')
    .select('is_enabled, centre:centres!centre_id ( code, name_cn, sort, is_active )')
    .eq('is_enabled', true);

  const centres = (data ?? [])
    .map((m) => {
      const c = Array.isArray(m.centre) ? m.centre[0] : m.centre;
      return c && c.is_active ? { code: c.code as string, name_cn: c.name_cn as string, sort: (c.sort as number) ?? 0 } : null;
    })
    .filter((c): c is { code: string; name_cn: string; sort: number } => c !== null)
    .sort((a, b) => a.sort - b.sort || a.name_cn.localeCompare(b.name_cn));

  return NextResponse.json({ centres });
}
