// src/app/api/inbox/mailboxes/[id]/owners/route.ts
// PUT the full owner set for a mailbox (from the 收件箱配置 multi-select). Diffs against the
// current owners and audits each add/remove. Access: settings ≥ edit.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const me = access.volunteer;
  const { id } = await params;

  const { data: mb } = await supabaseAdmin.from('inbox_mailboxes').select('id').eq('id', id).maybeSingle();
  if (!mb) return NextResponse.json({ error: '不存在' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { volunteer_ids?: unknown } | null;
  if (!body || !Array.isArray(body.volunteer_ids)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const desired = new Set((body.volunteer_ids as unknown[]).map(String));

  const { data: currentRows } = await supabaseAdmin.from('inbox_mailbox_owners').select('volunteer_id').eq('mailbox_id', id);
  const current = new Set((currentRows ?? []).map((r) => r.volunteer_id as string));

  const toAdd = [...desired].filter((v) => !current.has(v));
  const toRemove = [...current].filter((v) => !desired.has(v));

  if (toAdd.length > 0) {
    // validate the ids are real volunteers
    const { data: vs } = await supabaseAdmin.from('volunteers').select('id').in('id', toAdd);
    const valid = new Set((vs ?? []).map((v) => v.id as string));
    const rows = toAdd.filter((v) => valid.has(v)).map((v) => ({ mailbox_id: id, volunteer_id: v, added_by: me.id }));
    if (rows.length > 0) await supabaseAdmin.from('inbox_mailbox_owners').insert(rows);
    for (const v of rows.map((r) => r.volunteer_id)) {
      await writeAudit({ actorId: me.id, actorEmail: me.email, module: 'inbox', action: 'owner_added', tableName: 'inbox_mailbox_owners', recordId: id, after: { mailbox_id: id, volunteer_id: v } });
    }
  }
  if (toRemove.length > 0) {
    await supabaseAdmin.from('inbox_mailbox_owners').delete().eq('mailbox_id', id).in('volunteer_id', toRemove);
    for (const v of toRemove) {
      await writeAudit({ actorId: me.id, actorEmail: me.email, module: 'inbox', action: 'owner_removed', tableName: 'inbox_mailbox_owners', recordId: id, before: { mailbox_id: id, volunteer_id: v } });
    }
  }

  return NextResponse.json({ ok: true, added: toAdd.length, removed: toRemove.length });
}
