// src/app/api/dashboard/outreach/summary/route.ts
// GET (outreach:view) — the 4 plain header numbers for the workbench (NO charts):
//   本月新结缘      — first_contact milestones with happened_on in the current month
//   本月开始念经    — started_chanting milestones this month
//   名单总数        — total contacts on the 善缘名单
//   超过30天没动静  — contacts whose latest activity (max milestone date, else last_seen) is
//                     older than 30 days — the queue's conscience.
// Two reads folded in memory (no per-contact N+1).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const access = await requireModuleAccess('outreach', 'view');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const now = new Date();
  const monthStart = now.toISOString().slice(0, 8) + '01';
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [{ data: contacts, error: cErr }, { data: milestones, error: mErr }] = await Promise.all([
    supabaseAdmin.from('contacts').select('id, last_seen'),
    supabaseAdmin.from('contact_milestones').select('contact_id, milestone, happened_on'),
  ]);
  if (cErr || mErr) {
    console.error('[outreach/summary] load failed:', cErr ?? mErr);
    return NextResponse.json({ error: 'Failed to load summary' }, { status: 500 });
  }

  let newThisMonth = 0;
  let chantingThisMonth = 0;
  const latestByContact = new Map<string, string>();
  for (const m of (milestones ?? []) as { contact_id: string; milestone: string; happened_on: string }[]) {
    if (m.milestone === 'first_contact' && m.happened_on >= monthStart) newThisMonth += 1;
    if (m.milestone === 'started_chanting' && m.happened_on >= monthStart) chantingThisMonth += 1;
    const cur = latestByContact.get(m.contact_id);
    if (!cur || m.happened_on > cur) latestByContact.set(m.contact_id, m.happened_on);
  }

  let stale = 0;
  for (const c of (contacts ?? []) as { id: string; last_seen: string }[]) {
    const lastMilestone = latestByContact.get(c.id);
    const lastSeenDate = (c.last_seen ?? '').slice(0, 10);
    const latest = lastMilestone && lastMilestone > lastSeenDate ? lastMilestone : lastSeenDate;
    if (latest && latest < cutoff) stale += 1;
  }

  return NextResponse.json({
    newThisMonth,
    chantingThisMonth,
    total: (contacts ?? []).length,
    stale,
  });
}
