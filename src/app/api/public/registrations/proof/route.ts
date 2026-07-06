// src/app/api/public/registrations/proof/route.ts
// PUBLIC ANONYMOUS ROUTE — no login; gate is proof-of-ownership (reg_no + matching phone);
// touches only the ONE matched registration + its own private receipt object; must never
// read members beyond the matched registration's phone, never care.
//
// POST multipart/form-data { reg_no, phone, file } — attach an OPTIONAL payment receipt to a
//   registration the caller proves they own. Uploads to the PRIVATE 'payment-proofs' bucket
//   via the service-role client at a RANDOMISED path (client filename never trusted), then
//   marks payment_status='proof_submitted'. Payment is entirely optional and never gates
//   anything — this route only ever ADVANCES a receipt on file; it does NOT demote a status a
//   staff member already set to 'verified' / 'waived'.

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { normalizePhone } from '@/lib/members';
import { sameOrigin, rateLimit, clientIp, matchOwnedRegistration } from '@/lib/public-event';

export const runtime = 'nodejs';

const BUCKET = 'payment-proofs';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
// Allowed receipt types → file extension. Receipts are photos or a PDF.
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
};

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!rateLimit(`pub:proof:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  // Cap the whole request before buffering the multipart body (defense in depth).
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BYTES + 8192) {
    return NextResponse.json({ error: '文件过大（上限 5MB）' }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const regNoRaw = form.get('reg_no');
  const phoneRaw = form.get('phone');
  const file = form.get('file');
  const regNo = typeof regNoRaw === 'string' ? regNoRaw.trim() : '';
  if (!regNo || !/^[A-Za-z0-9-]{1,40}$/.test(regNo)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { phone, error: phoneErr } = normalizePhone(String(phoneRaw ?? ''));
  if (phoneErr || !phone) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // File validation — type + size, before any ownership work touches the DB unnecessarily.
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: '请选择要上传的文件' }, { status: 400 });
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: '仅支持图片（JPG/PNG/WEBP/HEIC）或 PDF' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '文件过大（上限 5MB）' }, { status: 400 });

  // Ownership proof: reg_no + matching phone → the ONE registration (else 404, no signal).
  const reg = await matchOwnedRegistration(regNo, phone);
  if (!reg) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Randomised object path — NEVER the client filename. Scoped under the reg id.
  const path = `${reg.id}/${randomBytes(12).toString('hex')}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (upErr) {
    console.error('[public/proof] upload failed:', upErr);
    return NextResponse.json({ error: '上传失败，请重试' }, { status: 500 });
  }

  // Replace a prior proof object (best effort — a stale object is harmless in a private bucket).
  if (reg.payment_proof_path && reg.payment_proof_path !== path) {
    await supabaseAdmin.storage.from(BUCKET).remove([reg.payment_proof_path]).catch(() => {});
  }

  // Advance the status, but NEVER demote a staff decision. A new receipt on an already
  // verified/waived reg keeps that state; unpaid/proof_submitted → proof_submitted.
  const nextStatus = reg.payment_status === 'verified' || reg.payment_status === 'waived' ? reg.payment_status : 'proof_submitted';
  const { error: updErr } = await supabaseAdmin
    .from('registrations')
    .update({ payment_status: nextStatus, payment_proof_path: path, updated_at: new Date().toISOString() })
    .eq('id', reg.id);
  if (updErr) {
    console.error('[public/proof] status update failed:', updErr);
    return NextResponse.json({ error: '上传失败，请重试' }, { status: 500 });
  }

  await writeAudit({
    actorId: null,
    actorEmail: 'public',
    module: 'events',
    action: 'update',
    tableName: 'registrations',
    recordId: reg.id,
    after: { payment_status: nextStatus, payment_proof: true },
  });

  return NextResponse.json({ ok: true });
}
