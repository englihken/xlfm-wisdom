// src/app/api/inbox/mailboxes/route.ts
// GET every mailbox for the 收件箱配置 table (centre, enabled, auto-reply, owners).
// Access: settings ≥ edit.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { ownersByMailbox } from '@/lib/inbox-server';

export const runtime = 'nodejs';

export async function GET() {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { data: mbs } = await supabaseAdmin
    .from('inbox_mailboxes')
    .select('id, centre_id, is_enabled, auto_reply_enabled, auto_reply_text, centre:centres!centre_id ( name_cn, code, sort, is_active )');
  const rows = mbs ?? [];
  const owners = await ownersByMailbox(supabaseAdmin, rows.map((m) => m.id as string));

  const out = rows
    .map((m) => {
      const c = Array.isArray(m.centre) ? m.centre[0] : m.centre;
      return {
        id: m.id as string,
        centre_id: m.centre_id as string,
        centre_name: (c?.name_cn as string) ?? '—',
        centre_code: (c?.code as string) ?? '',
        centre_active: (c?.is_active as boolean) ?? true,
        centre_sort: (c?.sort as number) ?? 0,
        is_enabled: m.is_enabled as boolean,
        auto_reply_enabled: m.auto_reply_enabled as boolean,
        auto_reply_text: (m.auto_reply_text as string | null) ?? null,
        owners: owners.get(m.id as string) ?? [],
      };
    })
    .sort((a, b) => a.centre_sort - b.centre_sort || a.centre_name.localeCompare(b.centre_name));

  return NextResponse.json({ mailboxes: out });
}
