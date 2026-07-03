// src/app/api/dashboard/volunteers/route.ts
// Admin-only user management: list the volunteer team (GET) and create a new
// volunteer account (POST). Both enforce the caller is an ACTIVE ADMIN server-
// side (UI hiding is not security). Account creation uses the service-role admin
// auth API; data access goes through supabaseAdmin, same as the other dashboard
// routes.

import { NextResponse } from 'next/server';
import { getActiveVolunteer, getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const VOLUNTEER_COLUMNS = 'id, email, display_name, center, role, active, created_at';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type NewVolunteer = {
  email?: unknown;
  password?: unknown;
  displayName?: unknown;
  center?: unknown;
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
  const role = body.role;

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: '密码至少需要 8 位' }, { status: 400 });
  }
  if (role !== 'admin' && role !== 'volunteer') {
    return NextResponse.json({ error: '角色无效' }, { status: 400 });
  }
  const displayName = displayNameRaw || null;
  const center = centerRaw || null;

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
    .insert({ id: authUserId, email, display_name: displayName, center, role, active: true })
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

  return NextResponse.json({ volunteer: inserted }, { status: 201 });
}
