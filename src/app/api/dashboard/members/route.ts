// src/app/api/dashboard/members/route.ts
// GET  — paginated, filtered members list (members:view).
// POST — create a member (members:edit); normalizes phone, enforces a name,
//        409s on a duplicate phone, and writes an audit_log 'create' row.
// Same two-layer security as the care routes: requireModuleAccess gate, then all
// data access via the service-role client (supabaseAdmin).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { parseMemberInput } from '@/lib/members';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

type CentreLite = { id: string; code: string; name_cn: string };
type MemberTeamLite = { member_id: string; role: string; team: { name_cn: string } | { name_cn: string }[] | null };

export async function GET(req: Request) {
  const access = await requireModuleAccess('members', 'view');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(sp.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const search = (sp.get('search') ?? '').trim();
  const centre = sp.get('centre');
  const team = sp.get('team');
  const disciple = sp.get('disciple');
  const fullVeg = sp.get('full_veg');
  const status = sp.get('status') ?? 'active'; // default 在册

  // Team filter resolves to a set of member ids first (is_current only), so the
  // main query stays a single filtered/paginated select.
  let teamMemberIds: string[] | null = null;
  if (team) {
    const { data: mt } = await supabaseAdmin
      .from('member_teams')
      .select('member_id')
      .eq('team_id', team)
      .eq('is_current', true);
    teamMemberIds = (mt ?? []).map((r) => r.member_id as string);
    if (teamMemberIds.length === 0) {
      return NextResponse.json({ members: [], total: 0, page, limit, totalPages: 0 });
    }
  }

  let q = supabaseAdmin
    .from('members')
    .select(
      'id, name_cn, name_en, phone, gyt_centre_id, disciple, full_veg, member_type, status',
      { count: 'exact' }
    );

  if (status === 'active' || status === 'inactive') q = q.eq('status', status);
  if (centre) q = q.eq('gyt_centre_id', centre);
  if (disciple === 'true' || disciple === 'false') q = q.eq('disciple', disciple === 'true');
  if (fullVeg === 'true' || fullVeg === 'false') q = q.eq('full_veg', fullVeg === 'true');
  if (teamMemberIds) q = q.in('id', teamMemberIds);

  if (search) {
    // Strip characters that would break PostgREST's or() / ilike parsing.
    const safe = search.replace(/[,.()%*"\\]/g, ' ').trim();
    const digits = search.replace(/\D/g, '');
    const ors: string[] = [];
    if (safe) {
      ors.push(`name_cn.ilike.%${safe}%`);
      ors.push(`name_en.ilike.%${safe}%`);
    }
    if (digits) ors.push(`phone.ilike.%${digits}%`);
    if (ors.length) q = q.or(ors.join(','));
  }

  q = q.order('name_cn', { ascending: true, nullsFirst: false }).range(from, to);

  const { data, count, error } = await q;
  if (error) {
    console.error('[members] list query failed:', error);
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }

  const rows = data ?? [];
  const total = count ?? 0;

  // Enrich each page row with its centre (code/name) and current teams — two
  // batched queries + a JS join, no N+1.
  const centreIds = [...new Set(rows.map((r) => r.gyt_centre_id).filter(Boolean) as string[])];
  const memberIds = rows.map((r) => r.id as string);

  const centreById = new Map<string, CentreLite>();
  if (centreIds.length) {
    const { data: cs } = await supabaseAdmin
      .from('centres')
      .select('id, code, name_cn')
      .in('id', centreIds);
    for (const c of (cs ?? []) as CentreLite[]) centreById.set(c.id, c);
  }

  const teamsByMember = new Map<string, { name_cn: string; role: string }[]>();
  if (memberIds.length) {
    const { data: mts } = await supabaseAdmin
      .from('member_teams')
      .select('member_id, role, team:teams ( name_cn )')
      .in('member_id', memberIds)
      .eq('is_current', true);
    for (const mt of (mts ?? []) as MemberTeamLite[]) {
      const t = Array.isArray(mt.team) ? mt.team[0] : mt.team;
      if (!t) continue;
      const list = teamsByMember.get(mt.member_id) ?? [];
      list.push({ name_cn: t.name_cn, role: mt.role });
      teamsByMember.set(mt.member_id, list);
    }
  }

  const members = rows.map((r) => {
    const centreRow = r.gyt_centre_id ? centreById.get(r.gyt_centre_id as string) : undefined;
    return {
      id: r.id,
      name_cn: r.name_cn,
      name_en: r.name_en,
      phone: r.phone,
      disciple: r.disciple,
      full_veg: r.full_veg,
      member_type: r.member_type,
      status: r.status,
      centre: centreRow ? { code: centreRow.code, name_cn: centreRow.name_cn } : null,
      teams: teamsByMember.get(r.id as string) ?? [],
    };
  });

  return NextResponse.json({
    members,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

export async function POST(req: Request) {
  const access = await requireModuleAccess('members', 'edit');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = parseMemberInput(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const values = parsed.values;

  // Name required (DB CHECK is the backstop).
  if (!values.name_cn && !values.name_en) {
    return NextResponse.json({ error: '请至少填写中文或英文姓名' }, { status: 400 });
  }

  const me = access.volunteer;
  const insert = {
    member_type: 'member',
    status: 'active',
    ...values,
    created_by: me.id,
    updated_by: me.id,
  };

  const { data: created, error } = await supabaseAdmin
    .from('members')
    .insert(insert)
    .select('*')
    .single();

  if (error) {
    // Duplicate phone → 409 with the existing member so the UI can link to them.
    if (error.code === '23505' && values.phone) {
      const { data: existing } = await supabaseAdmin
        .from('members')
        .select('id, name_cn, name_en')
        .eq('phone', values.phone)
        .maybeSingle();
      return NextResponse.json(
        {
          error: '该电话号码已存在',
          existing: existing
            ? { id: existing.id, name: existing.name_cn || existing.name_en || '（无名）' }
            : null,
        },
        { status: 409 }
      );
    }
    console.error('[members] create failed:', error);
    return NextResponse.json({ error: '创建失败，请重试' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'members',
    action: 'create',
    tableName: 'members',
    recordId: created.id,
    after: created,
  });

  return NextResponse.json({ member: created }, { status: 201 });
}
