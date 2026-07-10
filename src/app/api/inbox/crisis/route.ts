// src/app/api/inbox/crisis/route.ts
// GET the national 危机 strip — crisis-flagged, non-archived threads (subject + centre + age).
// By governance design (E2 §1.4) this BYPASSES the centre wall: crisis is an open, immediate
// national escalation. Access: platform admin OR care ≥ edit (关怀组). Never message bodies.

import { NextResponse } from 'next/server';
import { getActiveVolunteer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { ACCESS_RANK, type AccessLevel } from '@/lib/access';
import { ageDays } from '@/lib/inbox';

export const runtime = 'nodejs';

export async function GET() {
  const active = await getActiveVolunteer();
  if (!active || !supabaseAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = supabaseAdmin;

  const { data: grants } = await db.from('role_grants').select('module, access').eq('role', active.volunteer.role).in('module', ['care', 'inbox']);
  let care: AccessLevel = 'none';
  let inbox: AccessLevel = 'none';
  for (const g of grants ?? []) {
    if (g.module === 'care') care = g.access as AccessLevel;
    if (g.module === 'inbox') inbox = g.access as AccessLevel;
  }
  const allowed = inbox === 'admin' || ACCESS_RANK[care] >= ACCESS_RANK['edit'];
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: threads } = await db
    .from('inbox_threads')
    .select('id, mailbox_id, subject, status, last_message_at, mailbox:inbox_mailboxes!mailbox_id ( centre:centres!centre_id ( name_cn ) )')
    .eq('crisis_flag', true)
    .neq('status', 'archived')
    .order('last_message_at', { ascending: false });

  const nowMs = Date.now();
  const out = (threads ?? []).map((t) => {
    const mb = Array.isArray(t.mailbox) ? t.mailbox[0] : t.mailbox;
    const centre = mb ? (Array.isArray(mb.centre) ? mb.centre[0] : mb.centre) : null;
    return {
      id: t.id as string,
      mailbox_id: t.mailbox_id as string,
      subject: t.subject as string,
      centre_name: (centre?.name_cn as string) ?? '—',
      age_days: ageDays(t.last_message_at as string, nowMs),
    };
  });

  return NextResponse.json({ threads: out, count: out.length });
}
