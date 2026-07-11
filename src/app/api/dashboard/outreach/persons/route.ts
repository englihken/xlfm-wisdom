// src/app/api/dashboard/outreach/persons/route.ts
// GET  (outreach:view) — the 善缘 work queue. Filters: ?source= &rung= &centre_id= &q= (name OR
//   phone) &sort=stale|recent &page= &limit=. Each row carries its derived rung + latest activity.
//   The derived rung/activity come from milestones, so we fetch matching contacts + their
//   milestones and fold in memory (no per-contact N+1); rung filter, sort and paging apply after.
// POST (outreach:edit) — add a 善缘 (manual OR the events bridge). Creates a contacts row
//   (channel='manual', stage='初次接触') + a first_contact milestone. When source_event_id is
//   given, a same-name + same-event contact already on the list → 409 { existing, message }.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { deriveRung, MILESTONE_KEYS, SOURCE_KEYS } from '@/lib/outreach';
import { outreachScope } from '@/lib/outreach-scope';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

export async function GET(req: Request) {
  const access = await requireModuleAccess('outreach', 'view');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(sp.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const sort = sp.get('sort') === 'recent' ? 'recent' : 'stale';

  let q = supabaseAdmin
    .from('contacts')
    .select('id, display_name, phone, wa_id, source_type, source_event_id, centre_id, stage, last_seen');
  const source = sp.get('source');
  if (source && (SOURCE_KEYS as readonly string[]).includes(source)) q = q.eq('source_type', source);

  // Centre-scope wall: a locked own_center account sees ONLY its own centre (NULL-centre national
  // contacts are invisible to it); the centre filter param is honoured only for all_centers.
  const scope = await outreachScope(supabaseAdmin, access.volunteer.id);
  if (scope.locked) {
    if (!scope.centreId) return NextResponse.json({ persons: [], total: 0, page, limit, totalPages: 1 });
    q = q.eq('centre_id', scope.centreId);
  } else {
    const centreId = sp.get('centre_id');
    if (centreId) q = q.eq('centre_id', centreId);
  }

  const search = (sp.get('q') ?? '').trim();
  if (search) {
    const safe = search.replace(/[,.()%*"\\]/g, ' ').trim();
    if (safe) q = q.or(`display_name.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }

  const { data: contacts, error } = await q.limit(2000);
  if (error) {
    console.error('[outreach/persons] list failed:', error);
    return NextResponse.json({ error: 'Failed to load list' }, { status: 500 });
  }
  const rows = (contacts ?? []) as {
    id: string; display_name: string | null; phone: string | null; wa_id: string | null;
    source_type: string | null; source_event_id: string | null; centre_id: string | null; stage: string | null; last_seen: string;
  }[];

  // Milestones for these contacts → derived rung + latest activity.
  const ids = rows.map((r) => r.id);
  const byContact = new Map<string, { milestone: string; happened_on: string }[]>();
  if (ids.length) {
    const { data: ms } = await supabaseAdmin.from('contact_milestones').select('contact_id, milestone, happened_on').in('contact_id', ids);
    for (const m of (ms ?? []) as { contact_id: string; milestone: string; happened_on: string }[]) {
      const arr = byContact.get(m.contact_id) ?? [];
      arr.push(m);
      byContact.set(m.contact_id, arr);
    }
  }
  const centreIds = [...new Set(rows.map((r) => r.centre_id).filter(Boolean) as string[])];
  const centreName = new Map<string, string>();
  if (centreIds.length) {
    const { data: cs } = await supabaseAdmin.from('centres').select('id, name_cn').in('id', centreIds);
    for (const c of (cs ?? []) as { id: string; name_cn: string }[]) centreName.set(c.id, c.name_cn);
  }

  let enriched = rows.map((r) => {
    const ms = byContact.get(r.id) ?? [];
    const rung = deriveRung(ms);
    const latestMs = ms.reduce<string | null>((mx, m) => (!mx || m.happened_on > mx ? m.happened_on : mx), null);
    const lastSeenDate = (r.last_seen ?? '').slice(0, 10);
    const lastActivity = latestMs && latestMs > lastSeenDate ? latestMs : lastSeenDate;
    return {
      id: r.id,
      display_name: r.display_name,
      phone: r.phone,
      wa_id: r.wa_id,
      source_type: r.source_type,
      centre_id: r.centre_id,
      centre_name: r.centre_id ? centreName.get(r.centre_id) ?? null : null,
      stage: r.stage,
      rung,
      lastActivity,
    };
  });

  const rungFilter = sp.get('rung');
  if (rungFilter && (MILESTONE_KEYS as readonly string[]).includes(rungFilter)) enriched = enriched.filter((r) => r.rung === rungFilter);

  enriched.sort((a, b) => (sort === 'recent' ? (a.lastActivity < b.lastActivity ? 1 : -1) : (a.lastActivity > b.lastActivity ? 1 : -1)));

  const total = enriched.length;
  const start = (page - 1) * limit;
  return NextResponse.json({
    persons: enriched.slice(start, start + limit),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const access = await requireModuleAccess('outreach', 'edit');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  if (!displayName) return NextResponse.json({ error: '请填写姓名' }, { status: 400 });

  const sourceType = typeof body.source_type === 'string' && (SOURCE_KEYS as readonly string[]).includes(body.source_type) ? body.source_type : null;
  const phone = typeof body.phone === 'string' ? body.phone.trim() || null : null;
  const sourceNote = typeof body.source_note === 'string' ? body.source_note.trim() || null : null;

  let sourceEventId: string | null = null;
  let eventCentre: string | null = null;
  if (typeof body.source_event_id === 'string' && body.source_event_id) {
    const { data: ev } = await supabaseAdmin.from('events').select('id, organizing_centre_id').eq('id', body.source_event_id).maybeSingle();
    if (!ev) return NextResponse.json({ error: '关联活动无效' }, { status: 400 });
    sourceEventId = body.source_event_id;
    eventCentre = (ev as { organizing_centre_id: string | null }).organizing_centre_id ?? null;
  }
  let centreId: string | null = null;
  if (typeof body.centre_id === 'string' && body.centre_id) {
    const { data: ce } = await supabaseAdmin.from('centres').select('id').eq('id', body.centre_id).maybeSingle();
    if (!ce) return NextResponse.json({ error: '中心无效' }, { status: 400 });
    centreId = body.centre_id;
  }
  // The 带入渡人名单 bridge inherits the EVENT's organizing centre when no centre was given —
  // a centre's event leads belong to that centre.
  if (!centreId && eventCentre) centreId = eventCentre;

  // Centre-scope wall: a locked account can only create a 善缘 in its own centre.
  const scope = await outreachScope(supabaseAdmin, access.volunteer.id);
  if (scope.locked) {
    if (!scope.centreId) return NextResponse.json({ error: '账号未绑定中心，无法新增' }, { status: 400 });
    centreId = scope.centreId;
  }

  const firstOn = typeof body.first_contact_date === 'string' && DATE_RE.test(body.first_contact_date)
    ? body.first_contact_date
    : new Date().toISOString().slice(0, 10);

  // Dedupe the events-bridge case: same person (name) + same event already on the list.
  if (sourceEventId) {
    const { data: existing } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('display_name', displayName)
      .eq('source_event_id', sourceEventId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: '已在名单中', existing: { id: (existing as { id: string }).id } }, { status: 409 });
    }
  }

  const me = access.volunteer;
  const nowIso = new Date().toISOString();
  const { data: contact, error: insErr } = await supabaseAdmin
    .from('contacts')
    .insert({
      channel: 'manual',
      display_name: displayName,
      stage: 'first_contact', // E3 §4: stage writes use canonical keys

      phone,
      source_type: sourceType,
      source_event_id: sourceEventId,
      source_note: sourceNote,
      centre_id: centreId,
      first_seen: nowIso,
      last_seen: nowIso,
    })
    .select('id, display_name')
    .single();
  if (insErr || !contact) {
    console.error('[outreach/persons] create failed:', insErr);
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }
  const contactId = (contact as unknown as { id: string }).id;

  const { error: msErr } = await supabaseAdmin
    .from('contact_milestones')
    .insert({ contact_id: contactId, milestone: 'first_contact', happened_on: firstOn, noted_by: me.id });
  if (msErr) {
    console.error('[outreach/persons] first_contact insert failed, rolling back contact:', msErr);
    await supabaseAdmin.from('contacts').delete().eq('id', contactId);
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'outreach',
    action: 'outreach.person_create',
    tableName: 'contacts',
    recordId: contactId,
    after: { display_name: displayName, source_type: sourceType, source_event_id: sourceEventId },
  });

  return NextResponse.json({ person: { id: contactId } }, { status: 201 });
}
