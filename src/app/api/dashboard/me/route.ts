// src/app/api/dashboard/me/route.ts
// GET the logged-in volunteer's own profile: who they are and what they can do.
// The dashboard calls this once after its auth gate to show the display name and
// to decide whether to reveal admin-only features (via role). Same guard as the
// other dashboard routes: 401 = no session, 403 = logged in but not an active
// volunteer.

import { NextResponse } from 'next/server';
import { getActiveVolunteer, getAuthenticatedUser } from '@/lib/supabase-server';

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
  return NextResponse.json({
    email: volunteer.email,
    displayName: volunteer.display_name,
    role: volunteer.role,
    active: volunteer.active,
  });
}
