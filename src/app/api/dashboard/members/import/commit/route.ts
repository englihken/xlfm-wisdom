// src/app/api/dashboard/members/import/commit/route.ts
// POST multipart {file} — COMMIT a member bulk-import after the admin confirmed the
// preview (members:edit). The file is re-parsed and re-classified server-side with
// the SAME loadAndClassify the preview used — the client is never trusted with the
// classification. Writes:
//   • one import_batches row (source_file, sheet_name, row_count, stats, created_by)
//   • one legacy_rows row for EVERY source data row (raw jsonb, member_id when matched
//     or created, match_method 'phone'|'name_centre'|'created'|null, issues[])
//   • the NEW members (import_batch_id set, status 'active', member_type blank→member)
// DUPLICATE rows are SKIPPED and reported — v1 NEVER overwrites an existing member.
// Re-uploading the same file therefore inserts 0 (every row now matches → duplicate).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { loadAndClassify, tally, IMPORT_SHEET, type ImportRow } from '@/lib/member-import';

export const runtime = 'nodejs';

const INSERT_BATCH = 200;

export async function POST(req: Request) {
  const access = await requireModuleAccess('members', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const me = access.volunteer;

  const res = await loadAndClassify(req);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const rows = res.rows;

  // ── batch shell first (legacy_rows need its id); stats filled in at the end ────────
  const { data: batch, error: batchErr } = await supabaseAdmin
    .from('import_batches')
    .insert({ source_file: res.fileName, sheet_name: IMPORT_SHEET, event_hint: null, row_count: rows.length, stats: {}, created_by: me.id })
    .select('id')
    .single();
  if (batchErr || !batch) {
    console.error('[member-import] batch insert failed:', batchErr);
    return NextResponse.json({ error: '创建导入批次失败' }, { status: 500 });
  }

  // ── insert NEW members in batches; zip returned ids by order ───────────────────────
  const newRows = rows.filter((r) => r.cls === 'new');
  let inserted = 0;
  for (let i = 0; i < newRows.length; i += INSERT_BATCH) {
    const chunk = newRows.slice(i, i + INSERT_BATCH);
    const { data: created, error } = await supabaseAdmin
      .from('members')
      .insert(chunk.map((r) => ({ ...r.values!, import_batch_id: batch.id, created_by: me.id, updated_by: me.id })))
      .select('id');
    if (error || !created || created.length !== chunk.length) {
      // Batch failed (e.g. a unique race) — mark these rows as errors and keep going so
      // the batch record stays truthful; nothing in this chunk was inserted.
      console.error('[member-import] member insert chunk failed:', error);
      for (const r of chunk) {
        r.cls = 'error';
        r.issues.push(`写入失败：${error?.message ?? 'unknown'}`);
      }
      continue;
    }
    chunk.forEach((r, j) => {
      r.matchedMemberId = created[j].id as string;
      r.matchMethod = null; // created, not matched — recorded as 'created' in legacy_rows
    });
    inserted += chunk.length;
  }

  // ── every source row → legacy_rows (the permanent import trail) ────────────────────
  // match_method must be one of the DB CHECK vocabulary:
  //   phone | name_centre (how a DUPLICATE matched) · created_new (a NEW insert) ·
  //   skipped (REVIEW — ambiguous, left for a human) · error (validation failed).
  const legacy = rows.map((r: ImportRow) => ({
    batch_id: batch.id,
    row_no: r.rowNo,
    raw: r.raw,
    member_id: r.matchedMemberId,
    match_method:
      r.cls === 'duplicate' ? r.matchMethod
      : r.cls === 'new' ? 'created_new'
      : r.cls === 'review' ? 'skipped'
      : 'error',
    issues: r.issues,
  }));
  for (let i = 0; i < legacy.length; i += INSERT_BATCH) {
    const { error } = await supabaseAdmin.from('legacy_rows').insert(legacy.slice(i, i + INSERT_BATCH));
    if (error) {
      console.error('[member-import] legacy_rows insert failed:', error);
      return NextResponse.json({ error: '写入导入明细失败（会员已导入，请勿重复提交，联系管理员）' }, { status: 500 });
    }
  }

  const counts = tally(rows);
  const stats = { ...counts, inserted };
  await supabaseAdmin.from('import_batches').update({ stats }).eq('id', batch.id);

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'members',
    action: 'import',
    tableName: 'import_batches',
    recordId: batch.id as string,
    after: { source_file: res.fileName, row_count: rows.length, ...stats },
  });

  return NextResponse.json({
    batchId: batch.id,
    total: rows.length,
    inserted,
    skippedDuplicates: counts.duplicate,
    review: counts.review,
    errors: counts.error,
  });
}
