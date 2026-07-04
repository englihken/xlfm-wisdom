// src/app/api/dashboard/conversations/[id]/takeover/route.ts
// POST — a volunteer takes over a conversation from the AI (the rare safety valve).
// Sets status='volunteer_handling' and assigned_volunteer = the caller. Refuses to
// silently steal a conversation someone else is already handling (409 with their
// name). Taking over one you already hold is idempotent (200).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireModuleAccess('care', 'edit');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  const me = access.volunteer;

  const { data: conv, error: convError } = await supabaseAdmin
    .from('conversations')
    .select('id, status, assigned_volunteer')
    .eq('id', id)
    .maybeSingle();
  if (convError) {
    console.error('[dashboard] takeover conversation fetch failed:', convError);
    return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Already handled by someone else → refuse (no silent steals). Handled by me →
  // idempotent success.
  if (conv.status === 'volunteer_handling' && conv.assigned_volunteer !== me.id) {
    let assignedTo = '另一位义工';
    const { data: owner } = await supabaseAdmin
      .from('volunteers')
      .select('display_name')
      .eq('id', conv.assigned_volunteer)
      .maybeSingle();
    if (owner?.display_name) assignedTo = owner.display_name;
    return NextResponse.json(
      { error: '此对话已被接手', assignedTo },
      { status: 409 }
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from('conversations')
    .update({ status: 'volunteer_handling', assigned_volunteer: me.id })
    .eq('id', id);
  if (updateError) {
    console.error('[dashboard] takeover update failed:', updateError);
    return NextResponse.json({ error: 'Failed to take over' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    status: 'volunteer_handling',
    assignedTo: me.display_name,
  });
}
