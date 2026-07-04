// src/app/api/webhooks/whatsapp/route.ts
// WhatsApp Cloud API webhook. Two jobs:
//   GET  — Meta's verification handshake (echo hub.challenge when the verify token
//          matches). Runs even while the channel is otherwise dormant.
//   POST — inbound message + status notifications. For each inbound TEXT we run the
//          shared care pipeline (RAG reply + persistence + classification) exactly
//          like the web chat, then send the reply back via the Graph API (a no-op
//          "simulated" send when credentials are absent, so the whole flow is
//          testable without live Meta access).
//
// Reliability contract with Meta: this endpoint must ALWAYS return 200 and NEVER
// 500. Meta treats a non-200 as failure and hammers retries. So every step is
// wrapped in try/catch, the DB helpers are fail-safe (never throw), and the top
// level always resolves to 200 { ok: true }. Dedup (via messages.wa_message_id)
// makes those retries — and our own reprocessing — idempotent. All the heavy work
// happens within the handler's lifetime (maxDuration below), not in a detached
// task that a serverless freeze would kill.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendWhatsAppText, formatForWhatsApp } from '@/lib/whatsapp';
import { generateReply, classifyAndSaveCategory, type CareMessage } from '@/lib/care-pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000; // reuse an open convo for 24h
const HISTORY_LIMIT = 20; // prior turns fed back to the model for context
const NON_TEXT_REPLY = '目前我只能阅读文字消息，请用文字告诉我您想聊的 🙏';
const FALLBACK_REPLY = '抱歉，我这边出了点状况，请稍后再发一次消息给我 🙏';

// ── GET: Meta verification handshake ──────────────────────────────────────────
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === 'subscribe' && verifyToken && token === verifyToken) {
    // Meta expects the raw challenge string echoed back with 200.
    return new Response(challenge ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  return new Response('Forbidden', { status: 403 });
}

// ── POST: inbound messages + statuses ─────────────────────────────────────────
export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    // Malformed body — nothing to do, but still 200 so Meta doesn't retry.
    return NextResponse.json({ ok: true });
  }

  try {
    await processWebhook(payload);
  } catch (e) {
    // Absolute backstop: never surface a 500 to Meta.
    console.error('[wa] webhook processing failed:', e);
  }

  return NextResponse.json({ ok: true });
}

// ── Payload walking ───────────────────────────────────────────────────────────
// Meta's shape: { entry: [ { changes: [ { value: { messages?, statuses?, contacts? } } ] } ] }

type WaProfile = { name?: string };
type WaContact = { profile?: WaProfile; wa_id?: string };
type WaText = { body?: string };
type WaMessage = { from?: string; id?: string; type?: string; text?: WaText };
type WaStatus = { id?: string; status?: string };
type WaValue = { messages?: WaMessage[]; statuses?: WaStatus[]; contacts?: WaContact[] };
type WaChange = { value?: WaValue };
type WaEntry = { changes?: WaChange[] };
type WaPayload = { entry?: WaEntry[] };

async function processWebhook(payload: unknown): Promise<void> {
  const entries = (payload as WaPayload)?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value) continue;

      // Delivery/read receipts: accept and log for now (stored later).
      for (const status of value.statuses ?? []) {
        console.log(`[wa] status ${status.status ?? '?'} for message ${status.id ?? '?'}`);
      }

      // Inbound messages: handle each independently so one failure can't sink the
      // batch. Every inbound gets its own try/catch (log + continue).
      const contacts = value.contacts ?? [];
      for (const msg of value.messages ?? []) {
        try {
          await handleInboundMessage(msg, contacts);
        } catch (e) {
          console.error('[wa] inbound message handling failed:', e);
        }
      }
    }
  }
}

async function handleInboundMessage(msg: WaMessage, contacts: WaContact[]): Promise<void> {
  const waId = msg.from;
  const messageId = msg.id;
  if (!waId || !messageId) return;

  const profileName = contacts?.[0]?.profile?.name ?? null;

  // Non-text (image/audio/sticker/…): a gentle nudge, no pipeline.
  if (msg.type !== 'text') {
    await sendWhatsAppText(waId, NON_TEXT_REPLY);
    return;
  }

  const body = msg.text?.body?.trim() ?? '';
  if (!body) return;

  // Without storage we can't dedup or persist, but the channel should still
  // answer — generate + send statelessly.
  if (!supabaseAdmin) {
    await replyAndSend(waId, [{ role: 'user', content: body }]);
    return;
  }

  // DEDUP (fast path): we've already stored this provider message id → skip the
  // whole pipeline so a Meta retry doesn't double-reply.
  if (await isDuplicate(messageId)) {
    console.log(`[wa] duplicate message ${messageId} — skipping`);
    return;
  }

  const contactId = await findOrCreateContact(waId, profileName);
  const conversationId = contactId ? await findOrCreateConversation(contactId) : null;

  // If storage setup failed, still answer (stateless) rather than going silent.
  if (!conversationId) {
    await replyAndSend(waId, [{ role: 'user', content: body }]);
    return;
  }

  // Prior turns for context (before we insert the current message).
  const history = await loadHistory(conversationId);

  // Persist the inbound message. The unique index on wa_message_id closes the
  // race where two simultaneous retries both passed the isDuplicate check.
  const saveResult = await saveUserMessage(conversationId, body, messageId);
  if (saveResult === 'duplicate') {
    console.log(`[wa] duplicate message ${messageId} (insert race) — skipping`);
    return;
  }

  const convoMessages: CareMessage[] = [...history, { role: 'user', content: body }];

  // Generate the reply (shared brains). If this throws, apologise rather than
  // leaving the user hanging.
  let reply: { fullText: string; sources: unknown } | null = null;
  try {
    reply = await generateReply(convoMessages, 'zh');
  } catch (e) {
    console.error('[wa] generateReply failed:', e);
    await sendWhatsAppText(waId, FALLBACK_REPLY);
    return;
  }

  // Persist assistant message, send to WhatsApp, then classify + bump activity.
  await saveAssistantMessage(conversationId, reply.fullText, reply.sources);
  await sendWhatsAppText(waId, formatForWhatsApp(reply.fullText));
  await classifyAndSaveCategory(conversationId, [
    ...convoMessages,
    { role: 'assistant', content: reply.fullText },
  ]);
  await bumpConversation(conversationId);
}

