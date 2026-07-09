// src/app/api/dashboard/inventory/share-links/route.ts
// GET  — list read-only 库存表 share links (inventory:view): token, label, active, created_at.
// POST — mint a link (inventory:admin): { label? }. token = crypto-random base64url (24 chars,
//        same style as event public_token but longer). Audited.

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const SELECT = 'id, token, label, is_active, created_at';

export async function GET() {
  const access = await requireModuleAccess('inventory', 'view');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { data, error } = await supabaseAdmin.from('inventory_share_links').select(SELECT).order('created_at', { ascending: false });
  if (error) {
    console.error('[inventory/share-links] list failed:', error);
    return NextResponse.json({ error: 'Failed to load links' }, { status: 500 });
  }
  return NextResponse.json({ links: data ?? [] });
}

export async function POST(req: Request) {
  const access = await requireModuleAccess('inventory', 'admin');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim() : null;
  const token = randomBytes(18).toString('base64url'); // 24 urlsafe chars

  const me = access.volunteer;
  const { data: link, error } = await supabaseAdmin
    .from('inventory_share_links')
    .insert({ token, label, created_by: me.id })
    .select(SELECT)
    .single();
  if (error || !link) {
    console.error('[inventory/share-links] create failed:', error);
    return NextResponse.json({ error: '创建链接失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: 'create',
    tableName: 'inventory_share_links',
    recordId: (link as unknown as { id: string }).id,
    after: { label },
  });

  return NextResponse.json({ link }, { status: 201 });
}
