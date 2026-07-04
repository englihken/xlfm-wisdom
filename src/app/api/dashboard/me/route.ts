// src/app/api/dashboard/me/route.ts
// GET the logged-in volunteer's own profile: who they are and what they can do.
// The dashboard calls this once after its auth gate to show the display name and
// to decide whether to reveal admin-only features (via role). Same guard as the
// other dashboard routes: 401 = no session, 403 = logged in but not an active
// volunteer.

import { NextResponse } from 'next/server';
import { getActiveVolunteer, getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import type { Grants } from '@/lib/access';

export const runtime = 'nodejs';

export async function GET() {
  const access = await getActiveVolunteer();
  if (!access) {
    const user = await getAuthenticatedUser();
    return NextResponse.json(
      { error: user ? 'Not an active volunteer' : 'Unauthorized' },
      { status: user ? 403 : 401 }
    );
  }

  const { volunteer } = access;

  // The caller's module grants → { care: 'edit', members: 'admin', … } (only
  // granted modules present). Drives nav visibility + client-side action gating.
  // Non-fatal: an empty object just hides everything module-gated.
  const grants: Grants = {};
  if (supabaseAdmin) {
    const { data: grantRows, error } = await supabaseAdmin
      .from('role_grants')
      .select('module, access')
      .eq('role', volunteer.role);
    if (error) {
      console.error('[dashboard/me] role_grants lookup failed:', error);
    } else {
      for (const g of grantRows ?? []) {
        grants[g.module as keyof Grants] = g.access;
      }
    }
  }

  return NextResponse.json({
    email: volunteer.email,
    displayName: volunteer.display_name,
    role: volunteer.role,
    active: volunteer.active,
    mustChangePassword: volunteer.must_change_password,
    grants,
  });
}
