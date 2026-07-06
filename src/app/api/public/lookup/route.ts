// src/app/api/public/lookup/route.ts
// PUBLIC ANONYMOUS ROUTE — no login; gate is proof-of-ownership (reg_no + matching
// phone); touches only the ONE matched registration + its event title; must never read
// members beyond the matched registration's phone, never care.
//
// POST { reg_no, phone } — return a MASKED status summary ONLY when reg_no + normalized
//   phone identify the SAME registration (phone matches applicant_phone OR the linked
//   member's phone). Otherwise 404 — no listing, no enumeration, wrong-phone is
//   indistinguishable from unknown-reg_no.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizePhone } from '@/lib/members';
import { sameOrigin, rateLimit, clientIp, readJsonCapped, hasUnknownKeys } from '@/lib/public-event';

export const runtime = 'nodejs';

const ALLOWED = ['reg_no', 'phone'] as const;
const REG_NO_RE = /^[A-Za-z0-9-]{1,40}$/;

// Compact, derived selections summary — never the raw jsonb.
function summarize(sel: unknown): Record<string, unknown> {
  const s = (sel ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (Array.isArray(s.meals) && s.meals.length) out.meals = s.meals.length;
  if (Number(s.meal_days) > 0) out.meal_days = Math.trunc(Number(s.meal_days));
  if (Number(s.nights) > 0) out.nights = Math.trunc(Number(s.nights));
  if (s.transfer === true) out.transfer = true;
  const u = s.uniform && typeof s.uniform === 'object' ? (s.uniform as Record<string, unknown>) : null;
  if (u && Number(u.qty) > 0) out.uniform = { size: typeof u.size === 'string' ? u.size : null, qty: Math.trunc(Number(u.qty)) };
  return out;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!rateLimit(`pub:lookup:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = await readJsonCapped(req);
  if (!body || hasUnknownKeys(body, ALLOWED)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const regNo = typeof body.reg_no === 'string' ? body.reg_no.trim() : '';
  if (!regNo || !REG_NO_RE.test(regNo)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { phone, error } = normalizePhone(String(body.phone ?? ''));
  if (error || !phone) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: reg } = await supabaseAdmin
    .from('registrations')
    .select('reg_no, status, fee_total, selections, applicant_phone, member:members!member_id ( phone ), event:events!event_id ( title, code, starts_on, ends_on )')
    .eq('reg_no', regNo)
    .maybeSingle();

  // Unknown reg_no OR phone mismatch → identical 404 (no ownership signal either way).
  if (!reg) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const memberRaw = (reg as { member?: { phone: string | null } | { phone: string | null }[] | null }).member;
  const memberPhone = (Array.isArray(memberRaw) ? memberRaw[0] ?? null : memberRaw ?? null)?.phone ?? null;
  const owns = reg.applicant_phone === phone || memberPhone === phone;
  if (!owns) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const evRaw = (reg as { event?: { title: string; code: string; starts_on: string; ends_on: string | null } | { title: string; code: string; starts_on: string; ends_on: string | null }[] | null }).event;
  const ev = Array.isArray(evRaw) ? evRaw[0] ?? null : evRaw ?? null;

  return NextResponse.json({
    reg_no: reg.reg_no,
    status: reg.status,
    fee_total: reg.fee_total,
    event: ev ? { title: ev.title, code: ev.code, starts_on: ev.starts_on, ends_on: ev.ends_on } : null,
    selections: summarize(reg.selections),
  });
}
