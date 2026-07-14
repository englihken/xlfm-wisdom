// src/app/api/dashboard/me/change-password/route.ts
// A volunteer sets their own new password (used by the forced first-login gate,
// but usable any time). Auth-gated to the logged-in volunteer — they can only
// change their OWN password (user.id from the session, never a body field).
//
// Security audit H2: the caller must PROVE they know the current password before
// the change is applied. We can't read the stored hash, so we probe it — a
// server-side sign-in with the caller's email + the supplied current password on a
// throwaway anon client. The probe is fail-CLOSED: if it can't run or errors, the
// change is refused (a hijacked unlocked session must never convert to a permanent
// account takeover). currentPassword === newPassword is rejected as reuse.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getActiveVolunteer, getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

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

  const body = (await req.json().catch(() => null)) as
    | { currentPassword?: unknown; newPassword?: unknown }
    | null;
  const currentPassword = body && typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = body && typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!currentPassword) {
    return NextResponse.json({ error: '请输入当前密码' }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: '密码至少需要 8 位' }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: '新密码不能与当前密码相同，请设置一个新的密码' },
      { status: 400 }
    );
  }

  // Verify the CURRENT password (fail-closed): a sign-in probe with the supplied
  // current password must succeed before anything changes.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error('[change-password] anon client unavailable — refusing change (fail closed)');
    return NextResponse.json({ error: '暂时无法验证密码，请稍后再试' }, { status: 503 });
  }
  try {
    const probe = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await probe.auth.signInWithPassword({
      email: access.volunteer.email,
      password: currentPassword,
    });
    if (error || !data?.user) {
      return NextResponse.json({ error: '当前密码不正确' }, { status: 400 });
    }
  } catch (e) {
    console.error('[change-password] current-password check errored — refusing change:', e);
    return NextResponse.json({ error: '暂时无法验证密码，请稍后再试' }, { status: 503 });
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

  // Credential rotation leaves a trace (security audit M3). Never the password
  // itself — just who/when.
  await writeAudit({
    actorId: access.volunteer.id,
    actorEmail: access.volunteer.email,
    module: 'settings',
    action: 'password_changed',
    tableName: 'volunteers',
    recordId: access.volunteer.id,
    after: { self: true },
  });

  return NextResponse.json({ ok: true });
}
