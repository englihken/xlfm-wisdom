// src/app/api/dashboard/events/[id]/checkin/route.ts
// POST (events:edit + hosting-centre wall) — check one person in at the desk.
//
// Accepts exactly ONE of:
//   { token }            — the attendee's QR payload      → method 'qr'
//   { registration_id }  — picked from the roster search  → method 'search'
//   { walkin: {...} }    — no registration at all         → method 'walkin'
//
// IDEMPOTENT BY DESIGN. Check-in happens once per event (first arrival), so a
// re-scan is a normal event, not an error: the route returns the EXISTING row
// with already:true and a soft 「已签到」 for the desk. Two guards, because a
// pre-check alone loses the race when two desks scan the same person at once:
//   1. a pre-check select (the common path, one round trip)
//   2. the partial unique index event_attendance_reg_uniq → 23505 → re-select
// Walk-ins are deliberately NOT deduped: the DB cannot identify them, and two
// people at a door may genuinely share a name.
//
// Check-in never BLOCKS on registration status. Someone standing at the desk is
// present whatever the roster says; the response carries reg_status so the UI can
// show an amber note for a non-approved row instead of turning them away.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { eventsScope } from '@/lib/members-scope';
import { todayMYT } from '@/lib/events';
import { UUID_RE } from '@/lib/finance-cashbook';
import { normalizePhone } from '@/lib/members';
import { CHECKIN_TOKEN_RE, mayRunCheckin, PG_UNIQUE_VIOLATION, validWalkinName } from '@/lib/event-checkin';

export const runtime = 'nodejs';

const ATT_SELECT =
  'id, event_id, registration_id, member_id, attend_date, checked_in_at, checked_in_by, method, centre_id, walkin_name, walkin_phone, voided_at';

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

type RegRow = {
  id: string;
  reg_no: string;
  status: string;
  event_id: string;
  member_id: string | null;
  applicant_name: string | null;
  member: { name_cn: string | null; gyt_centre_id: string | null } | { name_cn: string | null; gyt_centre_id: string | null }[] | null;
};
const flat = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

