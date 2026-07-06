// src/app/api/dashboard/registrations/[id]/proof-url/route.ts
// GET — mint a SHORT-LIVED (~60s) signed URL for a registration's payment receipt so staff
// can view it (events:view). The 'payment-proofs' bucket is PRIVATE; this server-side signed
// URL is the ONLY way to read an object. Never returns the raw storage path or a public URL.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const BUCKET = 'payment-proofs';
const TTL_SECONDS = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireModuleAccess('events', 'view');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { data: reg, error } = await supabaseAdmin
    .from('registrations')
    .select('payment_proof_path')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[proof-url] registration fetch failed:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
  if (!reg || !reg.payment_proof_path) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(reg.payment_proof_path as string, TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    console.error('[proof-url] sign failed:', signErr);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }

  const isPdf = (reg.payment_proof_path as string).toLowerCase().endsWith('.pdf');
  return NextResponse.json({ url: signed.signedUrl, isPdf });
}
