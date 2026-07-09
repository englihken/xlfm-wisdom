// src/app/api/dashboard/inventory/share-links/[id]/route.ts
// PATCH — revoke a share link (inventory:admin): body { is_active: false }. A revoked link's
// public page 404s immediately. (Re-activation is allowed too, for symmetry.) Audited.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireModuleAccess('inventory', 'admin');
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body?.is_active !== 'boolean') return NextResponse.json({ error: '缺少 is_active' }, { status: 400 });

  const { data: link, error } = await supabaseAdmin
    .from('inventory_share_links')
    .update({ is_active: body.is_active })
    .eq('id', id)
    .select('id, token, label, is_active, created_at')
    .single();
  if (error || !link) {
    console.error('[inventory/share-links/:id] update failed:', error);
    return NextResponse.json({ error: '操作失败' }, { status: 500 });
  }

  const me = access.volunteer;
  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'inventory',
    action: body.is_active ? 'reactivate' : 'deactivate',
    tableName: 'inventory_share_links',
    recordId: id,
    after: { is_active: body.is_active },
  });

  return NextResponse.json({ link });
}
