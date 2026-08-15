// src/app/api/dashboard/wisdom/[id]/route.ts
// 智库 entry mutations (P2 §1/§3). PATCH actions:
//   { action:'save', ...fields }  care ≥ edit  — update content. Editing an
//       APPROVED entry demotes it to draft AND deletes its Pinecone record
//       (the live corpus must never carry text that no admin approved);
//       re-approval re-upserts.
//   { action:'approve' }          care ADMIN   — status='approved' +
//       approved_by/at + Pinecone upsert (wisdom_{id}, type='canonical_ruling').
//   { action:'retire' }           care ADMIN   — status='retired' + Pinecone delete.
// Every action writes an audit row (module='care').
//
// Sync-ordering invariant: a Pinecone wisdom_ record may exist ONLY while its
// row is approved. Approve: upsert → status (failed status rolls the record
// back out). Retire/edit-of-approved: delete → status. Every partial-failure
// mode is a re-runnable action, never a ghost injection.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { upsertWisdomRecord, deleteWisdomRecord, type WisdomEntryForSync } from '@/lib/wisdom-sync';

export const runtime = 'nodejs';

const FIELD_MAX = { canonical_question: 500, variants: 1000, keywords: 500, answer_guidance: 8000 };
const LANGS = ['zh', 'en', 'id'];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireModuleAccess('care', 'edit');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const me = access.volunteer;
  const db = supabaseAdmin;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (action !== 'save' && action !== 'approve' && action !== 'retire') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const { data: entry, error: fetchError } = await db
    .from('wisdom_entries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    console.error('[dashboard/wisdom] fetch failed:', fetchError);
    return NextResponse.json({ error: 'Failed to load entry' }, { status: 500 });
  }
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ── save (care ≥ edit) ─────────────────────────────────────────────────────
  if (action === 'save') {
    const field = (key: keyof typeof FIELD_MAX, required: boolean): string | null => {
      const v = body?.[key];
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s) return required ? null : '';
      return s.slice(0, FIELD_MAX[key]);
    };
    const canonical_question = field('canonical_question', true);
    const answer_guidance = field('answer_guidance', true);
    if (!canonical_question || !answer_guidance) {
      return NextResponse.json({ error: '问题与回答指引为必填' }, { status: 400 });
    }
    const wasApproved = entry.status === 'approved';
    if (wasApproved) {
      // Pull the live record FIRST — the corpus must never carry unapproved text.
      try {
        await deleteWisdomRecord(id);
      } catch (e) {
        console.error('[dashboard/wisdom] pinecone delete on edit failed:', e);
        return NextResponse.json({ error: '同步失败，请重试' }, { status: 502 });
      }
    }
    const updates = {
      canonical_question,
      variants: field('variants', false) || null,
      keywords: field('keywords', false) || null,
      answer_guidance,
      language: LANGS.includes(body?.language as string) ? (body?.language as string) : entry.language,
      ...(wasApproved ? { status: 'draft', approved_by: null, approved_at: null } : {}),
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error: updateError } = await db
      .from('wisdom_entries')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (updateError || !updated) {
      console.error('[dashboard/wisdom] update failed:', updateError);
      return NextResponse.json({ error: '保存失败，请重试' }, { status: 500 });
    }
    await writeAudit({
      actorId: me.id,
      actorEmail: me.email,
      module: 'care',
      action: 'wisdom_updated',
      tableName: 'wisdom_entries',
      recordId: id,
      before: { status: entry.status, canonical_question: entry.canonical_question },
      after: { canonical_question, demoted_to_draft: wasApproved },
    });
    return NextResponse.json({ ok: true, entry: updated, demotedToDraft: wasApproved });
  }

  // ── approve / retire (care ADMIN only, enforced app-side per brief) ────────
  const adminAccess = await requireModuleAccess('care', 'admin');
  if (!adminAccess.ok) {
    return NextResponse.json({ error: '批准/退役需要 care 管理员权限' }, { status: 403 });
  }

  if (action === 'approve') {
    if (entry.status === 'approved') return NextResponse.json({ ok: true, entry });
    // Pinecone first: a failed upsert leaves the row draft/retired (re-runnable).
    try {
      await upsertWisdomRecord(entry as WisdomEntryForSync);
    } catch (e) {
      console.error('[dashboard/wisdom] pinecone upsert failed:', e);
      return NextResponse.json({ error: '同步到检索库失败，请重试' }, { status: 502 });
    }
    const { data: updated, error: updateError } = await db
      .from('wisdom_entries')
      .update({
        status: 'approved',
        approved_by: me.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (updateError || !updated) {
      // Roll the record back out so Pinecone never outruns the DB status.
      await deleteWisdomRecord(id).catch(() => {});
      console.error('[dashboard/wisdom] approve update failed:', updateError);
      return NextResponse.json({ error: '批准失败，请重试' }, { status: 500 });
    }
    await writeAudit({
      actorId: me.id,
      actorEmail: me.email,
      module: 'care',
      action: 'wisdom_approved',
      tableName: 'wisdom_entries',
      recordId: id,
      before: { status: entry.status },
      after: { status: 'approved', pinecone_id: `wisdom_${id}` },
    });
    return NextResponse.json({ ok: true, entry: updated });
  }

  // retire — Pinecone delete FIRST: the invariant is "a wisdom_ record exists
  // only for an approved row". A failed status flip afterwards just leaves an
  // approved row temporarily unserved (retry retire, or re-approve, fixes it).
  if (entry.status === 'retired') return NextResponse.json({ ok: true, entry });
  try {
    await deleteWisdomRecord(id);
  } catch (e) {
    console.error('[dashboard/wisdom] pinecone delete on retire failed:', e);
    return NextResponse.json({ error: '同步失败，请重试' }, { status: 502 });
  }
  const { data: retired, error: retireError } = await db
    .from('wisdom_entries')
    .update({ status: 'retired', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (retireError || !retired) {
    console.error('[dashboard/wisdom] retire update failed:', retireError);
    return NextResponse.json({ error: '退役失败，请重试' }, { status: 500 });
  }
  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'care',
    action: 'wisdom_retired',
    tableName: 'wisdom_entries',
    recordId: id,
    before: { status: entry.status },
    after: { status: 'retired' },
  });
  return NextResponse.json({ ok: true, entry: retired });
}
