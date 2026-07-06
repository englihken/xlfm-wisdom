// src/app/api/dashboard/events/[id]/registrations/route.ts
// GET  — an event's registrations (events:view). ?status filter + pagination. Rows
//        carry the member (name_cn + centre code) when member_id is set.
// POST  — register a member to an event (events:edit — the B admin flow). member_id
//        REQUIRED here; server recomputes fees (never trusts client totals), snapshots
//        the breakdown, generates reg_no, and audits. NO delete — cancel is a status.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { computeFees, parseSelections, type FeeItem } from '@/lib/event-fees';
import { fetchOfferedKeys, invalidMealKeys } from '@/lib/event-slots';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function gate401or403(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireModuleAccess('events', 'view');
  if (!access.ok) return gate401or403(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(sp.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const status = sp.get('status');

  let q = supabaseAdmin
    .from('registrations')
    .select(
      'id, reg_no, member_id, applicant_name, applicant_phone, volunteer_team_id, selections, fee_total, fee_breakdown, status, decided_by, decided_at, created_at, payment_status, paid_amount, payment_note, payment_proof_path, payment_verified_at, member:members ( name_cn, name_en, centre:centres ( code ) ), decider:volunteers!decided_by ( display_name, email )',
      { count: 'exact' }
    )
    .eq('event_id', id);
  if (status) q = q.eq('status', status);
  q = q.order('created_at', { ascending: true }).range(from, to);

  const { data, count, error } = await q;
  if (error) {
    console.error('[registrations] list failed:', error);
    return NextResponse.json({ error: 'Failed to load registrations' }, { status: 500 });
  }

  type Person = { name_cn?: string | null; name_en?: string | null; display_name?: string | null; email?: string | null; centre?: { code: string } | { code: string }[] | null };
  type Row = {
    id: string; reg_no: string; member_id: string | null; applicant_name: string | null;
    applicant_phone: string | null; volunteer_team_id: string | null; selections: unknown;
    fee_total: number; fee_breakdown: unknown; status: string; decided_by: string | null;
    decided_at: string | null; created_at: string;
    payment_status: string | null; paid_amount: number | null; payment_note: string | null;
    payment_proof_path: string | null; payment_verified_at: string | null;
    member: Person | Person[] | null;
    decider: Person | Person[] | null;
  };
  const registrations = ((data ?? []) as unknown as Row[]).map((r) => {
    const m = Array.isArray(r.member) ? r.member[0] : r.member;
    const centre = m ? (Array.isArray(m.centre) ? m.centre[0] : m.centre) : null;
    const d = Array.isArray(r.decider) ? r.decider[0] : r.decider;
    return {
      id: r.id,
      reg_no: r.reg_no,
      member_id: r.member_id,
      name: m ? m.name_cn || m.name_en || '（无名）' : r.applicant_name || '（未命名）',
      centreCode: centre?.code ?? null,
      volunteer_team_id: r.volunteer_team_id,
      selections: r.selections ?? {},
      fee_total: r.fee_total,
      fee_breakdown: r.fee_breakdown ?? [],
      status: r.status,
      decided_by: r.decided_by,
      decidedByName: d ? d.display_name || d.email || null : null,
      decided_at: r.decided_at,
      created_at: r.created_at,
      payment_status: r.payment_status ?? 'unpaid',
      paid_amount: r.paid_amount != null ? Number(r.paid_amount) : null,
      payment_note: r.payment_note ?? null,
      has_proof: !!r.payment_proof_path,
      payment_verified_at: r.payment_verified_at,
    };
  });

  return NextResponse.json({
    registrations,
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireModuleAccess('events', 'edit');
  if (!access.ok) return gate401or403(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const memberId = typeof body.member_id === 'string' && body.member_id.trim() ? body.member_id.trim() : '';
  if (!memberId) return NextResponse.json({ error: '请提供 member_id（管理员登记流程）' }, { status: 400 });

  // Event must exist and be OPEN for registration.
  const { data: event, error: evErr } = await supabaseAdmin
    .from('events')
    .select('id, code, status, requires_approval, capacity')
    .eq('id', id)
    .maybeSingle();
  if (evErr) {
    console.error('[registrations] event fetch failed:', evErr);
    return NextResponse.json({ error: 'Failed to load event' }, { status: 500 });
  }
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (event.status !== 'open') {
    return NextResponse.json({ error: '活动未开放报名（仅 open 状态可登记）' }, { status: 400 });
  }

  // Member must exist and be active.
  const { data: member } = await supabaseAdmin.from('members').select('id, status').eq('id', memberId).maybeSingle();
  if (!member) return NextResponse.json({ error: '会员不存在' }, { status: 400 });
  if (member.status !== 'active') return NextResponse.json({ error: '会员已停用，无法登记' }, { status: 400 });

  // Optional volunteer team must exist.
  let volunteerTeamId: string | null = null;
  if (body.volunteer_team_id !== undefined && body.volunteer_team_id !== null && body.volunteer_team_id !== '') {
    const tid = String(body.volunteer_team_id);
    const { data: team } = await supabaseAdmin.from('teams').select('id').eq('id', tid).maybeSingle();
    if (!team) return NextResponse.json({ error: '义工组无效' }, { status: 400 });
    volunteerTeamId = tid;
  }

  // No duplicate active registration for this member on this event.
  const { data: dupe } = await supabaseAdmin
    .from('registrations')
    .select('reg_no')
    .eq('event_id', id)
    .eq('member_id', memberId)
    .in('status', ['pending', 'approved'])
    .maybeSingle();
  if (dupe) {
    return NextResponse.json({ error: '该会员已报名此活动', existing: { reg_no: dupe.reg_no } }, { status: 409 });
  }

  // Recompute fees server-side from the event's fee items — never trust client totals.
  const selections = parseSelections(body.selections);
  const { data: feeRows } = await supabaseAdmin.from('event_fees').select('item, label_cn, amount, billing').eq('event_id', id);
  const fees = ((feeRows ?? []) as { item: string; label_cn: string | null; amount: number; billing: string }[]).map(
    (f) => ({ item: f.item, label_cn: f.label_cn, amount: Number(f.amount), billing: f.billing }) as FeeItem
  );

  // When meals bill per_item, every submitted meal key must be an OFFERED slot of this
  // event (zero meals is valid — meals are never compulsory).
  const mealPerItem = fees.some((f) => f.item === 'meal' && f.billing === 'per_item');
  if (mealPerItem && selections.meals?.length) {
    const offered = await fetchOfferedKeys(supabaseAdmin, id);
    const bad = invalidMealKeys(selections.meals, offered);
    if (bad.length) return NextResponse.json({ error: `餐点选项无效（未供应）：${bad.join('、')}` }, { status: 400 });
  } else if (!mealPerItem) {
    delete selections.meals; // ignore stray meal cells when the event isn't per_item
  }

  const { total, breakdown } = computeFees(fees, selections);

  const approve = event.requires_approval === false;
  const me = access.volunteer;
  const nowIso = new Date().toISOString();

  const base = {
    event_id: id,
    member_id: memberId,
    volunteer_team_id: volunteerTeamId,
    selections,
    fee_total: total,
    fee_breakdown: breakdown,
    status: approve ? 'approved' : 'pending',
    decided_by: approve ? me.id : null,
    decided_at: approve ? nowIso : null,
    notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
    created_by: me.id,
    updated_by: me.id,
  };

  // reg_no = event code + zero-padded seq (count + 1); retry on unique collision.
  const { count } = await supabaseAdmin.from('registrations').select('id', { count: 'exact', head: true }).eq('event_id', id);
  let seq = (count ?? 0) + 1;
  let inserted: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const regNo = `${event.code}-${String(seq).padStart(4, '0')}`;
    const { data, error } = await supabaseAdmin.from('registrations').insert({ ...base, reg_no: regNo }).select('*').single();
    if (!error && data) { inserted = data; break; }
    if (error?.code === '23505') { seq++; continue; } // reg_no taken — next seq
    console.error('[registrations] insert failed:', error);
    return NextResponse.json({ error: '登记失败，请重试' }, { status: 500 });
  }
  if (!inserted) return NextResponse.json({ error: '无法生成报名编号，请重试' }, { status: 500 });

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'events',
    action: 'create',
    tableName: 'registrations',
    recordId: inserted.id as string,
    after: {
      reg_no: inserted.reg_no,
      event_id: id,
      member_id: memberId,
      status: inserted.status,
      fee_total: total,
      fee_breakdown: breakdown,
    },
  });

  return NextResponse.json({ registration: inserted }, { status: 201 });
}