// Stateless generate+send used when storage is unavailable or setup failed.
async function replyAndSend(waId: string, messages: CareMessage[]): Promise<void> {
  try {
    const { fullText } = await generateReply(messages, 'zh');
    await sendWhatsAppText(waId, formatForWhatsApp(fullText));
  } catch (e) {
    console.error('[wa] stateless reply failed:', e);
    await sendWhatsAppText(waId, FALLBACK_REPLY);
  }
}

// ── Fail-safe storage helpers (never throw) ───────────────────────────────────

async function isDuplicate(messageId: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  try {
    const { data } = await supabaseAdmin
      .from('messages')
      .select('id')
      .eq('wa_message_id', messageId)
      .maybeSingle();
    return Boolean(data);
  } catch (e) {
    console.error('[wa] dedup check failed:', e);
    return false;
  }
}

async function findOrCreateContact(waId: string, name: string | null): Promise<string | null> {
  if (!supabaseAdmin) return null;
  try {
    const { data: existing } = await supabaseAdmin
      .from('contacts')
      .select('id, display_name')
      .eq('wa_id', waId)
      .maybeSingle();

    if (existing) {
      const update: Record<string, unknown> = { last_seen: new Date().toISOString() };
      // Refresh the display name if the profile now gives us a (different) one.
      if (name && name !== existing.display_name) update.display_name = name;
      await supabaseAdmin.from('contacts').update(update).eq('id', existing.id);
      return existing.id;
    }

    const { data: created } = await supabaseAdmin
      .from('contacts')
      .insert({ channel: 'whatsapp', wa_id: waId, display_name: name ?? '匿名访客' })
      .select('id')
      .single();
    return created?.id ?? null;
  } catch (e) {
    console.error('[wa] contact find-or-create failed:', e);
    return null;
  }
}

async function findOrCreateConversation(contactId: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  try {
    const cutoff = new Date(Date.now() - CONVERSATION_WINDOW_MS).toISOString();
    const { data: open } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId)
      .neq('status', 'closed')
      .gte('last_message_at', cutoff)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (open) return open.id;

    const { data: created } = await supabaseAdmin
      .from('conversations')
      .insert({ channel: 'whatsapp', status: 'ai_handling', language: 'zh', contact_id: contactId })
      .select('id')
      .single();
    return created?.id ?? null;
  } catch (e) {
    console.error('[wa] conversation find-or-create failed:', e);
    return null;
  }
}

async function loadHistory(conversationId: string): Promise<CareMessage[]> {
  if (!supabaseAdmin) return [];
  try {
    const { data } = await supabaseAdmin
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(HISTORY_LIMIT);
    return (data ?? [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content ?? '' }));
  } catch (e) {
    console.error('[wa] history load failed:', e);
    return [];
  }
}

// Returns 'duplicate' when the unique wa_message_id index rejects the insert (a
// retry we hadn't yet stored), so the caller can abort before replying twice.
async function saveUserMessage(
  conversationId: string,
  content: string,
  waMessageId: string
): Promise<'ok' | 'duplicate' | 'error'> {
  if (!supabaseAdmin) return 'error';
  try {
    const { error } = await supabaseAdmin
      .from('messages')
      .insert({ conversation_id: conversationId, role: 'user', content, wa_message_id: waMessageId });
    if (error) {
      if (error.code === '23505') return 'duplicate'; // unique_violation
      console.error('[wa] user message save failed:', error);
      return 'error';
    }
    return 'ok';
  } catch (e) {
    console.error('[wa] user message save threw:', e);
    return 'error';
  }
}

async function saveAssistantMessage(
  conversationId: string,
  content: string,
  sources: unknown
): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin
      .from('messages')
      .insert({ conversation_id: conversationId, role: 'assistant', content, sources });
  } catch (e) {
    console.error('[wa] assistant message save failed:', e);
  }
}

async function bumpConversation(conversationId: string): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);
  } catch (e) {
    console.error('[wa] conversation bump failed:', e);
  }
}
