// src/app/api/inbox/notify/route.ts
// GET the opt-in 通知名单 — contacts with notify_opt_in=true (name, phone, centre, opted-at,
// note). Read-only list; per-contact toggle lives at [contactId]. Access: settings ≥ edit.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { data } = await supabaseAdmin
    .from('contacts')
    .select('id, display_name, phone, notify_opt_in_at, notify_opt_in_note, centre:centres!centre_id ( name_cn )')
    .eq('notify_opt_in', true)
    .order('notify_opt_in_at', { ascending: false });

  const out = (data ?? []).map((c) => {
    const centre = Array.isArray(c.centre) ? c.centre[0] : c.centre;
    return {
      id: c.id as string,
      display_name: (c.display_name as string | null) ?? '—',
      phone: (c.phone as string | null) ?? null,
      centre_name: (centre?.name_cn as string) ?? null,
      opted_at: (c.notify_opt_in_at as string | null) ?? null,
      note: (c.notify_opt_in_note as string | null) ?? null,
    };
  });
  return NextResponse.json({ contacts: out });
}
