// src/app/api/inbox/health/route.ts
// GET the HQ health board (summary roles) / admin overview. Counts + oldest-age + crisis
// per enabled mailbox, and the sanctioned >surface_hq_days SURFACED list (subject + age only —
// the one governance-approved exception where HQ sees a subject, E2 §1.3 / §5.2). NEVER any
// message body. Access: admin or summary (erp_admin / committee).

import { NextResponse } from 'next/server';
import { resolveInbox, ownersByMailbox, loadEscalation } from '@/lib/inbox-server';
import { ageDays, overdueLevel } from '@/lib/inbox';

export const runtime = 'nodejs';

export async function GET() {
  const r = await resolveInbox();
  if (!r.ok) return r.res;
  const { db, access } = r;
  if (access.level !== 'admin' && access.level !== 'summary') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [{ data: mbs }, esc] = await Promise.all([
    db.from('inbox_mailboxes').select('id, centre_id, centre:centres!centre_id ( name_cn, sort )').eq('is_enabled', true),
    loadEscalation(db),
  ]);
  const mailboxes = mbs ?? [];
  const ids = mailboxes.map((m) => m.id as string);
  const owners = await ownersByMailbox(db, ids);

  const { data: threads } = ids.length
    ? await db.from('inbox_threads').select('id, mailbox_id, subject, status, crisis_flag, last_message_at').in('mailbox_id', ids)
    : { data: [] as Record<string, unknown>[] };

  const nowMs = Date.now();
  const agg = new Map<string, { new_n: number; crisis_n: number; oldest: number; surfaced: { id: string; subject: string; age_days: number }[] }>();
  ids.forEach((id) => agg.set(id, { new_n: 0, crisis_n: 0, oldest: 0, surfaced: [] }));

  for (const t of threads ?? []) {
    const a = agg.get(t.mailbox_id as string);
    if (!a) continue;
    const status = t.status as string;
    const age = ageDays(t.last_message_at as string, nowMs);
    if (status === 'new') a.new_n++;
    if (t.crisis_flag && status !== 'archived') a.crisis_n++;
    if (status === 'new' || status === 'in_progress') {
      if (age > a.oldest) a.oldest = age;
      if (overdueLevel(status, age, esc) === 'surface') {
        a.surfaced.push({ id: t.id as string, subject: t.subject as string, age_days: age });
      }
    }
  }

  const board = mailboxes
    .map((m) => {
      const a = agg.get(m.id as string)!;
      const c = Array.isArray(m.centre) ? m.centre[0] : m.centre;
      return {
        mailbox_id: m.id as string,
        centre_id: m.centre_id as string,
        centre_name: (c?.name_cn as string) ?? '—',
        centre_sort: (c?.sort as number) ?? 0,
        owners: owners.get(m.id as string) ?? [],
        new_n: a.new_n,
        oldest_unhandled_days: a.oldest,
        crisis_n: a.crisis_n,
        surfaced: a.surfaced.sort((x, y) => y.age_days - x.age_days),
      };
    })
    .sort((x, y) => y.new_n - x.new_n || y.oldest_unhandled_days - x.oldest_unhandled_days || x.centre_sort - y.centre_sort);

  return NextResponse.json({ level: access.level, escalation: esc, board });
}
