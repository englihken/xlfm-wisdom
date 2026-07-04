// src/app/api/dashboard/members/[id]/teams/route.ts
// PUT — replace a member's team memberships with the desired set (members:edit).
// Body: [{ team_id, role: 'lead'|'member', is_current }]. Diffs against the existing
// member_teams rows: inserts new, updates changed role/is_current (keeping since/
// notes), removes rows no longer desired (team membership is an association, so
// removal is allowed). Audits the before/after sets on member_teams.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type DesiredTeam = { team_id: string; role: 'lead' | 'member'; is_current: boolean };

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const body = (await req.json().catch(() => null)) as unknown;
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body (expected an array)' }, { status: 400 });
  }

  // Validate + de-dupe the desired set by team_id.
  const desiredByTeam = new Map<string, DesiredTeam>();
  for (const raw of body) {
    const r = raw as Record<string, unknown>;
    const team_id = typeof r.team_id === 'string' ? r.team_id : '';
    const role = r.role === 'lead' ? 'lead' : 'member';
    const is_current = r.is_current !== false; // default true
    if (!team_id) {
      return NextResponse.json({ error: 'team_id 缺失' }, { status: 400 });
    }
    desiredByTeam.set(team_id, { team_id, role, is_current });
  }

  // Confirm the member exists.
  const { data: member } = await supabaseAdmin.from('members').select('id').eq('id', id).maybeSingle();
  if (!member) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: existingRows, error: exErr } = await supabaseAdmin
    .from('member_teams')
    .select('team_id, role, is_current')
    .eq('member_id', id);
  if (exErr) {
    console.error('[members] teams pre-fetch failed:', exErr);
    return NextResponse.json({ error: 'Failed to update teams' }, { status: 500 });
  }
  const existingByTeam = new Map<string, { team_id: string; role: string; is_current: boolean }>();
  for (const e of existingRows ?? []) existingByTeam.set(e.team_id as string, e as { team_id: string; role: string; is_current: boolean });

  // Diff.
  const toUpsert: { member_id: string; team_id: string; role: string; is_current: boolean }[] = [];
  for (const d of desiredByTeam.values()) {
    const cur = existingByTeam.get(d.team_id);
    if (!cur || cur.role !== d.role || cur.is_current !== d.is_current) {
      toUpsert.push({ member_id: id, team_id: d.team_id, role: d.role, is_current: d.is_current });
    }
  }
  const toDelete = [...existingByTeam.keys()].filter((t) => !desiredByTeam.has(t));

  // Apply: upsert changed/new (keeps since/notes on existing rows), delete removed.
  if (toUpsert.length) {
    const { error } = await supabaseAdmin
      .from('member_teams')
      .upsert(toUpsert, { onConflict: 'member_id,team_id' });
    if (error) {
      console.error('[members] teams upsert failed:', error);
      return NextResponse.json({ error: '更新失败，请重试' }, { status: 500 });
    }
  }
  if (toDelete.length) {
    const { error } = await supabaseAdmin
      .from('member_teams')
      .delete()
      .eq('member_id', id)
      .in('team_id', toDelete);
    if (error) {
      console.error('[members] teams delete failed:', error);
      return NextResponse.json({ error: '更新失败，请重试' }, { status: 500 });
    }
  }

  const me = access.volunteer;
  const beforeSet = (existingRows ?? []).map((e) => ({
    team_id: e.team_id,
    role: e.role,
    is_current: e.is_current,
  }));
  const afterSet = [...desiredByTeam.values()];
  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'members',
    action: 'update',
    tableName: 'member_teams',
    recordId: id,
    before: beforeSet,
    after: afterSet,
  });

  return NextResponse.json({ ok: true, teams: afterSet });
}
