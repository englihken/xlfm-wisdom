// src/app/api/cron/refresh-chips/route.ts
// Regenerate the cached homepage chip answers (brief 09-10 §2, migration 046).
// Vercel Hobby allows only the two daily crons in vercel.json, so this route is
// NOT declared there: the nightly /api/cron/review calls refreshChipAnswers()
// first thing, and this endpoint exists for an external pinger / a manual
// warm-up after a deploy:
//   GET /api/cron/refresh-chips            → regenerate stale entries (>20h)
//   GET /api/cron/refresh-chips?force=1    → regenerate all 18
//   Authorization: Bearer $CRON_SECRET

import { NextResponse } from 'next/server';
import { refreshChipAnswers } from '@/lib/chip-answers';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const force = new URL(req.url).searchParams.get('force') === '1';
  const run = await refreshChipAnswers({ force, budgetMs: 270_000, concurrency: 6 });
  console.log('[cron/refresh-chips]', JSON.stringify(run));
  return NextResponse.json(run);
}
