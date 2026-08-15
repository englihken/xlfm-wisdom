// src/app/api/dashboard/wisdom/route.ts
// 智库 (wisdom_entries, migration 044) — list + create (P2 §1/§2).
//
// GET  ?status=draft|approved|retired|all  → { items, counts }   (care ≥ view)
// POST { canonical_question, answer_guidance, variants?, keywords?, language?,
//        sourceConversationId?, sourceReviewId? }                 (care ≥ edit)
//   New entries are always status='draft' (approval is a separate, care-admin
//   action on the [id] route — that is what triggers the Pinecone sync).
//   When sourceReviewId is present (起草 from the 复盘队列), the review row is
//   flipped to status='drafted' in the same request.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const LIST_LIMIT = 300;
const FIELD_MAX = { canonical_question: 500, variants: 1000, keywords: 500, answer_guidance: 8000 };
const LANGS = ['zh', 'en', 'id'];

export async function GET(req: Request) {
  const access = await requireModuleAccess('care', 'view');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const db = supabaseAdmin;

  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'all';

  const [countsRes, listRes] = await Promise.all([
    db.from('wisdom_entries').select('status'),
    (() => {
      let q = db
        .from('wisdom_entries')
        .select(
          'id, canonical_question, variants, keywords, answer_guidance, language, status, source_conversation_id, source_review_id, approved_at, use_count, created_at, updated_at'
        )
        .order('updated_at', { ascending: false })
        .limit(LIST_LIMIT);
      if (status !== 'all') q = q.eq('status', status);
      return q;
    })(),
  ]);

  if (listRes.error) {
    console.error('[dashboard/wisdom] list failed:', listRes.error);
    return NextResponse.json({ error: 'Failed to load entries' }, { status: 500 });
  }
  const counts = { draft: 0, approved: 0, retired: 0 };
  for (const r of countsRes.data ?? []) {
    const s = r.status as keyof typeof counts;
    if (s in counts) counts[s]++;
  }
  return NextResponse.json({ items: listRes.data ?? [], counts });
}

export async function POST(req: Request) {
  const access = await requireModuleAccess('care', 'edit');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const me = access.volunteer;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const field = (key: keyof typeof FIELD_MAX, required: boolean): string | null => {
    const v = body[key];
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) return required ? null : '';
    return s.slice(0, FIELD_MAX[key]);
  };
  const canonical_question = field('canonical_question', true);
  const answer_guidance = field('answer_guidance', true);
  if (!canonical_question || !answer_guidance) {
    return NextResponse.json({ error: '问题与回答指引为必填' }, { status: 400 });
  }
  const language = LANGS.includes(body.language as string) ? (body.language as string) : 'zh';
  const sourceConversationId =
    typeof body.sourceConversationId === 'string' ? body.sourceConversationId : null;
  const sourceReviewId = typeof body.sourceReviewId === 'string' ? body.sourceReviewId : null;

  const { data: entry, error: insertError } = await supabaseAdmin
    .from('wisdom_entries')
    .insert({
      canonical_question,
      variants: field('variants', false) || null,
      keywords: field('keywords', false) || null,
      answer_guidance,
      language,
      source_conversation_id: sourceConversationId,
      source_review_id: sourceReviewId,
      created_by: me.id,
    })
    .select('*')
    .single();
  if (insertError || !entry) {
    console.error('[dashboard/wisdom] insert failed:', insertError);
    return NextResponse.json({ error: '保存失败，请重试' }, { status: 500 });
  }

  // 起草 from the 复盘队列: the review moves to the reserved 'drafted' status.
  let reviewDrafted = false;
  if (sourceReviewId) {
    const { data: flipped } = await supabaseAdmin
      .from('conversation_reviews')
      .update({ status: 'drafted' })
      .eq('id', sourceReviewId)
      .eq('status', 'open')
      .select('id')
      .maybeSingle();
    reviewDrafted = Boolean(flipped);
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'care',
    action: 'wisdom_created',
    tableName: 'wisdom_entries',
    recordId: entry.id as string,
    after: {
      canonical_question,
      language,
      source_review_id: sourceReviewId,
      review_drafted: reviewDrafted,
    },
  });

  return NextResponse.json({ ok: true, entry, reviewDrafted });
}
