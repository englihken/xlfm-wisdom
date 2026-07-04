// src/app/api/dashboard/reports/route.ts
// Admin-only reporting metrics for the 报表 module. GET ?range=7d|30d|all.
// Same two-layer gate as the other dashboard routes (active volunteer, then admin),
// then everything is read with the service-role client (supabaseAdmin). Data volumes
// are small, so we select minimal columns and aggregate in JS rather than pushing
// GROUP BY into Postgres.
//
// range applies to categories / crisisCount / totals (all = no time filter).
// stages is deliberately ALL-TIME (a contact's journey is cumulative, not windowed).
// volumeByDay shows a per-day series for the window, capped at 90 days for 'all'.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const JUNK_CATEGORY = '闲聊测试'; // the one "not real signal" category
const STAGES = ['初次接触', '学习中', '共修者', '义工'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

type Range = '7d' | '30d' | 'all';

type ConvRow = { created_at: string; category: string | null; crisis_flag: boolean };
type ContactRow = { stage: string | null; first_seen: string };

// Local-time day helpers for the volume series.
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function mmdd(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(req: Request) {
  // Layer 1: care module access (view), then Layer 2: must be an admin (care
  // reports stay Ken-only for now).
  const access = await requireModuleAccess('care', 'view');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (access.volunteer.role !== 'admin') {
    return NextResponse.json({ error: '仅限管理员' }, { status: 403 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  const rangeParam = new URL(req.url).searchParams.get('range');
  const range: Range = rangeParam === '7d' || rangeParam === 'all' ? rangeParam : '30d';

  // Time-window cutoff for the ranged metrics (null = all-time).
  const now = Date.now();
  const cutoffMs = range === '7d' ? now - 7 * DAY_MS : range === '30d' ? now - 30 * DAY_MS : null;
  const cutoffIso = cutoffMs != null ? new Date(cutoffMs).toISOString() : null;

  // Conversations in range (or all).
  let convQuery = supabaseAdmin
    .from('conversations')
    .select('created_at, category, crisis_flag');
  if (cutoffIso) convQuery = convQuery.gte('created_at', cutoffIso);
  const { data: convData, error: convError } = await convQuery;
  if (convError) {
    console.error('[dashboard] reports conversations query failed:', convError);
    return NextResponse.json({ error: 'Failed to load reports' }, { status: 500 });
  }
  const convRows = (convData ?? []) as ConvRow[];

  // Contacts — fetched all-time; stages ignore the range, totals.contacts filters
  // on first_seen in JS.
  const { data: contactData, error: contactError } = await supabaseAdmin
    .from('contacts')
    .select('stage, first_seen');
  if (contactError) {
    console.error('[dashboard] reports contacts query failed:', contactError);
    return NextResponse.json({ error: 'Failed to load reports' }, { status: 500 });
  }
  const contactRows = (contactData ?? []) as ContactRow[];

  // categories: count per non-null category, sorted by count desc. isJunk marks the
  // chit-chat/test bucket so the UI can separate real signal from noise.
  const catMap = new Map<string, number>();
  for (const c of convRows) {
    if (!c.category) continue;
    catMap.set(c.category, (catMap.get(c.category) ?? 0) + 1);
  }
  const categories = [...catMap.entries()]
    .map(([label, count]) => ({ label, count, isJunk: label === JUNK_CATEGORY }))
    .sort((a, b) => b.count - a.count);

  // crisisCount: crisis-flagged conversations in range.
  const crisisCount = convRows.reduce((n, c) => (c.crisis_flag ? n + 1 : n), 0);

  // stages: contacts per journey stage, all-time.
  const stageCounts = new Map<string, number>(STAGES.map((s) => [s, 0]));
  for (const ct of contactRows) {
    if (ct.stage && stageCounts.has(ct.stage)) {
      stageCounts.set(ct.stage, (stageCounts.get(ct.stage) ?? 0) + 1);
    }
  }
  const stages = STAGES.map((stage) => ({ stage, count: stageCounts.get(stage) ?? 0 }));

  // volumeByDay: one bucket per day across the window (7 / 30 / 90 days), oldest
  // first, zero-filled so the column chart has a continuous axis.
  const windowDays = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const perDay = new Map<string, number>();
  for (const c of convRows) {
    const k = dayKey(new Date(c.created_at));
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const volumeByDay: { date: string; count: number }[] = [];
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(midnight.getTime() - i * DAY_MS);
    volumeByDay.push({ date: mmdd(d), count: perDay.get(dayKey(d)) ?? 0 });
  }

  // totals: conversations in range; contacts first seen in range (all = everything).
  const contactsInRange =
    cutoffMs == null
      ? contactRows.length
      : contactRows.reduce(
          (n, ct) => (new Date(ct.first_seen).getTime() >= cutoffMs ? n + 1 : n),
          0
        );
  const totals = { conversations: convRows.length, contacts: contactsInRange };

  return NextResponse.json({ range, categories, crisisCount, stages, volumeByDay, totals });
}
