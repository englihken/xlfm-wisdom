// src/app/api/dashboard/conversations/[id]/read/route.ts
// POST — mark a conversation as read by the calling volunteer (called when the
// inbox opens a conversation). Upserts conversation_reads.last_read_at = now() for
// this volunteer+conversation. Auth-gated, then written via the service-role
// client, same as the other dashboard routes.

import { NextResponse } from 'next/server';
import { getActiveVolunteer, getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await getActiveVolunteer();
  if (!access) {
    const user = await getAuthenticatedUser();
    return NextResponse.json(
      { error: user ? 'Not an active volunteer' : 'Unauthorized' },
      { status: user ? 403 : 401 }
    );
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  const { error } = await supabaseAdmin.from('conversation_reads').upsert(
    {
      volunteer_id: access.volunteer.id,
      conversation_id: id,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: 'volunteer_id,conversation_id' }
  );

  if (error) {
    console.error('[dashboard] mark-read upsert failed:', error);
    return NextResponse.json({ error: 'Failed to mark read' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
