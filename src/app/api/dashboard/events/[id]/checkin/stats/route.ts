// src/app/api/dashboard/events/[id]/checkin/stats/route.ts
// GET (events:view + hosting-centre wall) — the desk header numbers, polled ~15s:
//   total checked in · total registrations · per-centre chips · recent check-ins.
// Voided rows are excluded everywhere (that is what a void is FOR).
// Gate is 'view', not 'edit': a 组长 watching the door count should not need write
// access. Only the mutations require edit.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { eventsScope } from '@/lib/members-scope';
import { UUID_RE } from '@/lib/finance-cashbook';
import { mayRunCheckin } from '@/lib/event-checkin';

export const runtime = 'nodejs';

const RECENT_LIMIT = 12;

type AttRow = {
  id: string;
  centre_id: string | null;
  method: string;
  checked_in_at: string;
  walkin_name: string | null;
  registration: { reg_no: string; applicant_name: string | null; member: { name_cn: string | null } | { name_cn: string | null }[] | null } | null;
  checker: { display_name: string | null; email: string } | { display_name: string | null; email: string }[] | null;
};
const flat = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireModuleAccess('events', 'view');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: ev, error: evErr } = await supabaseAdmin
    .from('events')
    .select('id, title, code, organizing_centre_id, co_centre_ids')
    .eq('id', id)
    .maybeSingle();
  if (evErr) {
    console.error('[checkin/stats] event fetch failed:', evErr);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
  if (!ev || !mayRunCheckin(eventsScope(access.volunteer), ev)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [{ count: regTotal }, { data: attRaw, error: attErr }, { data: centres }] = await Promise.all([
    supabaseAdmin.from('registrations').select('id', { count: 'exact', head: true }).eq('event_id', id),
    supabaseAdmin
      .from('event_attendance')
      .select(
        'id, centre_id, method, checked_in_at, walkin_name, ' +
          'registration:registrations!registration_id ( reg_no, applicant_name, member:members!member_id ( name_cn ) ), ' +
          'checker:volunteers!checked_in_by ( display_name, email )'
      )
      .eq('event_id', id)
      .is('voided_at', null)
      .order('checked_in_at', { ascending: false })
      .limit(5000),
    supabaseAdmin.from('centres').select('id, code, name_cn').eq('is_active', true),
  ]);

  if (attErr) {
    console.error('[checkin/stats] attendance fetch failed:', attErr);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }

  const rows = (attRaw ?? []) as unknown as AttRow[];
  const centreName = new Map((centres ?? []).map((c) => [c.id as string, (c.name_cn as string) ?? (c.code as string)]));

  const byCentre = new Map<string, number>();
  for (const r of rows) {
    const key = r.centre_id ?? '__none';
    byCentre.set(key, (byCentre.get(key) ?? 0) + 1);
  }
  // Biggest first; the unattributed bucket (walk-ins, non-member registrants)
  // sorts with the rest but carries a null id so the UI can label it 其他.
  const perCentre = [...byCentre.entries()]
    .map(([key, count]) => ({
      centre_id: key === '__none' ? null : key,
      name: key === '__none' ? null : centreName.get(key) ?? null,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const recent = rows.slice(0, RECENT_LIMIT).map((r) => {
    const reg = flat(r.registration);
    const m = reg ? flat(reg.member) : null;
    const by = flat(r.checker);
    return {
      id: r.id,
      name: m?.name_cn || reg?.applicant_name || r.walkin_name || '',
      reg_no: reg?.reg_no ?? null,
      method: r.method,
      checked_in_at: r.checked_in_at,
      centre_name: r.centre_id ? centreName.get(r.centre_id) ?? null : null,
      checked_in_by: by?.display_name || by?.email || '',
    };
  });

  return NextResponse.json({
    event: { id: ev.id, title: ev.title, code: ev.code },
    checkedIn: rows.length,
    regTotal: regTotal ?? 0,
    perCentre,
    recent,
    // The walk-in form's centre dropdown rides along here on purpose: the
    // standalone /api/dashboard/centres route requires settings:edit, which a
    // desk volunteer has no reason to hold. This route already read centres.
    centres: (centres ?? []).map((c) => ({ id: c.id, code: c.code, name_cn: c.name_cn })),
  });
}
