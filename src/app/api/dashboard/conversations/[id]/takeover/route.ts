// src/app/api/dashboard/conversations/[id]/takeover/route.ts
// POST — a volunteer takes over a conversation from the AI (the rare safety valve).
// Sets status='volunteer_handling' and assigned_volunteer = the caller. Refuses to
// silently steal a conversation someone else is already handling (409 with their
// name). Taking over one you already hold is idempotent (200).
//
// Takeover ALSO refreshes the contact's rolling 有缘人档案 + this conversation's
// gist on the spot (one Claude call, ~5s) so the volunteer reaches out with a
// CURRENT picture — not whatever the nightly cron last saw. Best-effort: if the
// model call fails, the takeover itself still succeeds.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshContactSummaries } from '@/lib/care-summary';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const maxDuration = 60; // headroom for the synchronous summary refresh

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
    .select('id, status, assigned_volunteer, contact_id')
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

  // Taking over a seeker's conversation leaves a trace (security audit M3).
  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'care',
    action: 'care.takeover',
    tableName: 'conversations',
    recordId: id,
    before: { status: conv.status, assigned_volunteer: conv.assigned_volunteer },
    after: { status: 'volunteer_handling', assigned_volunteer: me.id },
  });

  // On-demand summary refresh: fold this contact's pending conversations (this one
  // included, forced) into the rolling profile and gist them, RIGHT NOW. Awaited so
  // the response can hand the fresh profile + gist straight to the panel — but any
  // failure is logged and swallowed: a takeover must never fail on a summary.
  let contactSummary: string | null = null;
  let conversationSummary: string | null = null;
  let profileUpdatedAt: string | null = null;
  if (conv.contact_id) {
    try {
      const refresh = await refreshContactSummaries(supabaseAdmin, conv.contact_id, {
        forceConversationId: id,
      });
      contactSummary = refresh.profile;
      conversationSummary = refresh.gists.get(id) ?? null;
      profileUpdatedAt = refresh.profileUpdatedAt;
    } catch (e) {
      console.error(`[dashboard] takeover summary refresh failed for conversation ${id}:`, e);
    }
  }

  return NextResponse.json({
    ok: true,
    status: 'volunteer_handling',
    assignedTo: me.display_name,
    // Fresh summaries (null = refresh unavailable; the panel keeps what it had).
    contactSummary,
    conversationSummary,
    profileUpdatedAt,
  });
}
