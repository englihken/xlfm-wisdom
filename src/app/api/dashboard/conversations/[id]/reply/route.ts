// src/app/api/dashboard/conversations/[id]/reply/route.ts
// POST { text } — the assigned volunteer sends a human reply into a taken-over
// conversation. Stored as messages(role='volunteer', sent_by=caller). Delivery
// depends on channel:
//   web       → just stored; the visitor's /qa page polls it in (PART 3).
//   whatsapp  → sent via the Cloud API (sendWhatsAppText; a no-op "simulated" send
//               when creds are absent). BUT WhatsApp only permits free-text within
//               24h of the user's last inbound message — if that window has closed
//               we store NOTHING, send NOTHING, and return { windowExpired: true }
//               so the UI can explain (templated messages come later with Campaigns).
// Guardrails: only the assigned volunteer of a volunteer_handling conversation may
// reply (403 otherwise — no drive-by messages into someone else's conversation).

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendWhatsAppText } from '@/lib/whatsapp';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const MAX_LEN = 2000;
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

type ContactLite = { wa_id: string | null };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  // Validate body.
  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return NextResponse.json({ error: '回复内容不能为空' }, { status: 400 });
  }
  if (text.length > MAX_LEN) {
    return NextResponse.json({ error: `回复过长（上限 ${MAX_LEN} 字）` }, { status: 400 });
  }

  // Load the conversation + contact wa_id, and confirm the caller owns it.
  const { data: conv, error: convError } = await supabaseAdmin
    .from('conversations')
    .select('id, channel, status, assigned_volunteer, contact:contacts ( wa_id )')
    .eq('id', id)
    .maybeSingle();
  if (convError) {
    console.error('[dashboard] reply conversation fetch failed:', convError);
    return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Only the assigned volunteer of a volunteer_handling conversation may reply.
  if (conv.status !== 'volunteer_handling' || conv.assigned_volunteer !== me.id) {
    return NextResponse.json({ error: '只有接手此对话的义工可以回复' }, { status: 403 });
  }

  const rawContact = (conv as { contact: ContactLite | ContactLite[] | null }).contact;
  const contact = Array.isArray(rawContact) ? rawContact[0] ?? null : rawContact;

  // WhatsApp 24h free-text window: if the user's last inbound is older than 24h (or
  // there is none), we can't send free text — store nothing, send nothing, warn.
  if (conv.channel === 'whatsapp') {
    const { data: lastUser } = await supabaseAdmin
      .from('messages')
      .select('created_at')
      .eq('conversation_id', id)
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastUserMs = lastUser?.created_at ? new Date(lastUser.created_at).getTime() : 0;
    if (!lastUserMs || Date.now() - lastUserMs > WHATSAPP_WINDOW_MS) {
      return NextResponse.json({ windowExpired: true });
    }
  }

  // Persist the human reply (attributed).
  const nowIso = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('messages')
    .insert({ conversation_id: id, role: 'volunteer', content: text, sent_by: me.id })
    .select('id, role, content, sources, created_at, sent_by')
    .single();
  if (insertError || !inserted) {
    console.error('[dashboard] reply insert failed:', insertError);
    return NextResponse.json({ error: '发送失败，请重试' }, { status: 500 });
  }

  await supabaseAdmin.from('conversations').update({ last_message_at: nowIso }).eq('id', id);

  // Deliver on WhatsApp (simulated when creds absent — still counts as stored).
  let simulated = false;
  if (conv.channel === 'whatsapp' && contact?.wa_id) {
    const result = await sendWhatsAppText(contact.wa_id, text);
    simulated = Boolean(result.simulated);
  }

  // An outbound reply to the public leaves a trace (security audit M3). Message
  // content is already stored on the messages row — the audit records who/when/where.
  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'care',
    action: 'care.reply',
    tableName: 'messages',
    recordId: inserted.id as string,
    after: { conversation_id: id, channel: conv.channel, length: text.length },
  });

  return NextResponse.json({
    ok: true,
    simulated,
    message: { ...inserted, sentByName: me.display_name },
  });
}
