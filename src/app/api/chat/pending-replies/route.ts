// src/app/api/chat/pending-replies/route.ts
// PUBLIC endpoint (no volunteer auth) — 教义护栏 brief §7 「义工的更正要能送到访客
// 手上」. A volunteer who answers in the inbox reaches the visitor only while the
// visitor still has THAT conversation open (/qa polls /api/chat/updates for the
// current conversationId). Once the page is closed, the next visit starts a new
// conversation and the volunteer's message is never seen — the 09-24 doctrine
// corrections (ff422e0a: a student with no contact details) would be lost.
//
// Returns, for this browser, the volunteer messages from the last 30 days that
// arrived AFTER the visitor's last message in their conversation (i.e. the
// visitor has not been back in that thread since) — the newest one per
// conversation — with the conversation's first visitor line (≤ 40 chars) so the
// card can say which question it answers. No volunteer identities, no other
// messages.
//
// SECURITY: same model as /api/chat/updates — only conversations whose contact's
// browser_id equals the caller's browserId are read. An unknown browserId gets an
// empty list (never an error that confirms or denies anything).

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { pendingVolunteerReplies } from '@/lib/pending-replies';

export const runtime = 'nodejs';

const WINDOW_DAYS = 30;
// crypto.randomUUID() in /qa; test harnesses use 'test-suite:…' ids.
const BROWSER_ID_RE = /^[A-Za-z0-9_:.-]{8,128}$/;

export async function GET(req: Request) {
  const browserId = new URL(req.url).searchParams.get('browserId');
  if (!browserId || !BROWSER_ID_RE.test(browserId)) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }
  if (!supabaseAdmin) return NextResponse.json({ replies: [] });
  const replies = await pendingVolunteerReplies(browserId, WINDOW_DAYS);
  if (replies === null) return NextResponse.json({ error: 'Failed' }, { status: 500 });
  return NextResponse.json({ replies });
}
