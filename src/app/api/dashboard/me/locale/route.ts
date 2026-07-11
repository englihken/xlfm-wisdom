// src/app/api/dashboard/me/locale/route.ts
// PATCH { locale } — set the signed-in volunteer's OWN UI language preference
// (volunteers.locale, migration 034: zh|en|id). Self-only, like change-password:
// there is no target id, it always writes the caller's own row. A personal display
// preference — no audit trail. The client also mirrors the choice into the
// NEXT_LOCALE cookie for SSR; this endpoint makes it survive logout/login.

import { NextResponse } from 'next/server';
import { getActiveVolunteer, getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isLocale } from '@/lib/i18n';

export const runtime = 'nodejs';

export async function PATCH(req: Request) {
  const access = await getActiveVolunteer();
  if (!access) {
    const user = await getAuthenticatedUser();
    return NextResponse.json({ error: user ? 'Forbidden' : 'Unauthorized' }, { status: user ? 403 : 401 });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const locale = body?.locale;
  if (!isLocale(locale)) return NextResponse.json({ error: 'Invalid locale' }, { status: 400 });

  const { error } = await supabaseAdmin.from('volunteers').update({ locale }).eq('id', access.volunteer.id);
  if (error) {
    console.error('[me/locale] update failed:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, locale });
}
