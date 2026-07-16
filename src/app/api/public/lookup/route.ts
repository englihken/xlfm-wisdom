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
import { sameOrigin, rateLimit, clientIp, readJsonCapped, hasUnknownKeys, matchOwnedRegistration, buildOwnedRegistrationDetail } from '@/lib/public-event';

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

  // Unknown reg_no OR phone mismatch → identical 404 (no ownership signal either way).
  const reg = await matchOwnedRegistration(regNo, phone);
  if (!reg) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // detail = the owner's FULL record view (status page v2) — team, meals, resolved
  // stay, import813 extras, edit window + picker inputs. Still strictly this one
  // registration, behind the same two-factor gate.
  const detail = await buildOwnedRegistrationDetail(reg);

  return NextResponse.json({
    reg_no: reg.reg_no,
    status: reg.status,
    fee_total: reg.fee_total,
    payment_status: reg.payment_status,      // C3: drives the gentle payment badge
    has_proof: !!reg.payment_proof_path,
    event: reg.event ? { title: reg.event.title, code: reg.event.code, starts_on: reg.event.starts_on, ends_on: reg.event.ends_on } : null,
    selections: summarize(reg.selections),
    detail,
  });
}
