// src/app/api/dashboard/outreach/milestones/route.ts
// POST (outreach:edit) — record a milestone on a 结缘人: { contact_id, milestone, happened_on?,
// event_id?, note? }. One row max per (contact, milestone) — a re-tap → 409 已记录过 (friendly,
// not an error). Kindness records: happened_on defaults today. Audited (outreach.milestone_record).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { MILESTONE_KEYS, milestoneLabel } from '@/lib/outreach';
import { outreachScope, scopeAllowsContact } from '@/lib/outreach-scope';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const access = await requireModuleAccess('outreach', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const contactId = typeof body.contact_id === 'string' ? body.contact_id : '';
  if (!contactId) return NextResponse.json({ error: '缺少 contact_id' }, { status: 400 });
  const milestone = typeof body.milestone === 'string' ? body.milestone : '';
  if (!(MILESTONE_KEYS as readonly string[]).includes(milestone)) return NextResponse.json({ error: '里程碑无效' }, { status: 400 });

  const { data: contact } = await supabaseAdmin.from('contacts').select('id, display_name, centre_id').eq('id', contactId).maybeSingle();
  if (!contact) return NextResponse.json({ error: '结缘人不存在' }, { status: 404 });

  // Centre-scope wall: a locked account may only record on its own centre's 善缘.
  const scope = await outreachScope(supabaseAdmin, access.volunteer.id);
  if (!scopeAllowsContact(scope, (contact as { centre_id: string | null }).centre_id)) {
    return NextResponse.json({ error: '结缘人不存在' }, { status: 404 });
  }

  const happenedOn = typeof body.happened_on === 'string' && DATE_RE.test(body.happened_on) ? body.happened_on : new Date().toISOString().slice(0, 10);
  let eventId: string | null = null;
  if (typeof body.event_id === 'string' && body.event_id) {
    const { data: ev } = await supabaseAdmin.from('events').select('id').eq('id', body.event_id).maybeSingle();
    if (!ev) return NextResponse.json({ error: '关联活动无效' }, { status: 400 });
    eventId = body.event_id;
  }
  const note = typeof body.note === 'string' ? body.note.trim() || null : null;

  const me = access.volunteer;
  const { data: row, error: insErr } = await supabaseAdmin
    .from('contact_milestones')
    .insert({ contact_id: contactId, milestone, happened_on: happenedOn, event_id: eventId, note, noted_by: me.id })
    .select('id, milestone, happened_on, event_id, note')
    .single();
  if (insErr || !row) {
    if (insErr?.code === '23505') return NextResponse.json({ error: `已记录过「${milestoneLabel(milestone)}」` }, { status: 409 });
    console.error('[outreach/milestones] insert failed:', insErr);
    return NextResponse.json({ error: '记录失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'outreach',
    action: 'outreach.milestone_record',
    tableName: 'contact_milestones',
    recordId: (row as unknown as { id: string }).id,
    after: { contact_id: contactId, milestone, happened_on: happenedOn },
  });

  return NextResponse.json({ milestone: row }, { status: 201 });
}