// What the desk card shows: who this is, which centre, and their roster state.
function personOf(reg: RegRow) {
  const m = flat(reg.member);
  return {
    reg_no: reg.reg_no,
    name: m?.name_cn || reg.applicant_name || '',
    centre_id: m?.gyt_centre_id ?? null,
    reg_status: reg.status,
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireModuleAccess('events', 'edit');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ── the wall: this event, this caller's centre ────────────────────────────
  const { data: ev, error: evErr } = await supabaseAdmin
    .from('events')
    .select('id, organizing_centre_id, co_centre_ids')
    .eq('id', id)
    .maybeSingle();
  if (evErr) {
    console.error('[checkin] event fetch failed:', evErr);
    return NextResponse.json({ error: 'Failed to check in' }, { status: 500 });
  }
  // Cross-wall reads the SAME as an unknown event — no existence oracle.
  if (!ev || !mayRunCheckin(eventsScope(access.volunteer), ev)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const me = access.volunteer;
  const attendDate = todayMYT();
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const regId = typeof body.registration_id === 'string' ? body.registration_id.trim() : '';
  const walkin = body.walkin && typeof body.walkin === 'object' ? (body.walkin as Record<string, unknown>) : null;

  const given = [token ? 1 : 0, regId ? 1 : 0, walkin ? 1 : 0].reduce((a, b) => a + b, 0);
  if (given !== 1) return NextResponse.json({ error: '请提供扫码、报名或新增其中一种' }, { status: 400 });

  // ── walk-in: no registration, so no dedupe and no unique index ─────────────
  if (walkin) {
    if (!validWalkinName(walkin.name)) return NextResponse.json({ error: '请填写姓名' }, { status: 400 });
    const name = String(walkin.name).trim();

    let phone: string | null = null;
    if (typeof walkin.phone === 'string' && walkin.phone.trim()) {
      const norm = normalizePhone(walkin.phone);
      if (norm.error || !norm.phone) return NextResponse.json({ error: '电话格式无效' }, { status: 400 });
      phone = norm.phone;
    }

    let centreId: string | null = null;
    if (typeof walkin.centre_id === 'string' && walkin.centre_id.trim()) {
      if (!UUID_RE.test(walkin.centre_id)) return NextResponse.json({ error: '共修会无效' }, { status: 400 });
      centreId = walkin.centre_id;
    }

    // A walk-in who turns out to be a known member gets linked, so their
    // attendance still lands on their record. Phone is the only handle we have.
    let memberId: string | null = null;
    if (phone) {
      const { data: m } = await supabaseAdmin
        .from('members')
        .select('id, gyt_centre_id')
        .eq('phone', phone)
        .limit(1)
        .maybeSingle();
      if (m) {
        memberId = m.id as string;
        centreId = centreId ?? ((m.gyt_centre_id as string | null) ?? null);
      }
    }

    const { data: row, error } = await supabaseAdmin
      .from('event_attendance')
      .insert({
        event_id: id,
        registration_id: null,
        member_id: memberId,
        attend_date: attendDate,
        checked_in_by: me.id,
        method: 'walkin',
        centre_id: centreId,
        walkin_name: name,
        walkin_phone: phone,
      })
      .select(ATT_SELECT)
      .single();
    if (error || !row) {
      console.error('[checkin] walkin insert failed:', error);
      return NextResponse.json({ error: '签到失败，请重试' }, { status: 500 });
    }

    await writeAudit({
      actorId: me.id,
      actorEmail: me.email,
      module: 'events',
      action: 'reg.check_in',
      tableName: 'event_attendance',
      recordId: row.id as string,
      after: { event_id: id, method: 'walkin', walkin_name: name, member_id: memberId, centre_id: centreId, attend_date: attendDate },
    });

    return NextResponse.json(
      { already: false, attendance: row, person: { reg_no: null, name, centre_id: centreId, reg_status: null } },
      { status: 201 }
    );
  }

  // ── qr / search: resolve the registration, then check it belongs HERE ──────
  const method = token ? 'qr' : 'search';
  if (token && !CHECKIN_TOKEN_RE.test(token)) return NextResponse.json({ error: '二维码无效' }, { status: 400 });
  if (regId && !UUID_RE.test(regId)) return NextResponse.json({ error: '报名记录无效' }, { status: 400 });

  const regQ = supabaseAdmin
    .from('registrations')
    .select('id, reg_no, status, event_id, member_id, applicant_name, member:members!member_id ( name_cn, gyt_centre_id )');
  const { data: regRaw, error: regErr } = await (token ? regQ.eq('checkin_token', token) : regQ.eq('id', regId)).maybeSingle();
  if (regErr) {
    console.error('[checkin] registration lookup failed:', regErr);
    return NextResponse.json({ error: 'Failed to check in' }, { status: 500 });
  }
  const reg = regRaw as unknown as RegRow | null;
  // A token from ANOTHER event must not check in here — the desk is per-event.
  if (!reg || reg.event_id !== id) return NextResponse.json({ error: '此二维码不属于本活动' }, { status: 404 });

  const person = personOf(reg);

  // 1. pre-check — the common repeat-scan path, one round trip
  const { data: existing } = await supabaseAdmin
    .from('event_attendance')
    .select(ATT_SELECT)
    .eq('event_id', id)
    .eq('registration_id', reg.id)
    .is('voided_at', null)
    .maybeSingle();
  if (existing) return NextResponse.json({ already: true, attendance: existing, person });

  const { data: row, error } = await supabaseAdmin
    .from('event_attendance')
    .insert({
      event_id: id,
      registration_id: reg.id,
      member_id: reg.member_id,
      attend_date: attendDate,
      checked_in_by: me.id,
      method,
      centre_id: person.centre_id,
    })
    .select(ATT_SELECT)
    .single();

  if (error) {
    // 2. the race: another desk inserted between our pre-check and this insert.
    // The index did its job — report the winner's row as "already", not an error.
    if (error.code === PG_UNIQUE_VIOLATION) {
      const { data: winner } = await supabaseAdmin
        .from('event_attendance')
        .select(ATT_SELECT)
        .eq('event_id', id)
        .eq('registration_id', reg.id)
        .is('voided_at', null)
        .maybeSingle();
      if (winner) return NextResponse.json({ already: true, attendance: winner, person });
    }
    console.error('[checkin] insert failed:', error);
    return NextResponse.json({ error: '签到失败，请重试' }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: '签到失败，请重试' }, { status: 500 });

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'events',
    action: 'reg.check_in',
    tableName: 'event_attendance',
    recordId: row.id as string,
    after: { event_id: id, registration_id: reg.id, reg_no: reg.reg_no, member_id: reg.member_id, method, centre_id: person.centre_id, attend_date: attendDate },
  });

  return NextResponse.json({ already: false, attendance: row, person }, { status: 201 });
}
