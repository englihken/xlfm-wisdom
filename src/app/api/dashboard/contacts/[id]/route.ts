// src/app/api/dashboard/contacts/[id]/route.ts
// PATCH a contact's volunteer-editable profile fields (stage / notes). This is
// the dashboard's first WRITE. It uses the SAME two-layer security pattern as the
// read routes: Layer 1 verifies a logged-in volunteer (getAuthenticatedUser →
// 401), then the write goes through the service-role client (supabaseAdmin), which
// bypasses RLS. The browser never writes to Supabase directly.
//
// RLS note: volunteers have SELECT-only policies (migrations/004) and NO write
// access via the anon key. That is intentional — this auth-gated server route is
// the only path that writes, so we deliberately do NOT add volunteer write RLS
// policies. Writes stay server-side only (more secure).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { STAGE_KEYS } from '@/lib/outreach';

export const runtime = 'nodejs';

// Allowed 修行阶段 values — E3 stage-vocab unification (brief §4): WRITES now
// use the canonical stage KEYS (aligned with the milestone ladder in
// lib/outreach). Legacy Chinese rows stay readable via stageLabel on the
// client; the architect's migration 033 rewrites stored data later. The DB
// column default is deliberately untouched here.
const ALLOWED_STAGES: readonly string[] = STAGE_KEYS;

type ContactUpdate = { stage?: string; notes?: string };

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Layer 1: require an ACTIVE volunteer. Distinguish 401 (no session) from
  // 403 (logged in, but not an active volunteer row).
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

  try {
    const body = (await req.json().catch(() => null)) as ContactUpdate | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Build the update from only the provided fields, so an absent field is left
    // untouched (e.g. saving stage must not clear notes).
    const update: { stage?: string; notes?: string } = {};

    if (body.stage !== undefined) {
      if (typeof body.stage !== 'string' || !ALLOWED_STAGES.includes(body.stage)) {
        return NextResponse.json({ error: 'Invalid stage' }, { status: 400 });
      }
      update.stage = body.stage;
    }

    if (body.notes !== undefined) {
      if (typeof body.notes !== 'string') {
        return NextResponse.json({ error: 'Invalid notes' }, { status: 400 });
      }
      // Free text; trim, allow empty string (volunteers can clear it).
      update.notes = body.notes.trim();
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Update only the provided fields. last_seen is left alone — that tracks
    // contact activity, not volunteer edits.
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .update(update)
      .eq('id', id)
      .select('id, stage, notes')
      .maybeSingle();

    if (error) {
      console.error('[dashboard] contact update failed:', error);
      return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ contact: data });
  } catch (err) {
    console.error('[dashboard] contact update error:', err);
    return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 });
  }
}
