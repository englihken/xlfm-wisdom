// src/app/api/dashboard/volunteers/[id]/route.ts
// Admin-only: update a volunteer's display name, email, center, role, or active
// flag. Self-protection is enforced SERVER-SIDE: an admin can never demote or
// disable their own account (target id === caller id) — but editing your own
// display name / email / center is fine. We disable volunteers, never delete
// them, so their history/notes stay attributable.

import { NextResponse } from 'next/server';
import { getActiveVolunteer, getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isValidCenter } from '@/lib/xlfm-centers';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const VOLUNTEER_COLUMNS =
  'id, email, display_name, center, centre_id, occupation, skills, role, scope, active, created_at';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ROLES = ['admin', 'volunteer', 'erp_admin', 'committee', 'centre_head'] as const;

// Scope derived from role, server-side (client scope is ignored). care volunteers AND
// 分会负责人 (centre_head) are centre-scoped; every other role sees all centres.
function scopeForRole(role: string): 'all_centers' | 'own_center' {
  return role === 'volunteer' || role === 'centre_head' ? 'own_center' : 'all_centers';
}

type VolunteerUpdate = {
  displayName?: unknown;
  email?: unknown;
  center?: unknown;
  centre_id?: unknown;
  occupation?: unknown;
  skills?: unknown;
  role?: unknown;
  active?: unknown;
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Layer 1: active volunteer (401 / 403), then Layer 2: must be an admin.
  const access = await getActiveVolunteer();
  if (!access) {
    const user = await getAuthenticatedUser();
    return NextResponse.json(
      { error: user ? 'Not an active volunteer' : 'Unauthorized' },
      { status: user ? 403 : 401 }
    );
  }
  if (access.volunteer.role !== 'admin') {
    return NextResponse.json({ error: '仅限管理员' }, { status: 403 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as VolunteerUpdate | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Fetch the target up front: gives us a clean 404 and the current email to
  // decide whether the auth login email actually needs changing.
  const { data: current, error: fetchError } = await supabaseAdmin
    .from('volunteers')
    .select(VOLUNTEER_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    console.error('[dashboard] volunteer fetch failed:', fetchError);
    return NextResponse.json({ error: 'Failed to update volunteer' }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const isSelf = id === access.volunteer.id;
  const update: {
    display_name?: string | null;
    email?: string;
    center?: string | null;
    centre_id?: string | null;
    occupation?: string | null;
    skills?: string | null;
    role?: string;
    scope?: 'all_centers' | 'own_center';
    active?: boolean;
  } = {};

  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string') {
      return NextResponse.json({ error: '显示名称无效' }, { status: 400 });
    }
    update.display_name = body.displayName.trim() || null;
  }

  if (body.center !== undefined) {
    if (typeof body.center !== 'string') {
      return NextResponse.json({ error: '所属中心无效' }, { status: 400 });
    }
    const trimmed = body.center.trim();
    // Blank clears it; otherwise it must be a known center.
    if (trimmed && !isValidCenter(trimmed)) {
      return NextResponse.json({ error: '所属中心无效' }, { status: 400 });
    }
    update.center = trimmed || null;
  }

  if (body.occupation !== undefined) {
    if (typeof body.occupation !== 'string') {
      return NextResponse.json({ error: '职业无效' }, { status: 400 });
    }
    update.occupation = body.occupation.trim() || null;
  }

  if (body.skills !== undefined) {
    if (typeof body.skills !== 'string') {
      return NextResponse.json({ error: '专长无效' }, { status: 400 });
    }
    update.skills = body.skills.trim() || null;
  }

  if (body.role !== undefined) {
    if (typeof body.role !== 'string' || !(ALLOWED_ROLES as readonly string[]).includes(body.role)) {
      return NextResponse.json({ error: '角色无效' }, { status: 400 });
    }
    // Self-protection: an admin cannot drop their own admin role.
    if (isSelf && body.role !== 'admin') {
      return NextResponse.json({ error: '不能停用或降级自己的账号' }, { status: 400 });
    }
    update.role = body.role;
    // Role change re-derives scope server-side.
    update.scope = scopeForRole(body.role);
  }

  if (body.centre_id !== undefined) {
    if (body.centre_id === null || (typeof body.centre_id === 'string' && body.centre_id.trim() === '')) {
      update.centre_id = null;
    } else if (typeof body.centre_id === 'string') {
      const centreId = body.centre_id.trim();
      const { data: c, error: cErr } = await supabaseAdmin
        .from('centres')
        .select('id')
        .eq('id', centreId)
        .maybeSingle();
      if (cErr || !c) {
        return NextResponse.json({ error: '所属中心（结构化）无效' }, { status: 400 });
      }
      update.centre_id = centreId;
    } else {
      return NextResponse.json({ error: '所属中心（结构化）无效' }, { status: 400 });
    }
  }

  // 分会负责人 (centre_head) must stay pinned to a centre — validate the resulting state.
  {
    const resultRole = (update.role as string | undefined) ?? (current as { role?: string }).role;
    const resultCentre =
      'centre_id' in update ? (update.centre_id as string | null) : ((current as { centre_id?: string | null }).centre_id ?? null);
    if (resultRole === 'centre_head' && !resultCentre) {
      return NextResponse.json({ error: '分会负责人必须指定共修会' }, { status: 400 });
    }
  }

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return NextResponse.json({ error: '状态无效' }, { status: 400 });
    }
    // Self-protection: cannot disable your own account.
    if (isSelf && body.active === false) {
      return NextResponse.json({ error: '不能停用或降级自己的账号' }, { status: 400 });
    }
    update.active = body.active;
  }

  // Email is special: it is the LOGIN identity, held in Supabase Auth. When it
  // changes we must update the auth account FIRST (email_confirm so they can log
  // in with it right away). Only if that succeeds do we touch the volunteers row,
  // so the row and the login email never drift apart.
  let authEmailChanged = false;
  if (body.email !== undefined) {
    if (typeof body.email !== 'string') {
      return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 });
    }
    const nextEmail = body.email.trim().toLowerCase();
    if (!EMAIL_RE.test(nextEmail)) {
      return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 });
    }
    if (nextEmail !== current.email) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, {
        email: nextEmail,
        email_confirm: true,
      });
      if (authError) {
        const msg = authError.message ?? '';
        const isDuplicate =
          authError.code === 'email_exists' ||
          authError.status === 422 ||
          /already.*(registered|been|in use)/i.test(msg);
        if (isDuplicate) {
          return NextResponse.json({ error: '该邮箱已被使用' }, { status: 409 });
        }
        console.error('[dashboard] auth email update failed:', authError);
        return NextResponse.json({ error: '更新邮箱失败' }, { status: 400 });
      }
      authEmailChanged = true;
      update.email = nextEmail;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('volunteers')
    .update(update)
    .eq('id', id)
    .select(VOLUNTEER_COLUMNS)
    .maybeSingle();

  if (error || !data) {
    // The row write failed after we may have already changed the auth email —
    // roll the auth email back so login and the row stay consistent.
    if (authEmailChanged) {
      const { error: rollbackError } = await supabaseAdmin.auth.admin.updateUserById(id, {
        email: current.email,
        email_confirm: true,
      });
      if (rollbackError) {
        console.error(
          '[dashboard] auth email rollback failed (auth/row email drift):',
          rollbackError
        );
      }
    }
    if (error) {
      console.error('[dashboard] volunteer update failed:', error);
    }
    return NextResponse.json({ error: 'Failed to update volunteer' }, { status: 500 });
  }

  // Audit the change. An active flip is a deactivate/reactivate event; any other
  // changed fields are an 'update' with just those fields (both keyed by column).
  const cur = current as Record<string, unknown>;
  const next = data as Record<string, unknown>;
  const beforeChanged: Record<string, unknown> = {};
  const afterChanged: Record<string, unknown> = {};
  for (const k of Object.keys(update)) {
    if (JSON.stringify(cur[k]) !== JSON.stringify(next[k])) {
      beforeChanged[k] = cur[k];
      afterChanged[k] = next[k];
    }
  }
  const auditCommon = {
    actorId: access.volunteer.id,
    actorEmail: access.volunteer.email,
    module: 'settings',
    tableName: 'volunteers',
    recordId: id,
  } as const;
  if ('active' in afterChanged) {
    await writeAudit({
      ...auditCommon,
      action: next.active ? 'reactivate' : 'deactivate',
      before: { active: cur.active },
      after: { active: next.active },
    });
    delete beforeChanged.active;
    delete afterChanged.active;
  }
  if (Object.keys(afterChanged).length > 0) {
    await writeAudit({ ...auditCommon, action: 'update', before: beforeChanged, after: afterChanged });
  }

  return NextResponse.json({ volunteer: data });
}
