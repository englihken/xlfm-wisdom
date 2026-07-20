// src/app/api/dashboard/events/[id]/collect/close/route.ts
// 日结 — the daily cash close. HQ finance only (总会对钱): counting the box and
// banking it is the step only HQ can vouch for.
//
// GET  ?date= — the close for that MYT day if it exists, plus the expected
//      figure recomputed live from the day's cash registrations.
// POST { date, counted_cents, witnessed_by, variance_note? } — record the count.
// POST { action:'bank', close_id, account_id } — post it to the ledger.
//
// TWO PEOPLE, always: the DB's ecc_two_person CHECK enforces counter ≠ witness,
// and one close per (event, date) via a UNIQUE. Both are re-checked here so the
// desk gets a sentence instead of a constraint error, but the DB is the wall.
//
// THE LEDGER RULE: banking creates exactly ONE finance_transactions income row
// for the COUNTED amount. Individual cash registrations never get ledger rows —
// they are the subledger. Posting both would double-count every ringgit.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { financeScope } from '@/lib/finance';
import { eventsScope } from '@/lib/members-scope';
import { mayRunCheckin } from '@/lib/event-checkin';
import { UUID_RE, DATE_RE } from '@/lib/finance-cashbook';
import { todayMYT } from '@/lib/events';
import { isHqFinance, sumCents, fromCents, mytDateOf, closeReference } from '@/lib/event-payments';

export const runtime = 'nodejs';

const EVENT_INCOME_GRP = 'event'; // finance_categories.grp for 活动收入

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

