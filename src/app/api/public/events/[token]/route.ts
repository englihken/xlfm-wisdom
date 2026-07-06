// src/app/api/public/events/[token]/route.ts
// PUBLIC ANONYMOUS ROUTE — no login; gate is token+enabled+open; touches only this
// event + its own registration; must never read members beyond a masked phone match,
// never care.
//
// GET — load the public-safe event JSON for /r/<token> (or 404). loadPublicEvent is the
//       single door: a disabled / closed / unknown token is indistinguishable from
//       not-found. No cookies read, no requireModuleAccess — intentionally anonymous.

import { NextResponse } from 'next/server';
import { loadPublicEvent, sameOrigin, rateLimit, clientIp } from '@/lib/public-event';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!rateLimit(`pub:event:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { token } = await params;
  const res = await loadPublicEvent(token);
  if (!res.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ event: res.event });
}
