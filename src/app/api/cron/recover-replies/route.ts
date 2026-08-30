// src/app/api/cron/recover-replies/route.ts
// Dead-letter worker endpoint (brief "别再把访客弄丢" §3). Vercel Hobby allows
// only the two daily crons already declared in vercel.json, so this route is
// NOT in vercel.json — point an external pinger (cron-job.org, UptimeRobot,
// GitHub Actions schedule …) at it every 5 minutes with
//   Authorization: Bearer $CRON_SECRET
// Without a pinger, recovery still runs event-driven: the visitor's own
// /api/chat/updates poll, every /api/chat request, and the daily review cron.
//
//   GET /api/cron/recover-replies            → retry due failed replies
//   GET /api/cron/recover-replies?health=1   → also run the Anthropic canary/balance check

import { NextResponse } from 'next/server';
import { processFailedReplies } from '@/lib/reply-recovery';
import { checkAnthropicHealth } from '@/lib/ops-alerts';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const withHealth = url.searchParams.get('health') === '1';

  const recovery = await processFailedReplies({ limit: 10, budgetMs: 240_000 });
  const health = withHealth ? await checkAnthropicHealth() : undefined;
  const summary = { recovery, health };
  console.log('[cron/recover-replies]', JSON.stringify(summary));
  return NextResponse.json(summary);
}
