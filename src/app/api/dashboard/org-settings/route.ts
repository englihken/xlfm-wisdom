// src/app/api/dashboard/org-settings/route.ts
// Generic org_settings access for the E3 设置 sections, with a HARD key
// allowlist (brief §3) — anything off-list 400s, so this can never become a
// free-form settings backdoor. Gate: settings ≥ edit (admin + erp_admin).
//   GET   → { values: { key: value } } for every allowlisted key present.
//   PATCH → { values: { key: value } } upserts allowlisted keys (validated per
//           kind) and audits module='settings' action='settings_updated' with
//           before/after per key.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { ORG_SETTING_ALLOWLIST } from '@/lib/org-settings';

export const runtime = 'nodejs';

const KEYS = Object.keys(ORG_SETTING_ALLOWLIST);

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

export async function GET() {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { data, error } = await supabaseAdmin.from('org_settings').select('key, value').in('key', KEYS);
  if (error) {
    console.error('[org-settings] read failed:', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
  const values: Record<string, unknown> = {};
  for (const row of data ?? []) values[row.key as string] = row.value;
  return NextResponse.json({ values });
}

function validate(kind: (typeof ORG_SETTING_ALLOWLIST)[string], value: unknown): boolean {
  switch (kind) {
    case 'string_array':
      return Array.isArray(value) && value.every((x) => typeof x === 'string' && x.trim().length > 0) && value.length > 0;
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 3650;
    case 'string':
      return typeof value === 'string' && value.length <= 2000;
  }
}

export async function PATCH(req: Request) {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { values?: Record<string, unknown> } | null;
  const values = body?.values;
  if (!values || typeof values !== 'object' || Object.keys(values).length === 0) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Validate EVERYTHING first — a partial write on a bad batch would be worse
  // than rejecting it whole.
  for (const [key, value] of Object.entries(values)) {
    const kind = ORG_SETTING_ALLOWLIST[key];
    if (!kind) return NextResponse.json({ error: `不允许的设置键：${key}` }, { status: 400 });
    if (!validate(kind, value)) return NextResponse.json({ error: `设置值无效：${key}` }, { status: 400 });
  }

  const me = access.volunteer;
  const nowIso = new Date().toISOString();

  const { data: beforeRows, error: beforeErr } = await supabaseAdmin
    .from('org_settings')
    .select('key, value')
    .in('key', Object.keys(values));
  if (beforeErr) console.error('[org-settings] before-read failed:', beforeErr);
  const before = new Map((beforeRows ?? []).map((r) => [r.key as string, r.value]));

  for (const [key, value] of Object.entries(values)) {
    const { error } = await supabaseAdmin
      .from('org_settings')
      .upsert({ key, value, updated_by: me.id, updated_at: nowIso }, { onConflict: 'key' });
    if (error) {
      console.error(`[org-settings] upsert ${key} failed:`, error);
      return NextResponse.json({ error: `保存失败：${key}` }, { status: 500 });
    }
    await writeAudit({
      actorId: me.id,
      actorEmail: me.email,
      module: 'settings',
      action: 'settings_updated',
      tableName: 'org_settings',
      recordId: key,
      before: { value: before.get(key) ?? null },
      after: { value },
    });
  }

  return NextResponse.json({ ok: true });
}
