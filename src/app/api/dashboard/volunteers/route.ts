// src/app/api/dashboard/volunteers/route.ts
// Admin-only user management: list the volunteer team (GET) and create a new
// volunteer account (POST). Both enforce the caller is an ACTIVE ADMIN server-
// side (UI hiding is not security). Account creation uses the service-role admin
// auth API; data access goes through supabaseAdmin, same as the other dashboard
// routes.

import { NextResponse } from 'next/server';
import { getActiveVolunteer, getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isValidCenter } from '@/lib/xlfm-centers';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const VOLUNTEER_COLUMNS =
  'id, email, display_name, center, centre_id, occupation, skills, role, scope, active, created_at';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ROLES = ['admin', 'volunteer', 'erp_admin', 'committee'] as const;

// Centre scope is derived from the role SERVER-SIDE (never trusted from the client):
// only care volunteers are centre-scoped; every other role sees all centres.
function scopeForRole(role: string): 'all_centers' | 'own_center' {
  return role === 'volunteer' ? 'own_center' : 'all_centers';
}

type NewVolunteer = {
  email?: unknown;
  password?: unknown;
  displayName?: unknown;
  center?: unknown;
  centre_id?: unknown;
  occupation?: unknown;
  skills?: unknown;
  role?: unknown;
};

export async function GET() {
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

  const { data, error } = await supabaseAdmin
    .from('volunteers')
    .select(VOLUNTEER_COLUMNS)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[dashboard] volunteers list failed:', error);
    return NextResponse.json({ error: 'Failed to load volunteers' }, { status: 500 });
  }

  return NextResponse.json({ volunteers: data ?? [] });
}

export async function POST(req: Request) {
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

  const body = (await req.json().catch(() => null)) as NewVolunteer | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Validate.
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const displayNameRaw = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const centerRaw = typeof body.center === 'string' ? body.center.trim() : '';
  const occupationRaw = typeof body.occupation === 'string' ? body.occupation.trim() : '';
  const skillsRaw = typeof body.skills === 'string' ? body.skills.trim() : '';
  const role = body.role;

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: '密码至少需要 8 位' }, { status: 400 });
  }
  if (typeof role !== 'string' || !(ALLOWED_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: '角色无效' }, { status: 400 });
  }
  // Center (free-text care label) must be blank or a known 心灵法门 center.
  if (centerRaw && !isValidCenter(centerRaw)) {
    return NextResponse.json({ error: '所属中心无效' }, { status: 400 });
  }
  // Structured centre_id (FK) — optional; if provided it must exist in centres.
  const centreId = typeof body.centre_id === 'string' && body.centre_id.trim() ? body.centre_id.trim() : null;
  if (centreId) {
    const { data: c, error: cErr } = await supabaseAdmin
      .from('centres')
      .select('id')
      .eq('id', centreId)
      .maybeSingle();
    if (cErr || !c) {
      return NextResponse.json({ error: '所属中心（结构化）无效' }, { status: 400 });
    }
  }
  const displayName = displayNameRaw || null;
  const center = centerRaw || null;
  const occupation = occupationRaw || null;
  const skills = skillsRaw || null;
  // Scope is derived from the role — client-sent scope is ignored.
  const scope = scopeForRole(role);

  // Create the auth user (service role). email_confirm so they can log in now.
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created?.user) {
    // Supabase returns a 422 for an already-registered email.
    const msg = createError?.message ?? '';
    const isDuplicate =
      createError?.code === 'email_exists' ||
      createError?.status === 422 ||
      /already.*(registered|been)/i.test(msg);
    if (isDuplicate) {
      return NextResponse.json({ error: '该邮箱已存在账号' }, { status: 409 });
    }
    console.error('[dashboard] auth createUser failed:', createError);
    return NextResponse.json({ error: '创建账号失败' }, { status: 500 });
  }

  const authUserId = created.user.id;

  // Insert the volunteers row. If this fails, roll back the auth user so we do
  // not leave an orphaned account that can log in but has no volunteer profile.
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('volunteers')
    .insert({
      id: authUserId,
      email,
      display_name: displayName,
      center,
      centre_id: centreId,
      occupation,
      skills,
      role,
      scope,
      active: true,
      // Force a password change on first login (admin set the initial password).
      must_change_password: true,
    })
    .select(VOLUNTEER_COLUMNS)
    .single();

  if (insertError || !inserted) {
    console.error('[dashboard] volunteer row insert failed, rolling back auth user:', insertError);
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
    if (deleteError) {
      console.error('[dashboard] rollback deleteUser failed (orphan auth user):', deleteError);
    }
    return NextResponse.json({ error: '创建账号失败' }, { status: 500 });
  }

  // Audit the account creation (closes the account-events gap). Actor = the admin.
  await writeAudit({
    actorId: access.volunteer.id,
    actorEmail: access.volunteer.email,
    module: 'settings',
    action: 'create',
    tableName: 'volunteers',
    recordId: inserted.id,
    after: {
      email: inserted.email,
      display_name: inserted.display_name,
      role: inserted.role,
      scope: inserted.scope,
      centre_id: inserted.centre_id,
    },
  });

  return NextResponse.json({ volunteer: inserted }, { status: 201 });
}
