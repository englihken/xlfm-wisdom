// src/app/api/dashboard/events/route.ts
// GET  — paginated, filtered events list (events:view). Each row carries its
//        organizing centre, registration counts by status, and a team-needs summary
//        (needed vs approved-with-that-team). Batched queries, no N+1.
// POST  — create an event with its enabled fees + team needs (events:edit). Server
//        generates the XLFM-YYMM code, forces status 'draft', and audits the create.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { EVENT_TYPES, isValidDate, validateFees, validateNeeds, yymm } from '@/lib/events';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

type CentreLite = { code: string; name_cn: string };
type EventRow = {
  id: string;
  code: string;
  title: string;
  event_type: string;
  status: string;
  starts_on: string;
  ends_on: string | null;
  location: string | null;
  capacity: number | null;
  reg_deadline: string | null;
  requires_approval: boolean;
  organizing_centre_id: string;
  organizing_centre: CentreLite | CentreLite[] | null;
};

function gate401or403(status: 401 | 403) {
  return NextResponse.json(
    { error: status === 401 ? 'Unauthorized' : 'Forbidden' },
    { status }
  );
}

export async function GET(req: Request) {
  const access = await requireModuleAccess('events', 'view');
  if (!access.ok) return gate401or403(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(sp.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = supabaseAdmin
    .from('events')
    .select(
      'id, code, title, event_type, status, starts_on, ends_on, location, capacity, reg_deadline, requires_approval, organizing_centre_id, organizing_centre:centres!organizing_centre_id ( code, name_cn )',
      { count: 'exact' }
    );

  const status = sp.get('status');
  const centre = sp.get('centre');
  const type = sp.get('type');
  const search = (sp.get('search') ?? '').trim();
  if (status) q = q.eq('status', status);
  if (centre) q = q.eq('organizing_centre_id', centre);
  if (type) q = q.eq('event_type', type);
  if (search) {
    const safe = search.replace(/[,.()%*"\\]/g, ' ').trim();
    if (safe) q = q.or(`title.ilike.%${safe}%,code.ilike.%${safe}%`);
  }

  q = q.order('starts_on', { ascending: false }).range(from, to);

  const { data, count, error } = await q;
  if (error) {
    console.error('[events] list query failed:', error);
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 });
  }
  const rows = (data ?? []) as unknown as EventRow[];
  const ids = rows.map((r) => r.id);

  // Batched: registration rows (status + team) + team needs for the whole page.
  const regCounts = new Map<string, Record<string, number>>();
  const approvedTeam = new Map<string, Map<string, number>>(); // event → team → approved count
  const needs = new Map<string, { team_id: string; name_cn: string; needed: number }[]>();

  if (ids.length) {
    const [{ data: regs }, { data: needRows }] = await Promise.all([
      supabaseAdmin.from('registrations').select('event_id, status, volunteer_team_id').in('event_id', ids),
      supabaseAdmin
        .from('event_team_needs')
        .select('event_id, team_id, needed, team:teams ( name_cn )')
        .in('event_id', ids),
    ]);

    for (const r of (regs ?? []) as { event_id: string; status: string; volunteer_team_id: string | null }[]) {
      const c = regCounts.get(r.event_id) ?? { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
      if (r.status in c) c[r.status]++;
      regCounts.set(r.event_id, c);
      if (r.status === 'approved' && r.volunteer_team_id) {
        const m = approvedTeam.get(r.event_id) ?? new Map<string, number>();
        m.set(r.volunteer_team_id, (m.get(r.volunteer_team_id) ?? 0) + 1);
        approvedTeam.set(r.event_id, m);
      }
    }
    for (const n of (needRows ?? []) as {
      event_id: string;
      team_id: string;
      needed: number;
      team: { name_cn: string } | { name_cn: string }[] | null;
    }[]) {
      const team = Array.isArray(n.team) ? n.team[0] : n.team;
      const list = needs.get(n.event_id) ?? [];
      list.push({ team_id: n.team_id, name_cn: team?.name_cn ?? '', needed: n.needed });
      needs.set(n.event_id, list);
    }
  }

  const events = rows.map((r) => {
    const centreRow = Array.isArray(r.organizing_centre) ? r.organizing_centre[0] : r.organizing_centre;
    const teamApproved = approvedTeam.get(r.id);
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      event_type: r.event_type,
      status: r.status,
      starts_on: r.starts_on,
      ends_on: r.ends_on,
      location: r.location,
      capacity: r.capacity,
      reg_deadline: r.reg_deadline,
      requires_approval: r.requires_approval,
      organizingCentre: centreRow ? { code: centreRow.code, name_cn: centreRow.name_cn } : null,
      regCounts: regCounts.get(r.id) ?? { pending: 0, approved: 0, rejected: 0, cancelled: 0 },
      teamNeeds: (needs.get(r.id) ?? []).map((t) => ({
        ...t,
        approved: teamApproved?.get(t.team_id) ?? 0,
      })),
    };
  });

  return NextResponse.json({
    events,
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)),
  });
}

