// src/app/api/dashboard/finance/reconcile/route.ts
// 总会对账 — HQ finance ticks verified TRANSFER rows against the actual HQ bank
// statement. This is the check only HQ can do: a branch can confirm their member
// sent a proof, but only HQ can confirm the money arrived.
//
// GET  ?event_id= — the queue: payment_method='transfer' AND status='verified',
//      ALL centres (this is the one board that is deliberately not centre-scoped).
// POST { registration_ids[], account_id? } — set 'reconciled' + reconciled_by/at.
//      With account_id, also posts ONE finance_transactions income row for the
//      batch total, same shape as the 日结 posting.
//
// Cash never appears here: the 日结 banked step IS its reconciliation, and
// letting cash through twice would double-count it on the ledger.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { financeScope } from '@/lib/finance';
import { UUID_RE } from '@/lib/finance-cashbook';
import { todayMYT } from '@/lib/events';
import { isHqFinance, sumCents, fromCents } from '@/lib/event-payments';

export const runtime = 'nodejs';

const MAX_BATCH = 500;

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

async function hqGuard(level: 'view' | 'edit') {
  const access = await requireModuleAccess('finance', level);
  if (!access.ok) return { err: gate(access.status) };
  if (!supabaseAdmin) return { err: NextResponse.json({ error: 'Storage unavailable' }, { status: 503 }) };
  if (!isHqFinance(financeScope(access.volunteer))) {
    return { err: NextResponse.json({ error: '对账由总会财政操作' }, { status: 403 }) };
  }
  return { access };
}

type Member = { name_cn: string | null; centre: { name_cn: string } | { name_cn: string }[] | null };
type Row = {
  id: string; reg_no: string; fee_total: number | string; paid_amount: number | string | null;
  payment_note: string | null; payment_verified_at: string | null; applicant_name: string | null;
  member: Member | Member[] | null;
};
const flat = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function GET(req: Request) {
  const g = await hqGuard('view');
  if (g.err) return g.err;

  const eventId = new URL(req.url).searchParams.get('event_id') ?? '';
  if (!eventId || !UUID_RE.test(eventId)) return NextResponse.json({ error: '活动无效' }, { status: 400 });

  const [{ data, error }, { data: accounts }] = await Promise.all([
    supabaseAdmin!
      .from('registrations')
      .select('id, reg_no, fee_total, paid_amount, payment_note, payment_verified_at, applicant_name, member:members!member_id ( name_cn, centre:centres!gyt_centre_id ( name_cn ) )')
      .eq('event_id', eventId)
      .eq('payment_method', 'transfer')
      .eq('payment_status', 'verified')
      .order('payment_verified_at', { ascending: true })
      .limit(5000),
    supabaseAdmin!
      .from('finance_accounts')
      .select('id, name, kind, centre:centres!centre_id ( code )')
      .eq('is_active', true)
      .limit(100),
  ]);
  if (error) {
    console.error('[reconcile] list failed:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  const rows = ((data ?? []) as unknown as Row[]).map((r) => {
    const m = flat(r.member);
    return {
      id: r.id,
      reg_no: r.reg_no,
      name: m?.name_cn || r.applicant_name || '',
      centre_name: flat(m?.centre ?? null)?.name_cn ?? null,
      fee_total: Number(r.fee_total) || 0,
      paid_amount: r.paid_amount == null ? 0 : Number(r.paid_amount),
      payment_note: r.payment_note,
      verified_at: r.payment_verified_at,
    };
  });

  const hqAccounts = ((accounts ?? []) as { id: string; name: string; kind: string; centre: { code: string } | { code: string }[] | null }[])
    .filter((a) => flat(a.centre)?.code === 'HQ')
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind }));

  return NextResponse.json({
    rows,
    total: fromCents(sumCents(rows.map((r) => r.paid_amount))),
    hqAccounts,
  });
}

