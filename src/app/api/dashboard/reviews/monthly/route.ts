// src/app/api/dashboard/reviews/monthly/route.ts
// GET ?month=YYYY-MM — 月度回顾 aggregates for the 智慧问答 module (P1 §1.6):
// volume · category mix · top question_key clusters · needs_improvement rate ·
// emotional_weight=heavy count · unanswered count · deltas vs previous month.
// Month boundaries are MYT. Access: care ≥ view.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const MYT_OFFSET_MS = 8 * 3600_000;

function monthWindowUtc(month: string): { start: string; end: string } | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return {
    start: new Date(Date.UTC(y, mo - 1, 1) - MYT_OFFSET_MS).toISOString(),
    end: new Date(Date.UTC(y, mo, 1) - MYT_OFFSET_MS).toISOString(),
  };
}

function prevMonth(month: string): string {
  const [y, mo] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

type Db = NonNullable<typeof supabaseAdmin>;

// PostgREST .in() rides the URL — chunk large id lists to stay under limits.
async function chunkedIn<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => Promise<T[]>
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    out.push(...(await fetchChunk(ids.slice(i, i + 150))));
  }
  return out;
}

interface MonthStats {
  volume: number;
  categories: Record<string, number>;
  topQuestionKeys: { key: string; count: number }[];
  reviewedCount: number;
  needsImprovementCount: number;
  needsImprovementRate: number | null; // null when nothing reviewed
  heavyCount: number;
  unansweredCount: number;
}

async function computeMonth(db: Db, start: string, end: string): Promise<MonthStats> {
  const { data: convs } = await db
    .from('conversations')
    .select('id, category')
    .gte('created_at', start)
    .lt('created_at', end);
  const convRows = (convs ?? []) as { id: string; category: string | null }[];
  const ids = convRows.map((c) => c.id);

  const categories: Record<string, number> = {};
  for (const c of convRows) {
    const key = c.category ?? '未分类';
    categories[key] = (categories[key] ?? 0) + 1;
  }

  type ReviewLite = { verdict: string; emotional_weight: string; question_key: string | null };
  const reviews = ids.length
    ? await chunkedIn<ReviewLite>(ids, async (chunk) => {
        const { data } = await db
          .from('conversation_reviews')
          .select('verdict, emotional_weight, question_key')
          .in('conversation_id', chunk);
        return (data ?? []) as ReviewLite[];
      })
    : [];

  const keyCounts = new Map<string, number>();
  let ni = 0;
  let heavy = 0;
  for (const r of reviews) {
    if (r.verdict === 'needs_improvement') ni++;
    if (r.emotional_weight === 'heavy') heavy++;
    if (r.question_key) keyCounts.set(r.question_key, (keyCounts.get(r.question_key) ?? 0) + 1);
  }
  const topQuestionKeys = [...keyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([key, count]) => ({ key, count }));

  // Unanswered: ≥1 user message, no assistant AND no volunteer reply.
  type MsgLite = { conversation_id: string; role: string };
  const msgs = ids.length
    ? await chunkedIn<MsgLite>(ids, async (chunk) => {
        const { data } = await db
          .from('messages')
          .select('conversation_id, role')
          .in('conversation_id', chunk);
        return (data ?? []) as MsgLite[];
      })
    : [];
  const hasUser = new Set<string>();
  const hasReply = new Set<string>();
  for (const m of msgs) {
    if (m.role === 'user') hasUser.add(m.conversation_id);
    else if (m.role === 'assistant' || m.role === 'volunteer') hasReply.add(m.conversation_id);
  }
  let unanswered = 0;
  for (const id of ids) if (hasUser.has(id) && !hasReply.has(id)) unanswered++;

  return {
    volume: convRows.length,
    categories,
    topQuestionKeys,
    reviewedCount: reviews.length,
    needsImprovementCount: ni,
    needsImprovementRate: reviews.length > 0 ? ni / reviews.length : null,
    heavyCount: heavy,
    unansweredCount: unanswered,
  };
}

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

  const url = new URL(req.url);
  const nowMyt = new Date(Date.now() + MYT_OFFSET_MS);
  const defaultMonth = `${nowMyt.getUTCFullYear()}-${String(nowMyt.getUTCMonth() + 1).padStart(2, '0')}`;
  const month = url.searchParams.get('month') ?? defaultMonth;
  const window = monthWindowUtc(month);
  if (!window) return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
  const prev = prevMonth(month);
  const prevWindow = monthWindowUtc(prev)!;

  const [current, previous] = await Promise.all([
    computeMonth(supabaseAdmin, window.start, window.end),
    computeMonth(supabaseAdmin, prevWindow.start, prevWindow.end),
  ]);

  return NextResponse.json({
    month,
    prevMonth: prev,
    current,
    previous: {
      volume: previous.volume,
      needsImprovementRate: previous.needsImprovementRate,
      heavyCount: previous.heavyCount,
      unansweredCount: previous.unansweredCount,
      reviewedCount: previous.reviewedCount,
    },
  });
}
