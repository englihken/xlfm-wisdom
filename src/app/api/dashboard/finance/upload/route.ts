// src/app/api/dashboard/finance/upload/route.ts
// POST multipart/form-data { file } (finance:edit) — upload ONE image to the PRIVATE
// 'finance-receipts' bucket at receipts/<uuid>.<ext> (client filename never trusted; same
// size/type limits as the other upload routes). Returns { path } to persist on an expense
// (receipt_path). Mirrors inventory/upload.

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const BUCKET = 'finance-receipts';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
};

export async function POST(req: Request) {
  const access = await requireModuleAccess('finance', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BYTES + 8192) return NextResponse.json({ error: '文件过大（上限 5MB）' }, { status: 400 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: '请选择要上传的文件' }, { status: 400 });
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: '仅支持图片（JPG/PNG/WEBP/HEIC）或 PDF' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '文件过大（上限 5MB）' }, { status: 400 });

  const path = `receipts/${randomBytes(12).toString('hex')}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, { contentType: file.type, upsert: false });
  if (upErr) {
    console.error('[finance/upload] upload failed:', upErr);
    return NextResponse.json({ error: '上传失败，请重试' }, { status: 500 });
  }

  return NextResponse.json({ path }, { status: 201 });
}
