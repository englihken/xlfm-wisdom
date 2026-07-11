// src/app/api/public/inbox/route.ts
// PUBLIC (no auth) contact-form intake for /m. Honeypot + rate limit + crisis scan.
// Routes to a centre's ENABLED mailbox (else HQ), creates a form thread + inbound message,
// runs the crisis keyword scan (E2 §1.4), and returns the mailbox auto-reply text (shown
// ON-SCREEN only — no email in plumbing A). Audits action='thread_created', actor='public-form'.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sameOrigin, readJsonCapped, hasUnknownKeys, rateLimit, clientIp } from '@/lib/public-event';
import { normalizePhone } from '@/lib/members';
import { scanCrisis } from '@/lib/inbox';
import { loadCrisisKeywords } from '@/lib/inbox-server';
import { writeAudit } from '@/lib/audit';
import { isPublicPageEnabled } from '@/lib/org-settings';

export const runtime = 'nodejs';

const ALLOWED = ['centre_code', 'name', 'phone', 'email', 'subject', 'body', 'website'] as const;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const ip = clientIp(req);
  if (!rateLimit(`pub:inbox:${ip}`, 5, 86_400_000)) return NextResponse.json({ error: '今日提交太多，请明天再试' }, { status: 429 });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  // E3 (brief §3.5): the /m switch is enforced HERE too, not just on the page.
  // FAIL-OPEN: missing key / unreachable table keeps the form working.
  if (!(await isPublicPageEnabled('public.inbox_form_enabled'))) {
    return NextResponse.json({ error: '本服务暂停中，请稍后再来 🙏' }, { status: 403 });
  }

  const body = await readJsonCapped(req);
  if (!body || hasUnknownKeys(body, ALLOWED)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  // Honeypot: a filled 'website' means a bot — accept silently (200) without writing anything.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return NextResponse.json({ ok: true });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const message = typeof body.body === 'string' ? body.body.trim() : '';
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
  if (!name || !subject || !message) return NextResponse.json({ error: '请填写姓名、主题与内容' }, { status: 400 });

  const { phone, error: phoneErr } = normalizePhone(typeof body.phone === 'string' ? body.phone : '');
  if (phoneErr || !phone) return NextResponse.json({ error: phoneErr ?? '请填写有效的电话号码' }, { status: 400 });

  // per-phone daily cap (in addition to per-IP)
  if (!rateLimit(`pub:inbox:phone:${phone}`, 5, 86_400_000)) return NextResponse.json({ error: '今日提交太多，请明天再试' }, { status: 429 });

  // ---- route to a mailbox: centre_code → that centre's ENABLED mailbox, else HQ ----
  // NB: resolve the centre by code FIRST, then find its enabled mailbox by centre_id.
  // Do NOT filter inbox_mailboxes by an embedded column (.eq('centre.code', …)): PostgREST
  // treats a dotted filter as a filter on the EMBEDDED resource, not the parent rows, so
  // without an !inner join it doesn't restrict the mailbox rows — the query then returns
  // every enabled mailbox and .maybeSingle() errors on multiple rows (the original 503 bug).
  const centreCode = typeof body.centre_code === 'string' && body.centre_code.trim() ? body.centre_code.trim().toUpperCase() : null;

  const enabledMailboxForCentre = async (code: string): Promise<string | null> => {
    const { data: centre, error: cErr } = await supabaseAdmin!.from('centres').select('id').eq('code', code).maybeSingle();
    if (cErr) { console.error('[public/inbox] centre lookup failed:', code, cErr); return null; }
    if (!centre) return null;
    const { data: mb, error: mErr } = await supabaseAdmin!
      .from('inbox_mailboxes')
      .select('id')
      .eq('centre_id', centre.id as string)
      .eq('is_enabled', true)
      .maybeSingle();
    if (mErr) { console.error('[public/inbox] mailbox lookup failed for centre:', code, mErr); return null; }
    return (mb?.id as string | undefined) ?? null;
  };

  let mailboxId: string | null = null;
  if (centreCode) mailboxId = await enabledMailboxForCentre(centreCode);
  if (!mailboxId && centreCode !== 'HQ') mailboxId = await enabledMailboxForCentre('HQ');
  if (!mailboxId) {
    console.error('[public/inbox] no enabled mailbox resolved (centre_code=%s) — returning 503', centreCode ?? '(none)');
    return NextResponse.json({ error: '暂时无法接收来信，请稍后再试' }, { status: 503 });
  }

  // ---- crisis scan (subject + body, case-insensitive substring) ----
  const keywords = await loadCrisisKeywords(supabaseAdmin);
  const crisis = scanCrisis(`${subject}\n${message}`, keywords);

  const nowIso = new Date().toISOString();
  const { data: thread, error: tErr } = await supabaseAdmin
    .from('inbox_threads')
    .insert({
      mailbox_id: mailboxId,
      kind: 'form',
      subject,
      sender_name: name,
      sender_phone: phone,
      sender_email: email,
      status: 'new',
      crisis_flag: crisis,
      last_message_at: nowIso,
    })
    .select('id')
    .single();
  if (tErr || !thread) {
    console.error('[public/inbox] thread insert failed:', tErr);
    return NextResponse.json({ error: '提交失败，请稍后再试' }, { status: 500 });
  }
  const threadId = thread.id as string;

  const { error: mErr } = await supabaseAdmin.from('inbox_messages').insert({
    thread_id: threadId,
    direction: 'inbound',
    body: message,
    author_name: name,
  });
  if (mErr) {
    console.error('[public/inbox] message insert failed, rolling back:', mErr);
    await supabaseAdmin.from('inbox_threads').delete().eq('id', threadId);
    return NextResponse.json({ error: '提交失败，请稍后再试' }, { status: 500 });
  }

  await writeAudit({
    actorId: null,
    actorEmail: 'public-form',
    module: 'inbox',
    action: 'thread_created',
    tableName: 'inbox_threads',
    recordId: threadId,
    after: { kind: 'form', mailbox_id: mailboxId, crisis, subject },
  });

  // auto-reply text (shown on the success screen only)
  const { data: mbReply } = await supabaseAdmin
    .from('inbox_mailboxes')
    .select('auto_reply_enabled, auto_reply_text')
    .eq('id', mailboxId)
    .maybeSingle();
  const autoReply = mbReply?.auto_reply_enabled ? ((mbReply.auto_reply_text as string | null) ?? null) : null;

  return NextResponse.json({ ok: true, auto_reply_text: autoReply, crisis }, { status: 201 });
}
