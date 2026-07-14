// src/lib/public-event.ts
// Shared server-side gate + guards for the PUBLIC, LOGIN-FREE registration surface
// (/api/public/**, task C1). Service-role only — never import into a client component.
//
// SECURITY CONTRACT (every /api/public route relies on this):
//   • loadPublicEvent(token) is the SINGLE door. It returns an event ONLY when
//     public_registration_enabled = true AND status = 'open' (and the token exists).
//     A bad / disabled / closed / unknown token → { ok:false, status:404 } — the four
//     failure modes are INDISTINGUISHABLE (no enumeration signal).
//   • It returns ONLY public-safe fields (see PublicEvent) — never private event columns,
//     never other events, never members, never anything care-wing.
//   • These routes NEVER read auth cookies and NEVER call requireModuleAccess — they are
//     intentionally anonymous; the gate is token + enabled + open, nothing else.

import { supabaseAdmin } from './supabase';
import { mealSlotKey } from './events';

// A token is an urlsafe base64 slug (~16 chars). Validate shape before touching the DB so
// junk input is cheaply rejected as 404 (still no signal — same as a real unknown token).
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

export type PublicFee = { item: string; label_cn: string | null; amount: number; billing: string; sort: number };
export type PublicMealSlot = { slot_date: string; meal: string };

// The ONLY fields ever exposed to an anonymous caller. No id-leaks beyond the event's own
// opaque id, no organizing-centre id/code (name only), no private columns, no token.
export type PublicEvent = {
  id: string;
  code: string;
  title: string;
  event_type: string;
  organizing_centre: { name_cn: string; name_en: string } | null;
  starts_on: string;
  ends_on: string | null;
  location: string | null;
  reg_deadline: string | null;
  capacity: number | null;
  approved: number;            // approved-registration count
  remaining: number | null;    // capacity - approved (null = unlimited)
  reg_edit_cutoff_days: number;
  fees: PublicFee[];
  meal_slots: PublicMealSlot[]; // OFFERED cells only
};

export type LoadPublicEventResult = { ok: true; event: PublicEvent } | { ok: false; status: 404 };

// Load an event by public_token — ONLY when enabled + open. Anything else → 404.
export async function loadPublicEvent(token: string): Promise<LoadPublicEventResult> {
  if (!supabaseAdmin) return { ok: false, status: 404 };
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return { ok: false, status: 404 };

  const { data: ev, error } = await supabaseAdmin
    .from('events')
    .select(
      'id, code, title, event_type, starts_on, ends_on, location, reg_deadline, capacity, reg_edit_cutoff_days, organizing_centre:centres!organizing_centre_id ( name_cn, name_en )'
    )
    .eq('public_token', token)
    .eq('public_registration_enabled', true)
    .eq('status', 'open')
    .maybeSingle();

  // Any error, or no matching enabled+open event → 404 (indistinguishable from not-found).
  if (error || !ev) return { ok: false, status: 404 };

  const [{ data: feeRows }, { data: slotRows }, { count: approvedCount }] = await Promise.all([
    supabaseAdmin.from('event_fees').select('item, label_cn, amount, billing, sort').eq('event_id', ev.id).order('sort', { ascending: true }),
    supabaseAdmin.from('event_meal_slots').select('slot_date, meal').eq('event_id', ev.id).eq('offered', true),
    supabaseAdmin.from('registrations').select('id', { count: 'exact', head: true }).eq('event_id', ev.id).eq('status', 'approved'),
  ]);

  const centreRaw = (ev as { organizing_centre?: { name_cn: string; name_en: string } | { name_cn: string; name_en: string }[] | null }).organizing_centre;
  const centre = Array.isArray(centreRaw) ? centreRaw[0] ?? null : centreRaw ?? null;

  const capacity = typeof ev.capacity === 'number' ? ev.capacity : null;
  const approved = approvedCount ?? 0;
  const remaining = capacity == null ? null : Math.max(0, capacity - approved);

  return {
    ok: true,
    event: {
      id: ev.id as string,
      code: ev.code as string,
      title: ev.title as string,
      event_type: ev.event_type as string,
      organizing_centre: centre ? { name_cn: centre.name_cn, name_en: centre.name_en } : null,
      starts_on: ev.starts_on as string,
      ends_on: (ev.ends_on as string | null) ?? null,
      location: (ev.location as string | null) ?? null,
      reg_deadline: (ev.reg_deadline as string | null) ?? null,
      capacity,
      approved,
      remaining,
      reg_edit_cutoff_days: (ev.reg_edit_cutoff_days as number) ?? 3,
      fees: ((feeRows ?? []) as PublicFee[]).map((f) => ({
        item: f.item, label_cn: f.label_cn, amount: Number(f.amount), billing: f.billing, sort: f.sort,
      })),
      meal_slots: ((slotRows ?? []) as PublicMealSlot[]).map((s) => ({ slot_date: s.slot_date, meal: s.meal })),
    },
  };
}

