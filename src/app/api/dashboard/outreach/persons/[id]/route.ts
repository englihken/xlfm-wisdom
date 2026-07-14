// src/app/api/dashboard/outreach/persons/[id]/route.ts
// GET   (outreach:view) — one 渡人卡: the contact + its milestones (ladder order), linked member,
//        source event, centre name, and a has-conversation flag (→ 查看对话 into the care inbox).
// PATCH (outreach:edit) — edit phone / source_type / source_event_id / source_note / centre_id /
//        member_id (null to unlink). NEVER writes contacts.stage (care module owns it). Audited.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { MILESTONE_KEYS, SOURCE_KEYS } from '@/lib/outreach';
import { outreachScope, scopeAllowsContact } from '@/lib/outreach-scope';

export const runtime = 'nodejs';

const CONTACT_SELECT =
  'id, display_name, phone, wa_id, channel, stage, source_type, source_event_id, source_note, centre_id, member_id, first_seen, last_seen';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('outreach', 'view');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const { data: contact, error } = await supabaseAdmin.from('contacts').select(CONTACT_SELECT).eq('id', id).maybeSingle();
  if (error) {
    console.error('[outreach/persons/:id] load failed:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
  if (!contact) return NextResponse.json({ error: '结缘人不存在' }, { status: 404 });

  // Centre-scope wall: a locked account may not read another centre's (or a national) contact.
  const scope = outreachScope(access.volunteer);
  if (!scopeAllowsContact(scope, (contact as { centre_id: string | null }).centre_id)) {
    return NextResponse.json({ error: '结缘人不存在' }, { status: 404 });
  }

  const c = contact as Record<string, unknown>;
  const [{ data: milestones }, convRes, memberRes, eventRes, centreRes] = await Promise.all([
    supabaseAdmin.from('contact_milestones').select('id, milestone, happened_on, event_id, note').eq('contact_id', id),
    supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true }).eq('contact_id', id),
    c.member_id ? supabaseAdmin.from('members').select('id, name_cn, name_en, phone').eq('id', c.member_id as string).maybeSingle() : Promise.resolve({ data: null }),
    c.source_event_id ? supabaseAdmin.from('events').select('id, code, title').eq('id', c.source_event_id as string).maybeSingle() : Promise.resolve({ data: null }),
    c.centre_id ? supabaseAdmin.from('centres').select('id, name_cn').eq('id', c.centre_id as string).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const order = (m: { milestone: string }) => MILESTONE_KEYS.indexOf(m.milestone as (typeof MILESTONE_KEYS)[number]);
  const ms = ((milestones ?? []) as { id: string; milestone: string; happened_on: string; event_id: string | null; note: string | null }[])
    .slice()
    .sort((a, b) => order(a) - order(b));

  return NextResponse.json({
    contact,
    milestones: ms,
    member: memberRes.data ?? null,
    sourceEvent: eventRes.data ?? null,
    centre: centreRes.data ?? null,
    hasConversation: (convRes.count ?? 0) > 0,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('outreach', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { data: before } = await supabaseAdmin.from('contacts').select(CONTACT_SELECT).eq('id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: '结缘人不存在' }, { status: 404 });

  // Centre-scope wall: a locked account may not touch another centre's contact, and its centre
  // picker is pinned to its own centre (any centre_id edit is forced back to it).
  const scope = outreachScope(access.volunteer);
  if (!scopeAllowsContact(scope, (before as { centre_id: string | null }).centre_id)) {
    return NextResponse.json({ error: '结缘人不存在' }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if ('phone' in body) patch.phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
  if ('source_note' in body) patch.source_note = typeof body.source_note === 'string' && body.source_note.trim() ? body.source_note.trim() : null;
  if ('source_type' in body) {
    const s = body.source_type;
    if (s === null || s === '') patch.source_type = null;
    else if (typeof s === 'string' && (SOURCE_KEYS as readonly string[]).includes(s)) patch.source_type = s;
    else return NextResponse.json({ error: '来源无效' }, { status: 400 });
  }
  if ('source_event_id' in body) {
    const ev = body.source_event_id;
    if (ev === null || ev === '') patch.source_event_id = null;
    else if (typeof ev === 'string') {
      const { data: e } = await supabaseAdmin.from('events').select('id').eq('id', ev).maybeSingle();
      if (!e) return NextResponse.json({ error: '关联活动无效' }, { status: 400 });
      patch.source_event_id = ev;
    }
  }
  if ('centre_id' in body) {
    const ce = body.centre_id;
    if (ce === null || ce === '') patch.centre_id = null;
    else if (typeof ce === 'string') {
      const { data: c } = await supabaseAdmin.from('centres').select('id').eq('id', ce).maybeSingle();
      if (!c) return NextResponse.json({ error: '中心无效' }, { status: 400 });
      patch.centre_id = ce;
    }
  }
  if ('member_id' in body) {
    const mid = body.member_id;
    if (mid === null || mid === '') patch.member_id = null;
    else if (typeof mid === 'string') {
      const { data: m } = await supabaseAdmin.from('members').select('id').eq('id', mid).maybeSingle();
      if (!m) return NextResponse.json({ error: '会员无效' }, { status: 400 });
      patch.member_id = mid;
    }
  }

  // Pin a locked account's contacts to its own centre — it can never move one out of scope.
  if (scope.locked && 'centre_id' in body) patch.centre_id = scope.centreId;

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });

  const { data: updated, error: updErr } = await supabaseAdmin.from('contacts').update(patch).eq('id', id).select(CONTACT_SELECT).single();
  if (updErr || !updated) {
    console.error('[outreach/persons/:id] update failed:', updErr);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }

  const me = access.volunteer;
  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'outreach',
    action: 'outreach.person_update',
    tableName: 'contacts',
    recordId: id,
    before: before as Record<string, unknown>,
    after: patch,
  });

  return NextResponse.json({ contact: updated });
}
