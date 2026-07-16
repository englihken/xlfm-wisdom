// src/app/api/public/events/[token]/register/route.ts
// PUBLIC ANONYMOUS ROUTE — no login; gate is token+enabled+open; touches only this
// event + its own registration; must never read members beyond a masked phone match,
// never care.
//
// POST — submit a public self-registration into the SAME approval queue as staff 代报名.
//   Re-loads the event via token (must still be open+enabled → 400 已截止); re-matches the
//   phone → member SILENTLY; validates selections (meal keys ⊆ offered, C0); recomputes
//   fees server-side (NEVER trusts client totals) and snapshots the breakdown; generates
//   reg_no (event code + seq). status is ALWAYS 'pending' (public submissions always queue,
//   regardless of requires_approval). Matched → member_id set, applicant_* null. Unmatched
//   → applicant_name/applicant_phone set, member_id null — NO member is created here (建档
//   stays on the staff approval decision). Audited as actor_email='public'.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { normalizePhone, storedPhoneForms } from '@/lib/members';
import { computeFees, parseSelections, type FeeItem } from '@/lib/event-fees';
import { invalidMealKeys } from '@/lib/event-slots';
import {
  loadPublicEvent, offeredKeySet, sameOrigin, rateLimit, clientIp, readJsonCapped, hasUnknownKeys, maskRegNo,
} from '@/lib/public-event';

export const runtime = 'nodejs';

