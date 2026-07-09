// src/app/api/dashboard/inventory/media-url/route.ts
// GET ?path=… (inventory:view) — mint a SHORT-LIVED (~60s) signed URL for an object in the
// PRIVATE 'inventory-media' bucket so staff can view a 发放存证 / 品项 photo. The path must
// live under proofs/ or photos/ (no traversal). Never returns a public URL. Mirrors the
// registrations proof-url route.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const BUCKET = 'inventory-media';
const TTL_SECONDS = 60;

export async function GET(req: Request) {
  const access = await requireModuleAccess('inventory', 'view');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const path = (new URL(req.url).searchParams.get('path') ?? '').trim();
  if (!path || !/^(proofs|photos)\/[A-Za-z0-9._-]+$/.test(path)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    console.error('[inventory/media-url] sign failed:', signErr);
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ url: signed.signedUrl, isPdf: path.toLowerCase().endsWith('.pdf') });
}
