// src/app/api/dashboard/members/import/preview/route.ts
// POST multipart {file} — parse the uploaded 会员 template and return a PREVIEW ONLY
// (no writes): counts + per-row NEW / DUPLICATE / REVIEW / ERROR classification with
// the specific issue per row (members:edit). Commit is a separate route; both run the
// SAME parse+classify (loadAndClassify in src/lib/member-import.ts).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { loadAndClassify, tally } from '@/lib/member-import';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const access = await requireModuleAccess('members', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const res = await loadAndClassify(req);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  return NextResponse.json({
    fileName: res.fileName,
    total: res.rows.length,
    counts: tally(res.rows),
    rows: res.rows.map((r) => ({
      rowNo: r.rowNo,
      name: r.raw.name_cn || r.raw.name_en || '—',
      centre: r.raw.centre,
      phone: r.raw.phone,
      cls: r.cls,
      matchMethod: r.matchMethod,
      issues: r.issues,
    })),
  });
}
