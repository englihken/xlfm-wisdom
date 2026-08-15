// src/app/api/dashboard/reviews/route.ts
// GET — the 复盘队列 list + the badge/alarm counts (P1 §1.5, §1.3 banner).
//
// Query params:
//   status   default 'open'   (open | dismissed | handled | all)
//   verdict  default 'needs_improvement' (good | ok | needs_improvement | all)
//   meta=1   counts only (open-badge + unanswered alarm) — cheap poll for banners
//
// Access: care ≥ view (matches the table's SELECT RLS policy; queries run via
// the service client after the route-level gate, same pattern as the rest of
// the dashboard care APIs).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { mytDayWindows, countUnanswered } from '@/lib/care-review';

export const runtime = 'nodejs';

const LIST_LIMIT = 200;

export async function GET(req: Request) {
  const access = await requireModuleAccess('care', 'view');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }
  const db = supabaseAdmin;
  const url = new URL(req.url);

  // Counts: open needs_improvement badge + the unanswered alarm (computed live,
  // so the banner clears on its own when a new MYT day starts clean).
  const windows = mytDayWindows(Date.now());
  const [openCountRes, unansweredYesterday, unansweredToday] = await Promise.all([
    db
      .from('conversation_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('verdict', 'needs_improvement')
      .eq('status', 'open'),
    countUnanswered(db, windows.yesterday.start, windows.yesterday.end),
    countUnanswered(db, windows.today.start, windows.today.end),
  ]);
  const counts = {
    openCount: openCountRes.count ?? 0,
    unansweredYesterday,
    unansweredToday,
  };

  if (url.searchParams.get('meta') === '1') {
    return NextResponse.json(counts);
  }

  const status = url.searchParams.get('status') ?? 'open';
  const verdict = url.searchParams.get('verdict') ?? 'needs_improvement';

  let query = db
    .from('conversation_reviews')
    .select(
      `id, conversation_id, verdict, reason, improvement_hint, question_key,
       emotional_weight, model, reviewed_at, status, dismissed_reason, handled_by, handled_at,
       conversation:conversations!conversation_id ( id, category, created_at, last_message_at )`
    )
    .order('reviewed_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (status !== 'all') query = query.eq('status', status);
  if (verdict !== 'all') query = query.eq('verdict', verdict);

  const { data, error } = await query;
  if (error) {
    console.error('[dashboard/reviews] list failed:', error);
    return NextResponse.json({ error: 'Failed to load reviews' }, { status: 500 });
  }

  type ConvLite = { id: string; category: string | null; created_at: string; last_message_at: string };
  const items = (data ?? []).map((r) => {
    const rawConv = (r as { conversation: ConvLite | ConvLite[] | null }).conversation;
    const conv = Array.isArray(rawConv) ? rawConv[0] ?? null : rawConv;
    return {
      id: r.id,
      conversationId: r.conversation_id,
      verdict: r.verdict,
      reason: r.reason,
      improvementHint: r.improvement_hint,
      questionKey: r.question_key,
      emotionalWeight: r.emotional_weight,
      reviewedAt: r.reviewed_at,
      status: r.status,
      dismissedReason: r.dismissed_reason,
      handledAt: r.handled_at,
      category: conv?.category ?? null,
      conversationDate: conv?.created_at ?? null,
    };
  });

  return NextResponse.json({ items, ...counts });
}
