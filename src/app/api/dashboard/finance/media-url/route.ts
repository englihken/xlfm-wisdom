// src/app/api/dashboard/finance/media-url/route.ts
// GET ?path=… (finance:view) — a short-lived (~60s) signed URL for an object in the PRIVATE
// 'finance-receipts' bucket (expense 单据照片). The path must live under receipts/. Never returns
// a public URL. Mirrors inventory/media-url.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const BUCKET = 'finance-receipts';
const TTL_SECONDS = 60;

export async function GET(req: Request) {
  const access = await requireModuleAccess('finance', 'view');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const path = (new URL(req.url).searchParams.get('path') ?? '').trim();
  if (!path || !/^receipts\/[A-Za-z0-9._-]+$/.test(path)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: signed, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, TTL_SECONDS);
  if (error || !signed?.signedUrl) {
    console.error('[finance/media-url] sign failed:', error);
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ url: signed.signedUrl, isPdf: path.toLowerCase().endsWith('.pdf') });
}
