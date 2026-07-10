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

    // E2 inbox nav visibility: a mailbox OWNER may have no role_grant for 'inbox' (e.g. a
    // plain 关怀义工 assigned as an owner), yet must still see the 收件箱 door. Surface that
    // as a synthetic grants.inbox='edit' (their effective content access) when they own any
    // mailbox and have no higher real grant. Real grants (admin/summary) always win.
    if (!grants.inbox) {
      const { data: owned } = await supabaseAdmin
        .from('inbox_mailbox_owners')
        .select('mailbox_id')
        .eq('volunteer_id', volunteer.id)
        .limit(1);
      if (owned && owned.length > 0) grants.inbox = 'edit';
    }
  }

  // Centre-scope dimension (migrations/015). Fail-safe: if the columns aren't present
  // yet (pre-015 deploy), default to the safe own_center / no-centre and don't break /me.
  let scope: 'all_centers' | 'own_center' = 'own_center';
  let centreId: string | null = null;
  let centreName: string | null = null;
  if (supabaseAdmin) {
    const { data: vol, error: volErr } = await supabaseAdmin
      .from('volunteers')
      .select('scope, centre_id, centre:centres ( name_cn, name_en )')
      .eq('id', volunteer.id)
      .maybeSingle();
    if (volErr) {
      console.error('[dashboard/me] scope lookup failed (defaulting own_center):', volErr);
    } else if (vol) {
      if (vol.scope === 'all_centers' || vol.scope === 'own_center') scope = vol.scope;
      centreId = (vol.centre_id as string | null) ?? null;
      const centre = Array.isArray(vol.centre) ? vol.centre[0] : vol.centre;
      centreName = (centre?.name_cn as string | undefined) ?? null;
    }
  }

  return NextResponse.json({
    email: volunteer.email,
    displayName: volunteer.display_name,
    role: volunteer.role,
    active: volunteer.active,
    mustChangePassword: volunteer.must_change_password,
    grants,
    scope,
    centreId,
    centreName,
  });
}
