// src/app/api/dashboard/outreach/milestones/[id]/route.ts
// PATCH  (outreach:edit) — edit a milestone's happened_on / note / event_id (a wrong date is
//   easily fixed). Audited (outreach.milestone_update).
// DELETE (outreach:edit) — remove a mis-tapped milestone. REJECTS deleting first_contact (every
//   person keeps their arrival on the ledger; edit its date instead). Audited
//   (outreach.milestone_delete).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { outreachScope, scopeAllowsContact, type VolunteerScopeRow } from '@/lib/outreach-scope';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A locked account may only touch milestones on its own centre's contacts.
// PERF: takes the request's already-fetched volunteer row (no volunteers re-read).
async function inScope(volunteer: VolunteerScopeRow, contactId: string): Promise<boolean> {
  const db = supabaseAdmin!;
  const scope = outreachScope(volunteer);
  if (!scope.locked) return true;
  const { data: ct } = await db.from('contacts').select('centre_id').eq('id', contactId).maybeSingle();
  return scopeAllowsContact(scope, (ct as { centre_id: string | null } | null)?.centre_id ?? null);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('outreach', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { data: before } = await supabaseAdmin.from('contact_milestones').select('id, contact_id, milestone, happened_on, event_id, note').eq('id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  if (!(await inScope(access.volunteer, before.contact_id))) return NextResponse.json({ error: '记录不存在' }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if ('happened_on' in body) {
    if (typeof body.happened_on !== 'string' || !DATE_RE.test(body.happened_on)) return NextResponse.json({ error: '日期无效' }, { status: 400 });
    patch.happened_on = body.happened_on;
  }
  if ('note' in body) patch.note = typeof body.note === 'string' ? body.note.trim() || null : null;
  if ('event_id' in body) {
    const ev = body.event_id;
    if (ev === null || ev === '') patch.event_id = null;
    else if (typeof ev === 'string') {
      const { data: e } = await supabaseAdmin.from('events').select('id').eq('id', ev).maybeSingle();
      if (!e) return NextResponse.json({ error: '关联活动无效' }, { status: 400 });
      patch.event_id = ev;
    }
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });

  const { data: updated, error: updErr } = await supabaseAdmin.from('contact_milestones').update(patch).eq('id', id).select('id, milestone, happened_on, event_id, note').single();
  if (updErr || !updated) {
    console.error('[outreach/milestones/:id] update failed:', updErr);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }

  const me = access.volunteer;
  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'outreach',
    action: 'outreach.milestone_update',
    tableName: 'contact_milestones',
    recordId: id,
    before,
    after: patch,
  });

  return NextResponse.json({ milestone: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('outreach', 'edit');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const { data: row } = await supabaseAdmin.from('contact_milestones').select('id, contact_id, milestone').eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  if (!(await inScope(access.volunteer, row.contact_id))) return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  if (row.milestone === 'first_contact') return NextResponse.json({ error: '「初次接触」不可删除（可改日期）' }, { status: 400 });

  const { error: delErr } = await supabaseAdmin.from('contact_milestones').delete().eq('id', id);
  if (delErr) {
    console.error('[outreach/milestones/:id] delete failed:', delErr);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }

  const me = access.volunteer;
  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'outreach',
    action: 'outreach.milestone_delete',
    tableName: 'contact_milestones',
    recordId: id,
    before: row,
  });

  return NextResponse.json({ ok: true });
}