// The desk wall (events:edit at a hosting centre) AND the HQ money wall.
async function guard(id: string) {
  const access = await requireModuleAccess('events', 'edit');
  if (!access.ok) return { err: gate(access.status) };
  const fin = await requireModuleAccess('finance', 'edit');
  if (!fin.ok) return { err: gate(fin.status) };
  if (!supabaseAdmin) return { err: NextResponse.json({ error: 'Storage unavailable' }, { status: 503 }) };
  if (!UUID_RE.test(id)) return { err: NextResponse.json({ error: 'Not found' }, { status: 404 }) };

  const { data: ev } = await supabaseAdmin
    .from('events')
    .select('id, code, title, organizing_centre_id, co_centre_ids')
    .eq('id', id)
    .maybeSingle();
  if (!ev || !mayRunCheckin(eventsScope(access.volunteer), ev)) {
    return { err: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  if (!isHqFinance(financeScope(fin.volunteer))) {
    return { err: NextResponse.json({ error: '日结与入账由总会财政操作' }, { status: 403 }) };
  }
  return { access, ev };
}

// Σ of the day's cash takings, in cents — what the box should hold.
async function expectedCents(eventId: string, day: string): Promise<number> {
  const { data } = await supabaseAdmin!
    .from('registrations')
    .select('paid_amount, payment_verified_at')
    .eq('event_id', eventId)
    .eq('payment_method', 'cash')
    .in('payment_status', ['verified', 'reconciled'])
    .limit(20000);
  const rows = ((data ?? []) as { paid_amount: number | string | null; payment_verified_at: string | null }[]).filter(
    (r) => r.payment_verified_at && mytDateOf(r.payment_verified_at) === day
  );
  return sumCents(rows.map((r) => r.paid_amount ?? 0));
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.err) return g.err;

  const dateParam = new URL(req.url).searchParams.get('date');
  const day = dateParam && DATE_RE.test(dateParam) ? dateParam : todayMYT();

  const [{ data: close }, expected, { data: accounts }, { data: vols }] = await Promise.all([
    supabaseAdmin!
      .from('event_cash_closes')
      .select('id, close_date, expected_cents, counted_cents, counted_by, witnessed_by, variance_note, banked_at, finance_txn_id, created_at')
      .eq('event_id', id)
      .eq('close_date', day)
      .maybeSingle(),
    expectedCents(id, day),
    // Money lands in ONE place: the HQ account. Only 总会 accounts are offered.
    supabaseAdmin!
      .from('finance_accounts')
      .select('id, name, kind, centre:centres!centre_id ( code )')
      .eq('is_active', true)
      .limit(100),
    // The witness picker. /api/dashboard/volunteers is admin-only and a
    // finance_director running a close is not an admin, so the list is served
    // here — id + display name only, nothing more than naming a person needs.
    supabaseAdmin!.from('volunteers').select('id, display_name, email').eq('active', true).limit(500),
  ]);

  const hqAccounts = ((accounts ?? []) as { id: string; name: string; kind: string; centre: { code: string } | { code: string }[] | null }[])
    .filter((a) => {
      const c = Array.isArray(a.centre) ? a.centre[0] : a.centre;
      return c?.code === 'HQ';
    })
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind }));

  return NextResponse.json({
    date: day,
    expectedCents: expected,
    expected: fromCents(expected),
    close: close ?? null,
    hqAccounts,
    // The counter cannot witness their own count (ecc_two_person), so they are
    // filtered out of their own picker rather than being offered and rejected.
    witnesses: ((vols ?? []) as { id: string; display_name: string | null; email: string }[])
      .filter((v) => v.id !== g.access!.volunteer.id)
      .map((v) => ({ id: v.id, name: v.display_name || v.email })),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.err) return g.err;
  const me = g.access!.volunteer;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  // ── 入账: post the counted cash to the ledger ─────────────────────────────
  if (body.action === 'bank') {
    const closeId = typeof body.close_id === 'string' ? body.close_id : '';
    const accountId = typeof body.account_id === 'string' ? body.account_id : '';
    if (!UUID_RE.test(closeId)) return NextResponse.json({ error: '日结记录无效' }, { status: 400 });
    if (!UUID_RE.test(accountId)) return NextResponse.json({ error: '账户无效' }, { status: 400 });

    const { data: close } = await supabaseAdmin!
      .from('event_cash_closes')
      .select('id, event_id, close_date, counted_cents, banked_at, finance_txn_id')
      .eq('id', closeId)
      .maybeSingle();
    if (!close || close.event_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Idempotence by refusal: a second bank would double the ledger.
    if (close.banked_at || close.finance_txn_id) {
      return NextResponse.json({ error: '该日结已入账' }, { status: 400 });
    }

    const { data: account } = await supabaseAdmin!
      .from('finance_accounts')
      .select('id, centre_id, is_active, centre:centres!centre_id ( code )')
      .eq('id', accountId)
      .maybeSingle();
    const accCentre = account ? (Array.isArray(account.centre) ? account.centre[0] : account.centre) : null;
    if (!account || !account.is_active) return NextResponse.json({ error: '账户无效' }, { status: 400 });
    if (accCentre?.code !== 'HQ') return NextResponse.json({ error: '活动现金须存入总会账户' }, { status: 400 });

    const { data: cat } = await supabaseAdmin!
      .from('finance_categories')
      .select('id')
      .eq('kind', 'income')
      .eq('grp', EVENT_INCOME_GRP)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (!cat) return NextResponse.json({ error: '找不到「活动收入」类别' }, { status: 400 });

    const amount = fromCents(Number(close.counted_cents));
    if (!(amount > 0)) return NextResponse.json({ error: '点数为 0，无需入账' }, { status: 400 });

    const ref = closeReference(g.ev!.code as string, close.close_date as string);
    const { data: txn, error: txnErr } = await supabaseAdmin!
      .from('finance_transactions')
      .insert({
        centre_id: account.centre_id,
        txn_date: close.close_date,
        direction: 'in',
        category_id: cat.id,
        account_id: accountId,
        amount,
        description: `活动现金日结 · ${g.ev!.title}`,
        reference: ref,
        entered_by: me.id,
      })
      .select('id, amount, txn_date, reference')
      .single();
    if (txnErr || !txn) {
      console.error('[close/bank] ledger insert failed:', txnErr);
      return NextResponse.json({ error: '入账失败，请重试' }, { status: 500 });
    }

    const { data: banked, error: updErr } = await supabaseAdmin!
      .from('event_cash_closes')
      .update({ banked_at: new Date().toISOString(), finance_txn_id: txn.id })
      .eq('id', closeId)
      .is('banked_at', null) // last-writer guard: a concurrent bank finds nothing to update
      .select('id, banked_at, finance_txn_id')
      .single();
    if (updErr || !banked) {
      // The ledger row exists but the link failed — say so loudly rather than
      // leaving a treasurer to find an orphan posting.
      console.error('[close/bank] link failed AFTER ledger insert:', updErr, 'txn:', txn.id);
      return NextResponse.json({ error: `入账已记录（凭证 ${ref}）但未能关联日结，请联系管理员` }, { status: 500 });
    }

    await writeAudit({
      actorId: me.id,
      actorEmail: me.email,
      module: 'finance',
      action: 'event.cash_banked',
      tableName: 'event_cash_closes',
      recordId: closeId,
      after: { event_id: id, close_date: close.close_date, amount, account_id: accountId, finance_txn_id: txn.id, reference: ref },
    });

    return NextResponse.json({ close: banked, txn });
  }

  // ── create the close ──────────────────────────────────────────────────────
  const date = typeof body.date === 'string' && DATE_RE.test(body.date) ? body.date : '';
  if (!date) return NextResponse.json({ error: '日期无效' }, { status: 400 });
  const counted = Number(body.counted_cents);
  if (!Number.isInteger(counted) || counted < 0) return NextResponse.json({ error: '点数无效（须为整数分）' }, { status: 400 });
  const witness = typeof body.witnessed_by === 'string' ? body.witnessed_by : '';
  if (!UUID_RE.test(witness)) return NextResponse.json({ error: '请选择监点人' }, { status: 400 });
  if (witness === me.id) return NextResponse.json({ error: '监点人须为另一位同工' }, { status: 400 });

  const { data: witnessRow } = await supabaseAdmin!.from('volunteers').select('id, active').eq('id', witness).maybeSingle();
  if (!witnessRow || !witnessRow.active) return NextResponse.json({ error: '监点人无效' }, { status: 400 });

  const expected = await expectedCents(id, date);
  const variance = typeof body.variance_note === 'string' ? body.variance_note.trim() : '';
  // A mismatch must be explained. Silence here is how a shortfall becomes
  // invisible three weeks later.
  if (counted !== expected && !variance) {
    return NextResponse.json(
      { error: '点数与应收不符，请填写差异说明', expectedCents: expected, countedCents: counted },
      { status: 400 }
    );
  }

  const { data: close, error } = await supabaseAdmin!
    .from('event_cash_closes')
    .insert({
      event_id: id,
      close_date: date,
      expected_cents: expected,
      counted_cents: counted,
      counted_by: me.id,
      witnessed_by: witness,
      variance_note: variance || null,
      created_by: me.id,
    })
    .select('id, close_date, expected_cents, counted_cents, counted_by, witnessed_by, variance_note, banked_at')
    .single();
  if (error) {
    // 23505 = the (event_id, close_date) UNIQUE — one close per day, by design.
    if (error.code === '23505') return NextResponse.json({ error: '当天已有日结记录' }, { status: 400 });
    // 23514 = ecc_two_person, if the pre-check above were ever bypassed.
    if (error.code === '23514') return NextResponse.json({ error: '监点人须为另一位同工' }, { status: 400 });
    console.error('[close] insert failed:', error);
    return NextResponse.json({ error: '日结失败，请重试' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'event.cash_close',
    tableName: 'event_cash_closes',
    recordId: close.id as string,
    after: {
      event_id: id, close_date: date, expected_cents: expected, counted_cents: counted,
      variance_cents: counted - expected, witnessed_by: witness,
    },
  });

  return NextResponse.json({ close }, { status: 201 });
}
