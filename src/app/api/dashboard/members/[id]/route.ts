// src/app/api/dashboard/members/[id]/route.ts
// GET   — full member profile + current/past teams + skills (members:view).
// PATCH — partial update (members:edit): same normalizations as create, sets
//         updated_at/updated_by, 409s on duplicate phone, and audits the CHANGED
//         FIELDS ONLY (before/after) to keep audit rows small.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { parseMemberInput } from '@/lib/members';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type TeamRow = {
  team_id: string;
  role: string;
  is_current: boolean;
  since: string | null;
  notes: string | null;
  team: { name_cn: string; name_en: string | null } | { name_cn: string; name_en: string | null }[] | null;
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const { data: member, error } = await supabaseAdmin
    .from('members')
    .select('*, centre:centres ( id, code, name_cn, name_en )')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[members] profile fetch failed:', error);
    return NextResponse.json({ error: 'Failed to load member' }, { status: 500 });
  }
  if (!member) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: teamRows } = await supabaseAdmin
    .from('member_teams')
    .select('team_id, role, is_current, since, notes, team:teams ( name_cn, name_en )')
    .eq('member_id', id);

  const teams = ((teamRows ?? []) as TeamRow[]).map((t) => {
    const team = Array.isArray(t.team) ? t.team[0] : t.team;
    return {
      team_id: t.team_id,
      role: t.role,
      is_current: t.is_current,
      since: t.since,
      notes: t.notes,
      name_cn: team?.name_cn ?? '',
      name_en: team?.name_en ?? null,
    };
  });

  const { data: skillRows } = await supabaseAdmin
    .from('member_skills')
    .select('skill, source')
    .eq('member_id', id);

  return NextResponse.json({
    member,
    teams: {
      current: teams.filter((t) => t.is_current),
      past: teams.filter((t) => !t.is_current),
    },
    skills: skillRows ?? [],
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = parseMemberInput(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const values = parsed.values;
  if (Object.keys(values).length === 0) {
    return NextResponse.json({ error: '没有要更新的字段' }, { status: 400 });
  }

  // Load the current row (for the changed-fields audit + name-presence check).
  const { data: before, error: beforeErr } = await supabaseAdmin
    .from('members')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (beforeErr) {
    console.error('[members] update pre-fetch failed:', beforeErr);
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Effective name after the patch must still be present.
  const effCn = 'name_cn' in values ? values.name_cn : before.name_cn;
  const effEn = 'name_en' in values ? values.name_en : before.name_en;
  if (!effCn && !effEn) {
    return NextResponse.json({ error: '请至少保留中文或英文姓名' }, { status: 400 });
  }

  const me = access.volunteer;
  const { data: after, error } = await supabaseAdmin
    .from('members')
    .update({ ...values, updated_at: new Date().toISOString(), updated_by: me.id })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
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
    console.error('[members] update failed:', error);
    return NextResponse.json({ error: '更新失败，请重试' }, { status: 500 });
  }

  // Changed fields only (both before + after), keeping audit rows small.
  const beforeChanged: Record<string, unknown> = {};
  const afterChanged: Record<string, unknown> = {};
  for (const key of Object.keys(values)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      beforeChanged[key] = before[key];
      afterChanged[key] = after[key];
    }
  }
  if (Object.keys(afterChanged).length > 0) {
    await writeAudit({
      actorId: me.id,
      actorEmail: me.email,
      module: 'members',
      action: 'update',
      tableName: 'members',
      recordId: id,
      before: beforeChanged,
      after: afterChanged,
    });
  }

  return NextResponse.json({ member: after });
}
