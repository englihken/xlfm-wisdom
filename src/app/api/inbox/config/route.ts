// src/app/api/inbox/config/route.ts
// GET / PATCH the org-wide inbox settings: escalation thresholds + crisis keywords
// (org_settings). Access: settings ≥ edit. Audits module='inbox' action='settings_updated'.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { loadEscalation, loadCrisisKeywords } from '@/lib/inbox-server';

export const runtime = 'nodejs';

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

export async function GET() {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const [escalation, crisis_keywords] = await Promise.all([loadEscalation(supabaseAdmin), loadCrisisKeywords(supabaseAdmin)]);
  return NextResponse.json({ escalation, crisis_keywords });
}

export async function PATCH(req: Request) {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const me = access.volunteer;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const nowIso = new Date().toISOString();
  const after: Record<string, unknown> = {};

  if (body.escalation && typeof body.escalation === 'object') {
    const e = body.escalation as Record<string, unknown>;
    const remind = Number(e.remind_centre_days);
    const surface = Number(e.surface_hq_days);
    if (!Number.isFinite(remind) || !Number.isFinite(surface) || remind < 1 || surface < 1) {
      return NextResponse.json({ error: '天数必须是正整数' }, { status: 400 });
    }
    const value = { remind_centre_days: Math.round(remind), surface_hq_days: Math.round(surface) };
    await supabaseAdmin.from('org_settings').upsert({ key: 'inbox.escalation', value, updated_by: me.id, updated_at: nowIso });
    after.escalation = value;
  }

  if (Array.isArray(body.crisis_keywords)) {
    const kws = (body.crisis_keywords as unknown[]).map((k) => String(k).trim()).filter(Boolean);
    await supabaseAdmin.from('org_settings').upsert({ key: 'inbox.crisis_keywords', value: kws, updated_by: me.id, updated_at: nowIso });
    after.crisis_keywords = kws;
  }

  if (Object.keys(after).length === 0) return NextResponse.json({ ok: true, unchanged: true });

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inbox',
    action: 'settings_updated',
    tableName: 'org_settings',
    recordId: 'inbox',
    after,
  });
  return NextResponse.json({ ok: true, ...after });
}