const ALLOWED = ['phone', 'name', 'name_en', 'centre_id', 'selections', 'volunteer_team_id'] as const;
const DUPE_CONSTRAINT = 'registrations_public_dupe';

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!rateLimit(`pub:register:${clientIp(req)}`, 15, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { token } = await params;
  // Re-load through the single gate: closed/disabled/unknown → 已截止 (form no longer live).
  const ev = await loadPublicEvent(token);
  if (!ev.ok) return NextResponse.json({ error: '报名已截止' }, { status: 400 });
  const event = ev.event;

  const body = await readJsonCapped(req);
  if (!body || hasUnknownKeys(body, ALLOWED)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  // ── phone (required) → silent member match (active only) ────────────────────────────
  const { phone, error: phoneErr } = normalizePhone(String(body.phone ?? ''));
  if (phoneErr) return NextResponse.json({ error: phoneErr }, { status: 400 });
  if (!phone) return NextResponse.json({ error: '请填写电话号码' }, { status: 400 });

  const { data: member } = await supabaseAdmin
    .from('members')
    .select('id, status')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();
  const matched = !!member;

  // ── identity: matched member, or a captured newcomer (name required) ────────────────
  let applicantName: string | null = null;
  let notes: string | null = null;
  if (!matched) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: '请填写姓名' }, { status: 400 });
    if (name.length > 80) return NextResponse.json({ error: '姓名过长' }, { status: 400 });
    const nameEn = typeof body.name_en === 'string' ? body.name_en.trim().slice(0, 80) : '';
    applicantName = nameEn ? `${name}（${nameEn}）` : name;

    // centre_id (newcomer only) — validated for hygiene and captured in notes so the
    // approver can 建档 with it later. NO member is created here; there is no applicant
    // centre column by design, so the human-readable centre name rides in notes.
    if (body.centre_id !== undefined && body.centre_id !== null && body.centre_id !== '') {
      const cid = String(body.centre_id);
      const { data: centre } = await supabaseAdmin
        .from('centres')
        .select('name_cn, name_en')
        .eq('id', cid)
        .eq('is_active', true)
        .maybeSingle();
      if (!centre) return NextResponse.json({ error: '中心无效' }, { status: 400 });
      notes = `公开报名中心：${centre.name_cn} ${centre.name_en}`;
    }
  }

  // ── optional volunteer team ─────────────────────────────────────────────────────────
  let volunteerTeamId: string | null = null;
  if (body.volunteer_team_id !== undefined && body.volunteer_team_id !== null && body.volunteer_team_id !== '') {
    const tid = String(body.volunteer_team_id);
    const { data: team } = await supabaseAdmin.from('teams').select('id').eq('id', tid).eq('is_active', true).maybeSingle();
    if (!team) return NextResponse.json({ error: '义工组无效' }, { status: 400 });
    volunteerTeamId = tid;
  }

  // ── selections + server-side fee recompute (never trust client totals) ──────────────
  const selections = parseSelections(body.selections);
  if ((selections.meals?.length ?? 0) > 400) return NextResponse.json({ error: '餐点选项过多' }, { status: 400 });

  const fees = event.fees.map(
    (f) => ({ item: f.item, label_cn: f.label_cn, amount: f.amount, billing: f.billing }) as FeeItem
  );
  const mealPerItem = fees.some((f) => f.item === 'meal' && f.billing === 'per_item');
  if (mealPerItem && selections.meals?.length) {
    const bad = invalidMealKeys(selections.meals, offeredKeySet(event));
    if (bad.length) return NextResponse.json({ error: `餐点选项无效（未供应）：${bad.join('、')}` }, { status: 400 });
  } else if (!mealPerItem) {
    delete selections.meals; // ignore stray meal cells when the event isn't per_item
  }
  const { total, breakdown } = computeFees(fees, selections);

  // ── duplicate guard ─────────────────────────────────────────────────────────────────
  if (matched) {
    // matched-member dupe is app-enforced (no DB unique on (event, member)).
    const { data: dupe } = await supabaseAdmin
      .from('registrations')
      .select('id')
      .eq('event_id', event.id)
      .eq('member_id', member!.id)
      .in('status', ['pending', 'approved'])
      .maybeSingle();
    if (dupe) return NextResponse.json({ error: '您已报名此活动', existing: { reg_no: maskRegNo(event.code) } }, { status: 409 });
  } else {
    // newcomer pre-check; the partial unique index is the durable backstop (race-safe)
    // for canonical-form rows. storedPhoneForms also matches rows that predate the 038
    // normalization migration (bulk-imported local / zero-stripped formats).
    const { data: dupe } = await supabaseAdmin
      .from('registrations')
      .select('id')
      .eq('event_id', event.id)
      .in('applicant_phone', storedPhoneForms(phone))
      .is('member_id', null)
      .in('status', ['pending', 'approved'])
      .limit(1)
      .maybeSingle();
    if (dupe) return NextResponse.json({ error: '此电话已报名此活动', existing: { reg_no: maskRegNo(event.code) } }, { status: 409 });
  }

  const base = {
    event_id: event.id,
    member_id: matched ? member!.id : null,
    applicant_name: matched ? null : applicantName,
    applicant_phone: matched ? null : phone,
    volunteer_team_id: volunteerTeamId,
    selections,
    fee_total: total,
    fee_breakdown: breakdown,
    status: 'pending' as const,       // public submissions ALWAYS queue
    decided_by: null,
    decided_at: null,
    notes,
    created_by: null,                 // anonymous public submission
    updated_by: null,
  };

  // reg_no = event code + zero-padded seq (count + 1); retry on reg_no collision. A 23505
  // naming the dupe index means the newcomer already registered (race) → 409, not a retry.
  const { count } = await supabaseAdmin.from('registrations').select('id', { count: 'exact', head: true }).eq('event_id', event.id);
  let seq = (count ?? 0) + 1;
  let inserted: { id: string; reg_no: string; status: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const regNo = `${event.code}-${String(seq).padStart(4, '0')}`;
    const { data, error } = await supabaseAdmin
      .from('registrations')
      .insert({ ...base, reg_no: regNo })
      .select('id, reg_no, status')
      .single();
    if (!error && data) { inserted = data as { id: string; reg_no: string; status: string }; break; }
    if (error?.code === '23505') {
      if (`${error.message ?? ''} ${error.details ?? ''}`.includes(DUPE_CONSTRAINT)) {
        return NextResponse.json({ error: '此电话已报名此活动', existing: { reg_no: maskRegNo(event.code) } }, { status: 409 });
      }
      seq++; // reg_no taken — next seq
      continue;
    }
    console.error('[public/register] insert failed:', error);
    return NextResponse.json({ error: '报名失败，请重试' }, { status: 500 });
  }
  if (!inserted) return NextResponse.json({ error: '无法生成报名编号，请重试' }, { status: 500 });

  await writeAudit({
    actorId: null,
    actorEmail: 'public',
    module: 'events',
    action: 'create',
    tableName: 'registrations',
    recordId: inserted.id,
    after: { reg_no: inserted.reg_no, matched, fee_total: total },
  });

  return NextResponse.json({ reg_no: inserted.reg_no, status: 'pending', fee_total: total }, { status: 201 });
}