// The set of OFFERED slot keys ('YYYY-MM-DD:meal') for a loaded public event — used to
// validate that submitted selections.meals reference cells the kitchen actually offers.
export function offeredKeySet(event: PublicEvent): Set<string> {
  const set = new Set<string>();
  for (const s of event.meal_slots) set.add(mealSlotKey(s.slot_date, s.meal));
  return set;
}

// ── ownership match (shared by the lookup + proof-upload routes) ─────────────────────
// A registration the caller has PROVEN they own by presenting reg_no + a matching phone
// (the applicant_phone, or the linked member's phone). Returns null on any mismatch so the
// caller answers 404 — wrong-phone is indistinguishable from unknown-reg_no (no enumeration).
export type OwnedRegistration = {
  id: string;
  reg_no: string;
  status: string;
  fee_total: number;
  selections: unknown;
  payment_status: string;
  payment_proof_path: string | null;
  event: { title: string; code: string; starts_on: string; ends_on: string | null } | null;
};

export async function matchOwnedRegistration(regNo: string, phone: string): Promise<OwnedRegistration | null> {
  if (!supabaseAdmin) return null;
  const { data: reg } = await supabaseAdmin
    .from('registrations')
    .select('id, reg_no, status, fee_total, selections, payment_status, payment_proof_path, applicant_phone, member:members!member_id ( phone ), event:events!event_id ( title, code, starts_on, ends_on )')
    .eq('reg_no', regNo)
    .maybeSingle();
  if (!reg) return null;

  const memberRaw = (reg as { member?: { phone: string | null } | { phone: string | null }[] | null }).member;
  const memberPhone = (Array.isArray(memberRaw) ? memberRaw[0] ?? null : memberRaw ?? null)?.phone ?? null;
  if (reg.applicant_phone !== phone && memberPhone !== phone) return null;

  const evRaw = (reg as { event?: OwnedRegistration['event'] | OwnedRegistration['event'][] | null }).event;
  const event = Array.isArray(evRaw) ? evRaw[0] ?? null : evRaw ?? null;

  return {
    id: reg.id as string,
    reg_no: reg.reg_no as string,
    status: reg.status as string,
    fee_total: Number(reg.fee_total) || 0,
    selections: reg.selections,
    payment_status: (reg.payment_status as string) ?? 'unpaid',
    payment_proof_path: (reg.payment_proof_path as string | null) ?? null,
    event,
  };
}

// ── privacy masking ──────────────────────────────────────────────────────────────────
// maskName — first char + '＊＊' of name_cn (else name_en). Ken chose masked over a
// full-name reveal (privacy); the identify route reveals nothing harvestable beyond this
// initial. If that policy ever changes, it changes HERE and in the identify route.
export function maskName(nameCn: string | null | undefined, nameEn: string | null | undefined): string {
  const n = (nameCn ?? nameEn ?? '').trim();
  return n ? `${n[0]}＊＊` : '＊＊';
}

// maskRegNo — confirm "already registered" without handing back the full lookup key. The
// event code is already public (it's in the form URL); only the sequence is masked.
export function maskRegNo(code: string): string {
  return `${code}-＊＊＊＊`;
}

// ── request guards (shared by all four public routes) ────────────────────────────────
// same-origin (CSRF-lite): if a browser sent an Origin, it must match the Host. A missing
// Origin (same-origin navigation / non-browser client) is allowed. Blocks cross-site POSTs.
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    const host = req.headers.get('host');
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Read + size-cap a JSON body. Rejects (null) on oversize or non-object payloads. Caps the
// body so a giant payload can't be used to exhaust the function (defense in depth).
export async function readJsonCapped(req: Request, maxBytes = 8192): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const text = await req.text().catch(() => '');
  if (!text || text.length > maxBytes) return null;
  try {
    const j = JSON.parse(text);
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Reject bodies carrying any key outside the whitelist (defense against smuggled fields).
export function hasUnknownKeys(body: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(body).some((k) => !allowed.includes(k));
}

// Best-effort in-memory per-IP+route rate limit. NOTE: serverless instances don't share
// this map, so it is a per-instance speed bump, NOT a guarantee — the durable guards are
// the DB dupe index + the token gate. Kept intentionally simple and dependency-free.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

// Caller IP for the rate-limit key. Security audit M4: the LEFTMOST x-forwarded-for
// entry is client-controlled (anyone can send their own XFF header and the proxy
// prepends/keeps it), which let one attacker rotate keys freely. On Vercel the
// trustworthy signals are x-real-ip (set by the platform) and the LAST XFF hop
// (appended by the proxy itself) — prefer those, in that order.
// KNOWN LIMITATION: the in-memory per-instance Map above remains a best-effort
// speed bump (serverless instances don't share it); a durable counter (DB/Upstash)
// is the real fix and is tracked separately.
export function clientIp(req: Request): string {
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1]!;
  }
  return 'unknown';
}