// Server-side code generation: XLFM-YYMM, then …B, …C, … on collision.
async function generateEventCode(startsOn: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const base = `XLFM-${yymm(startsOn)}`;
  const suffixes = ['', ...'BCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
  for (const s of suffixes) {
    const code = base + s;
    const { data } = await supabaseAdmin.from('events').select('id').eq('code', code).maybeSingle();
    if (!data) return code;
  }
  return null;
}

export async function POST(req: Request) {
  const access = await requireModuleAccess('events', 'edit');
  if (!access.ok) return gate401or403(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Core validation.
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return NextResponse.json({ error: '请填写活动名称' }, { status: 400 });
  const eventType = typeof body.event_type === 'string' ? body.event_type : '';
  if (!(EVENT_TYPES as readonly string[]).includes(eventType)) {
    return NextResponse.json({ error: '活动类型无效' }, { status: 400 });
  }
  if (!isValidDate(body.starts_on)) {
    return NextResponse.json({ error: '开始日期无效' }, { status: 400 });
  }
  const startsOn = body.starts_on as string;
  let endsOn: string | null = null;
  if (body.ends_on !== undefined && body.ends_on !== null && body.ends_on !== '') {
    if (!isValidDate(body.ends_on)) return NextResponse.json({ error: '结束日期无效' }, { status: 400 });
    endsOn = body.ends_on as string;
    if (endsOn < startsOn) return NextResponse.json({ error: '结束日期不能早于开始日期' }, { status: 400 });
  }
  const organizingCentreId = typeof body.organizing_centre_id === 'string' ? body.organizing_centre_id : '';
  if (!organizingCentreId) return NextResponse.json({ error: '请选择主办中心' }, { status: 400 });
  {
    const { data: c, error: cErr } = await supabaseAdmin.from('centres').select('id').eq('id', organizingCentreId).maybeSingle();
    if (cErr || !c) return NextResponse.json({ error: '主办中心无效' }, { status: 400 });
  }

  const feesRes = validateFees(body.fees);
  if ('error' in feesRes) return NextResponse.json({ error: feesRes.error }, { status: 400 });
  const needsRes = validateNeeds(body.team_needs);
  if ('error' in needsRes) return NextResponse.json({ error: needsRes.error }, { status: 400 });

  // Team existence for needs.
  if (needsRes.needs.length) {
    const teamIds = needsRes.needs.map((n) => n.team_id);
    const { data: teamRows } = await supabaseAdmin.from('teams').select('id').in('id', teamIds);
    const found = new Set((teamRows ?? []).map((t) => t.id));
    if (needsRes.needs.some((n) => !found.has(n.team_id))) {
      return NextResponse.json({ error: '组别无效' }, { status: 400 });
    }
  }

  const code = await generateEventCode(startsOn);
  if (!code) return NextResponse.json({ error: '无法生成活动编号（当月已满）' }, { status: 500 });

  const coCentreIds = Array.isArray(body.co_centre_ids)
    ? (body.co_centre_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const me = access.volunteer;

  // Insert the event (status ALWAYS draft — client status ignored).
  const { data: event, error: evErr } = await supabaseAdmin
    .from('events')
    .insert({
      code,
      title,
      event_type: eventType,
      organizing_centre_id: organizingCentreId,
      co_centre_ids: coCentreIds,
      starts_on: startsOn,
      ends_on: endsOn,
      location: typeof body.location === 'string' ? body.location.trim() || null : null,
      capacity: Number.isInteger(Number(body.capacity)) && Number(body.capacity) > 0 ? Number(body.capacity) : null,
      reg_deadline: isValidDate(body.reg_deadline) ? body.reg_deadline : null,
      requires_approval: body.requires_approval === false ? false : true,
      description: typeof body.description === 'string' ? body.description.trim() || null : null,
      status: 'draft',
      created_by: me.id,
      updated_by: me.id,
    })
    .select('*')
    .single();
  if (evErr || !event) {
    console.error('[events] create failed:', evErr);
    return NextResponse.json({ error: '创建活动失败' }, { status: 500 });
  }

  // Fees + needs. On failure, roll back the event (cascade removes any children).
  if (feesRes.fees.length) {
    const { error } = await supabaseAdmin
      .from('event_fees')
      .insert(feesRes.fees.map((f) => ({ ...f, event_id: event.id })));
    if (error) {
      console.error('[events] fees insert failed, rolling back event:', error);
      await supabaseAdmin.from('events').delete().eq('id', event.id);
      return NextResponse.json({ error: '创建收费项目失败' }, { status: 500 });
    }
  }
  if (needsRes.needs.length) {
    const { error } = await supabaseAdmin
      .from('event_team_needs')
      .insert(needsRes.needs.map((n) => ({ ...n, event_id: event.id })));
    if (error) {
      console.error('[events] needs insert failed, rolling back event:', error);
      await supabaseAdmin.from('events').delete().eq('id', event.id);
      return NextResponse.json({ error: '创建组别需求失败' }, { status: 500 });
    }
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'events',
    action: 'create',
    tableName: 'events',
    recordId: event.id,
    after: { ...event, fees: feesRes.fees, team_needs: needsRes.needs },
  });

  return NextResponse.json(
    { event: { ...event, fees: feesRes.fees, team_needs: needsRes.needs } },
    { status: 201 }
  );
}
