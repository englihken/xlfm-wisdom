// src/app/api/dashboard/me/change-password/route.ts
// A volunteer sets their own new password (used by the forced first-login gate,
// but usable any time). Auth-gated to the logged-in volunteer — they can only
// change their OWN password (user.id from the session, never a body field).
//
// Guard: reject reusing the CURRENT password. We can't read the stored hash, so we
// probe it — attempt a server-side sign-in with the caller's email + the proposed
// password using a throwaway anon client. If that sign-in succeeds, the "new"
// password equals the current one → reject. The probe is fail-OPEN: if the check
// itself errors, we proceed with the update (we never block a legitimate change on
// a flaky check — but we DO block on a definite match).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getActiveVolunteer, getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const access = await getActiveVolunteer();
  if (!access) {
    const user = await getAuthenticatedUser();
    return NextResponse.json(
      { error: user ? 'Not an active volunteer' : 'Unauthorized' },
      { status: user ? 403 : 401 }
    );
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as { newPassword?: unknown } | null;
  const newPassword = body && typeof body.newPassword === 'string' ? body.newPassword : '';
  if (newPassword.length < 8) {
    return NextResponse.json({ error: '密码至少需要 8 位' }, { status: 400 });
  }

  // Reject reusing the current password (fail-open on the check itself).
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && anonKey) {
      const probe = createClient(url, anonKey, { auth: { persistSession: false } });
      const { data, error } = await probe.auth.signInWithPassword({
        email: access.volunteer.email,
        password: newPassword,
      });
      if (!error && data?.user) {
        return NextResponse.json(
          { error: '新密码不能与初始密码相同，请设置一个新的密码' },
          { status: 400 }
        );
      }
    }
  } catch (e) {
    console.error('[change-password] reuse check errored — proceeding:', e);
  }

  // Apply the new password to the auth account.
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(access.user.id, {
    password: newPassword,
  });
  if (updateError) {
    console.error('[change-password] password update failed:', updateError);
    return NextResponse.json({ error: '设置密码失败，请重试' }, { status: 400 });
  }

  // Only after the password actually changed, clear the forced-change flag. If this
  // write fails, the password IS changed but the gate may show again next login —
  // acceptable (they can set a different password), so we just log it.
  const { error: flagError } = await supabaseAdmin
    .from('volunteers')
    .update({ must_change_password: false })
    .eq('id', access.user.id);
  if (flagError) {
    console.error('[change-password] clearing must_change_password failed:', flagError);
  }

  return NextResponse.json({ ok: true });
}
