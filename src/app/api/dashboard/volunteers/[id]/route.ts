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

export const runtime = 'nodejs';

const VOLUNTEER_COLUMNS =
  'id, email, display_name, center, occupation, skills, role, active, created_at';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type VolunteerUpdate = {
  displayName?: unknown;
  email?: unknown;
  center?: unknown;
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
    occupation?: string | null;
    skills?: string | null;
    role?: string;
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
    if (body.role !== 'admin' && body.role !== 'volunteer') {
      return NextResponse.json({ error: '角色无效' }, { status: 400 });
    }
    // Self-protection: cannot demote your own admin account.
    if (isSelf && body.role === 'volunteer') {
      return NextResponse.json({ error: '不能停用或降级自己的账号' }, { status: 400 });
    }
    update.role = body.role;
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

  return NextResponse.json({ volunteer: data });
}
