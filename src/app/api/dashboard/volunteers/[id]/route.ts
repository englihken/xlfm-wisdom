// src/app/api/dashboard/volunteers/[id]/route.ts
// Admin-only: update a volunteer's display name, role, or active flag.
// Self-protection is enforced SERVER-SIDE: an admin can never demote or disable
// their own account (target id === caller id). We disable volunteers, never
// delete them, so their history/notes stay attributable.

import { NextResponse } from 'next/server';
import { getActiveVolunteer, getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const VOLUNTEER_COLUMNS = 'id, email, display_name, role, active, created_at';

type VolunteerUpdate = {
  displayName?: unknown;
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

  const isSelf = id === access.volunteer.id;
  const update: { display_name?: string | null; role?: string; active?: boolean } = {};

  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string') {
      return NextResponse.json({ error: '显示名称无效' }, { status: 400 });
    }
    const trimmed = body.displayName.trim();
    update.display_name = trimmed || null;
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

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('volunteers')
    .update(update)
    .eq('id', id)
    .select(VOLUNTEER_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error('[dashboard] volunteer update failed:', error);
    return NextResponse.json({ error: 'Failed to update volunteer' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ volunteer: data });
}
