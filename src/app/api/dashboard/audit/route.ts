// src/app/api/dashboard/audit/route.ts
// GET ?module=&action=&actor=&from=&to=&q=&page= — the 审计查看器 (brief §3.2).
// Gate: module 'audit' ≥ view (admin per migration 013). READ-ONLY by design:
// the audit_log is append-only — 只可查、不可改、不可删. 50/page latest-first;
// q searches record_id / actor_email.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const PAGE_SIZE = 50;

export async function GET(req: Request) {
  const access = await requireModuleAccess('audit', 'view');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);

  let q = supabaseAdmin
    .from('audit_log')
    .select('id, at, actor_id, actor_email, module, action, table_name, record_id, before, after', { count: 'exact' });

  const mod = sp.get('module');
  if (mod) q = q.eq('module', mod);
  const action = sp.get('action');
  if (action) q = q.eq('action', action);
  const actor = sp.get('actor');
  if (actor) q = q.ilike('actor_email', `%${actor.replace(/[,.()%*"\\]/g, ' ').trim()}%`);
  const from = sp.get('from');
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) q = q.gte('at', `${from}T00:00:00+08:00`);
  const to = sp.get('to');
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) q = q.lt('at', `${to}T23:59:59.999+08:00`);
  const search = (sp.get('q') ?? '').trim();
  if (search) {
    const safe = search.replace(/[,.()%*"\\]/g, ' ').trim();
    if (safe) q = q.or(`record_id.ilike.%${safe}%,actor_email.ilike.%${safe}%`);
  }

  const fromIdx = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await q.order('id', { ascending: false }).range(fromIdx, fromIdx + PAGE_SIZE - 1);
  if (error) {
    console.error('[dashboard/audit] query failed:', error);
    return NextResponse.json({ error: 'Failed to load audit log' }, { status: 500 });
  }

  return NextResponse.json({
    entries: data ?? [],
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
  });
}
