// src/app/api/dashboard/finance/accounts/route.ts
// GET  ?centre_id= (finance:view, SCOPE-FORCED) — the centre's 账户 (bank/cash wallets)
//      each with its CURRENT balance = opening_balance + Σ(in) − Σ(out) ± transfers,
//      voided excluded, plus the centre total. Balance math lives in finance-cashbook.
// POST (finance:edit, SCOPE-FORCED) — create an account: name, kind, opening_balance,
//      opening_as_of. Audited.
// The scope wall is the REAL boundary here: these routes run as service-role and
// bypass RLS, so an own_center 财政 is forced to their own centre by enforceScope.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { financeScope, enforceScope } from '@/lib/finance';
import { computeBalances, sumBalances, isAccountKind, DATE_RE } from '@/lib/finance-cashbook';

export const runtime = 'nodejs';

const ACCOUNT_SELECT = 'id, centre_id, kind, name, opening_balance, opening_as_of, is_active, sort, created_at';

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

export async function GET(req: Request) {
  const access = await requireModuleAccess('finance', 'view');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const scope = financeScope(access.volunteer);
  const enforced = enforceScope(scope, sp.get('centre_id'));
  if (!enforced.ok) return NextResponse.json({ error: enforced.error }, { status: 400 });
  const centreId = enforced.centreId;
  if (!centreId) return NextResponse.json({ error: '请选择中心' }, { status: 400 });

  const { data: accounts, error } = await supabaseAdmin
    .from('finance_accounts')
    .select(ACCOUNT_SELECT)
    .eq('centre_id', centreId)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[finance/accounts] list failed:', error);
    return NextResponse.json({ error: 'Failed to load accounts' }, { status: 500 });
  }

  const rows = accounts ?? [];
  // Every non-voided txn of the centre — NOT a month slice. A balance is
  // cumulative, so filtering by month here would understate it.
  const { data: txns, error: tErr } = rows.length
    ? await supabaseAdmin
        .from('finance_transactions')
        .select('direction, amount, account_id, counterparty_account_id, voided_at')
        .eq('centre_id', centreId)
        .is('voided_at', null)
    : { data: [], error: null };
  if (tErr) {
    console.error('[finance/accounts] txns failed:', tErr);
    return NextResponse.json({ error: 'Failed to load accounts' }, { status: 500 });
  }

  const balances = computeBalances(rows, txns ?? []);
  const out = rows.map((a) => ({ ...a, balance: balances.get(a.id) ?? Number(a.opening_balance) }));
  // Total spans ACTIVE accounts only — an archived wallet shouldn't inflate the
  // centre's cash position, though its own balance stays visible on its row.
  const total = sumBalances(out.filter((a) => a.is_active).map((a) => a.balance));

  return NextResponse.json({ centreId, accounts: out, total });
}

export async function POST(req: Request) {
  const access = await requireModuleAccess('finance', 'edit');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const scope = financeScope(access.volunteer);
  const enforced = enforceScope(scope, typeof body.centre_id === 'string' ? body.centre_id : null);
  if (!enforced.ok) return NextResponse.json({ error: enforced.error }, { status: 400 });
  const centreId = enforced.centreId;
  if (!centreId) return NextResponse.json({ error: '请选择中心' }, { status: 400 });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: '请填写账户名称' }, { status: 400 });
  const kind = body.kind;
  if (!isAccountKind(kind)) return NextResponse.json({ error: '账户类型无效' }, { status: 400 });

  // Opening balance MAY be negative (an overdrawn float) but must be a real number.
  const opening = body.opening_balance === '' || body.opening_balance == null ? 0 : Number(body.opening_balance);
  if (!Number.isFinite(opening)) return NextResponse.json({ error: '期初余额无效' }, { status: 400 });

  let openingAsOf: string | null = null;
  if (typeof body.opening_as_of === 'string' && body.opening_as_of.trim()) {
    if (!DATE_RE.test(body.opening_as_of)) return NextResponse.json({ error: '期初日期无效' }, { status: 400 });
    openingAsOf = body.opening_as_of;
  }

  const me = access.volunteer;
  const { data: account, error: insErr } = await supabaseAdmin
    .from('finance_accounts')
    .insert({ centre_id: centreId, kind, name, opening_balance: opening, opening_as_of: openingAsOf, created_by: me.id })
    .select(ACCOUNT_SELECT)
    .single();
  if (insErr || !account) {
    console.error('[finance/accounts] insert failed:', insErr);
    return NextResponse.json({ error: '保存账户失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'create',
    tableName: 'finance_accounts',
    recordId: account.id,
    after: { centre_id: centreId, kind, name, opening_balance: opening, opening_as_of: openingAsOf },
  });

  return NextResponse.json({ account: { ...account, balance: Number(account.opening_balance) } }, { status: 201 });
}
