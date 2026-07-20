// src/app/api/dashboard/events/[id]/checkin/search/route.ts
// GET ?q= (events:view + hosting-centre wall) — roster search for the 签到 desk.
// Matches name / phone / reg_no over THIS event only, and carries each row's
// current check-in state so the desk can show 「已签到」 without a second call.
//
// Separate from the existing registrations list route on purpose: that one
// paginates the admin queue and knows nothing about attendance, and bolting a
// per-row attendance join onto it would slow the queue for everyone.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { eventsScope } from '@/lib/members-scope';
import { UUID_RE } from '@/lib/finance-cashbook';
import { normalizePhone } from '@/lib/members';
import { mayRunCheckin } from '@/lib/event-checkin';

export const runtime = 'nodejs';

const LIMIT = 25;

type Row = {
  id: string;
  reg_no: string;
  status: string;
  applicant_name: string | null;
  applicant_phone: string | null;
  member: { name_cn: string | null; phone: string | null; centre: { name_cn: string } | { name_cn: string }[] | null } | { name_cn: string | null; phone: string | null; centre: { name_cn: string } | { name_cn: string }[] | null }[] | null;
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
    .select('id, organizing_centre_id, co_centre_ids')
    .eq('id', id)
    .maybeSingle();
  if (evErr) {
    console.error('[checkin/search] event fetch failed:', evErr);
    return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
  }
  if (!ev || !mayRunCheckin(eventsScope(access.volunteer), ev)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const raw = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (raw.length < 2) return NextResponse.json({ results: [] });

  // The .or() grammar is not value-encoded, so strip its delimiters before
  // interpolating (house rule; same sanitize the registrations queue uses).
  const safe = raw.replace(/[,.()%*"\\]/g, ' ').trim();
  if (!safe) return NextResponse.json({ results: [] });

  const ors = [`reg_no.ilike.%${safe}%`, `applicant_name.ilike.%${safe}%`, `applicant_phone.ilike.%${safe}%`];
  // A typed phone may be in any local format; match its canonical form too.
  const norm = normalizePhone(safe);
  if (!norm.error && norm.phone) ors.push(`applicant_phone.ilike.%${norm.phone}%`);

  // Members are matched by name/phone in a separate pass — PostgREST cannot OR
  // across an embedded table and the base table in one filter.
  const { data: mem } = await supabaseAdmin
    .from('members')
    .select('id')
    .or(`name_cn.ilike.%${safe}%,name_en.ilike.%${safe}%,phone.ilike.%${norm.phone ?? safe}%`)
    .limit(200);
  const memberIds = (mem ?? []).map((m) => m.id as string).filter((x) => UUID_RE.test(x));
  if (memberIds.length) ors.push(`member_id.in.(${memberIds.join(',')})`);

  const { data, error } = await supabaseAdmin
    .from('registrations')
    .select('id, reg_no, status, applicant_name, applicant_phone, member:members!member_id ( name_cn, phone, centre:centres!gyt_centre_id ( name_cn ) )')
    .eq('event_id', id)
    .or(ors.join(','))
    .order('reg_no', { ascending: true })
    .limit(LIMIT);
  if (error) {
    console.error('[checkin/search] query failed:', error);
    return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Row[];
  // One batched attendance read for the whole page — never N+1 per row.
  const { data: atts } = rows.length
    ? await supabaseAdmin
        .from('event_attendance')
        .select('id, registration_id, checked_in_at')
        .eq('event_id', id)
        .is('voided_at', null)
        .in('registration_id', rows.map((r) => r.id))
    : { data: [] };
  const attByReg = new Map(
    ((atts ?? []) as { id: string; registration_id: string; checked_in_at: string }[]).map((a) => [a.registration_id, a])
  );

  const results = rows.map((r) => {
    const m = flat(r.member);
    const centre = m ? flat(m.centre) : null;
    const att = attByReg.get(r.id);
    return {
      registration_id: r.id,
      reg_no: r.reg_no,
      name: m?.name_cn || r.applicant_name || '',
      phone: m?.phone || r.applicant_phone || null,
      centre_name: centre?.name_cn ?? null,
      reg_status: r.status,
      checked_in: !!att,
      checked_in_at: att?.checked_in_at ?? null,
      attendance_id: att?.id ?? null,
    };
  });

  return NextResponse.json({ results });
}