export async function POST(req: Request) {
  const g = await hqGuard('edit');
  if (g.err) return g.err;
  const me = g.access!.volunteer;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const ids = Array.isArray(body?.registration_ids) ? (body!.registration_ids as unknown[]) : [];
  const clean = [...new Set(ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))];
  if (clean.length === 0) return NextResponse.json({ error: '请选择要对账的记录' }, { status: 400 });
  if (clean.length > MAX_BATCH) return NextResponse.json({ error: `一次最多 ${MAX_BATCH} 笔` }, { status: 400 });

  // Only VERIFIED TRANSFER rows may be reconciled. Anything else in the payload
  // is dropped and reported — a silent partial success is worse than a count.
  const { data: eligible, error: selErr } = await supabaseAdmin!
    .from('registrations')
    .select('id, event_id, paid_amount, payment_status, payment_method')
    .in('id', clean)
    .eq('payment_status', 'verified')
    .eq('payment_method', 'transfer');
  if (selErr) {
    console.error('[reconcile] eligibility check failed:', selErr);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
  const rows = (eligible ?? []) as { id: string; event_id: string; paid_amount: number | string | null }[];
  const rejected = clean.length - rows.length;
  if (rows.length === 0) {
    return NextResponse.json({ error: '所选记录均不可对账（须为已核实的转账）', rejected }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error } = await supabaseAdmin!
    .from('registrations')
    .update({ payment_status: 'reconciled', payment_reconciled_by: me.id, payment_reconciled_at: nowIso, updated_at: nowIso, updated_by: me.id })
    .in('id', rows.map((r) => r.id))
    .select('id');
  if (error) {
    console.error('[reconcile] update failed:', error);
    return NextResponse.json({ error: '对账失败，请重试' }, { status: 500 });
  }

  const batchCents = sumCents(rows.map((r) => r.paid_amount ?? 0));
  let txn: { id: string; amount: number; reference: string | null } | null = null;

  // Optional batch posting. Deliberately AFTER the status update: if the ledger
  // insert fails, the rows are still correctly reconciled and HQ can post again
  // for the remainder — the reverse order could reconcile nothing but post money.
  const accountId = typeof body?.account_id === 'string' ? body.account_id : '';
  if (accountId) {
    if (!UUID_RE.test(accountId)) return NextResponse.json({ error: '账户无效' }, { status: 400 });
    const { data: account } = await supabaseAdmin!
      .from('finance_accounts')
      .select('id, centre_id, is_active, centre:centres!centre_id ( code )')
      .eq('id', accountId)
      .maybeSingle();
    const accCentre = account ? flat(account.centre as { code: string } | { code: string }[] | null) : null;
    if (!account || !account.is_active || accCentre?.code !== 'HQ') {
      return NextResponse.json({ error: '须选择总会账户', reconciled: updated?.length ?? 0 }, { status: 400 });
    }
    const { data: cat } = await supabaseAdmin!
      .from('finance_categories')
      .select('id').eq('kind', 'income').eq('grp', 'event').eq('is_active', true).limit(1).maybeSingle();
    if (!cat) return NextResponse.json({ error: '找不到「活动收入」类别', reconciled: updated?.length ?? 0 }, { status: 400 });

    const { data: ev } = await supabaseAdmin!.from('events').select('code, title').eq('id', rows[0].event_id).maybeSingle();
    const day = todayMYT();
    const ref = `${ev?.code ?? 'EVENT'}/对账/${day}`;
    const { data: t, error: txnErr } = await supabaseAdmin!
      .from('finance_transactions')
      .insert({
        centre_id: account.centre_id,
        txn_date: day,
        direction: 'in',
        category_id: cat.id,
        account_id: accountId,
        amount: fromCents(batchCents),
        description: `活动转账对账 · ${ev?.title ?? ''}（${rows.length} 笔）`,
        reference: ref,
        entered_by: me.id,
      })
      .select('id, amount, reference')
      .single();
    if (txnErr || !t) {
      console.error('[reconcile] ledger insert failed:', txnErr);
      return NextResponse.json(
        { reconciled: updated?.length ?? 0, rejected, txn: null, warning: '已对账，但入账失败，请稍后手动入账' },
        { status: 200 }
      );
    }
    txn = { id: t.id as string, amount: Number(t.amount), reference: (t.reference as string) ?? null };
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'reg.pay_reconcile',
    tableName: 'registrations',
    recordId: rows[0].event_id, // batch, recorded against the event
    after: {
      event_id: rows[0].event_id,
      reconciled: updated?.length ?? 0,
      rejected,
      amount: fromCents(batchCents),
      finance_txn_id: txn?.id ?? null,
    },
  });

  return NextResponse.json({ reconciled: updated?.length ?? 0, rejected, amount: fromCents(batchCents), txn });
}
