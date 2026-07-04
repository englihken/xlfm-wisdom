// src/app/api/dashboard/conversations/[id]/handback/route.ts
// POST — hand a conversation back to the AI. Only the assigned volunteer or an
// admin may do this (no one yanking a colleague's active conversation out from
// under them). Sets status='ai_handling', assigned_volunteer=null; the AI resumes
// silently on the visitor's next message.

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

  const me = access.volunteer;

  const { data: conv, error: convError } = await supabaseAdmin
    .from('conversations')
    .select('id, assigned_volunteer')
    .eq('id', id)
    .maybeSingle();
  if (convError) {
    console.error('[dashboard] handback conversation fetch failed:', convError);
    return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const isAssignee = conv.assigned_volunteer === me.id;
  const isAdmin = me.role === 'admin';
  if (!isAssignee && !isAdmin) {
    return NextResponse.json({ error: '只有接手的义工或管理员可以交回' }, { status: 403 });
  }

  const { error: updateError } = await supabaseAdmin
    .from('conversations')
    .update({ status: 'ai_handling', assigned_volunteer: null })
    .eq('id', id);
  if (updateError) {
    console.error('[dashboard] handback update failed:', updateError);
    return NextResponse.json({ error: 'Failed to hand back' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: 'ai_handling' });
}
