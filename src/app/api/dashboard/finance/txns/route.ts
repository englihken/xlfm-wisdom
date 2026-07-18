// src/app/api/dashboard/finance/txns/route.ts
// GET  (finance:view, SCOPE-FORCED) — the 流水 list. Filters: centre_id, month,
//      direction, category_id, account_id, q (description/reference search). An
//      all_centers caller may omit centre_id to see every centre; an own_center
//      财政 is forced to theirs. Voided rows ARE returned so the UI can strike them
//      through — they are excluded from every total on the client and from the
//      balance math server-side.
// POST (finance:edit, SCOPE-FORCED) — record one 收入/支出/转账 row. The account is
//      re-read server-side and its centre_id checked against the enforced scope:
//      a client-supplied account_id from another centre is rejected, not trusted.
//      Category kind must match the direction (income↔in, expense↔out), enforced
//      here so the DB's fin_txn_category_rule is never the thing that errors.
//      Own-centre transfers only (bank↔cash); inter-centre is Phase 3.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { writeAudit } from '@/lib/audit';
import { financeScope, enforceScope } from '@/lib/finance';
import { isTxnDirection, monthWindow, DATE_RE, RECEIPT_PATH_RE, UUID_RE } from '@/lib/finance-cashbook';

export const runtime = 'nodejs';

const TXN_SELECT =
  'id, centre_id, txn_date, direction, amount, description, reference, receipt_path, ' +
  'account_id, counterparty_account_id, category_id, voided_at, void_reason, created_at, ' +
  'account:finance_accounts!finance_transactions_account_id_fkey ( id, name, kind ), ' +
  'counterparty:finance_accounts!finance_transactions_counterparty_account_id_fkey ( id, name, kind ), ' +
  'category:finance_categories!category_id ( id, kind, grp, name_cn, name_en, name_id ), ' +
  'centre:centres!centre_id ( id, name_cn ), ' +
  'enterer:volunteers!entered_by ( display_name, email )';

function gate(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status });
}

// PostgREST's .or() takes a comma-separated filter grammar, so a raw search term
// containing , ( ) . or a wildcard would break out of the ilike pattern and change
// the query. Strip the grammar characters rather than escaping them — the search
// box is a convenience, not a query language.
function safeSearch(raw: string): string {
  return raw.replace(/[,()*%\\.:"']/g, ' ').trim().slice(0, 60);
}

export async function GET(req: Request) {
  const access = await requireModuleAccess('finance', 'view');
  if (!access.ok) return gate(access.status);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const scope = financeScope(access.volunteer);
  const enforced = enforceScope(scope, sp.get('centre_id'));
  if (!enforced.ok) return NextResponse.json({ error: enforced.error }, { status: 400 });
  const centreId = enforced.centreId; // null = all centres, only reachable when unlocked

  let q = supabaseAdmin.from('finance_transactions').select(TXN_SELECT);
  if (centreId) q = q.eq('centre_id', centreId);

  const month = sp.get('month');
  if (month) {
    const win = monthWindow(month);
    if (!win) return NextResponse.json({ error: '月份无效' }, { status: 400 });
    q = q.gte('txn_date', win.from).lt('txn_date', win.to);
  }

  const direction = sp.get('direction');
  if (direction) {
    if (!isTxnDirection(direction)) return NextResponse.json({ error: '类型无效' }, { status: 400 });
    q = q.eq('direction', direction);
  }
  const categoryId = sp.get('category_id');
  if (categoryId) {
    if (!UUID_RE.test(categoryId)) return NextResponse.json({ error: '类别无效' }, { status: 400 });
    q = q.eq('category_id', categoryId);
  }
  const accountId = sp.get('account_id');
  if (accountId) {
    // Shape-checked before interpolation: this lands in an .or() filter STRING,
    // which PostgREST does not value-encode (see UUID_RE).
    if (!UUID_RE.test(accountId)) return NextResponse.json({ error: '账户无效' }, { status: 400 });
    // Match either leg: a transfer shows on both the source and destination wallet.
    q = q.or(`account_id.eq.${accountId},counterparty_account_id.eq.${accountId}`);
  }

  const rawQ = sp.get('q');
  if (rawQ && rawQ.trim()) {
    const term = safeSearch(rawQ);
    if (term) q = q.or(`description.ilike.%${term}%,reference.ilike.%${term}%`);
  }

  const { data, error } = await q
    .order('txn_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    console.error('[finance/txns] list failed:', error);
    return NextResponse.json({ error: 'Failed to load transactions' }, { status: 500 });
  }

  return NextResponse.json({ centreId, txns: data ?? [] });
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

  const direction = body.direction;
  if (!isTxnDirection(direction)) return NextResponse.json({ error: '类型无效' }, { status: 400 });

  const txnDate = typeof body.txn_date === 'string' && DATE_RE.test(body.txn_date) ? body.txn_date : '';
  if (!txnDate) return NextResponse.json({ error: '日期无效' }, { status: 400 });

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || !(amount > 0)) return NextResponse.json({ error: '金额须大于 0' }, { status: 400 });

  // ── the account wall: re-read the account and prove it belongs to the enforced
  // centre. Never trust the client's account_id to be in-scope.
  const accountId = typeof body.account_id === 'string' ? body.account_id : '';
  if (!accountId) return NextResponse.json({ error: '请选择账户' }, { status: 400 });
  const { data: account } = await supabaseAdmin
    .from('finance_accounts')
    .select('id, centre_id, is_active, name, opening_as_of')
    .eq('id', accountId)
    .maybeSingle();
  if (!account || account.centre_id !== centreId) return NextResponse.json({ error: '账户无效' }, { status: 400 });
  if (!account.is_active) return NextResponse.json({ error: '该账户已停用' }, { status: 400 });
  // opening_as_of rule: opening_balance already states the position on that date,
  // so an earlier-dated entry would double-count. Refuse it with the date named,
  // rather than silently accepting a row the balance math will then ignore.
  if (account.opening_as_of && txnDate < account.opening_as_of) {
    return NextResponse.json(
      { error: `日期不能早于账户「${account.name}」的期初日期 ${account.opening_as_of}` },
      { status: 400 }
    );
  }

  let categoryId: string | null = null;
  let counterpartyAccountId: string | null = null;

  if (direction === 'transfer') {
    // Own-centre bank↔cash only. Inter-centre transfers are Phase 3 and are
    // rejected here rather than silently written with a counterparty_centre_id.
    const dst = typeof body.counterparty_account_id === 'string' ? body.counterparty_account_id : '';
    if (!dst) return NextResponse.json({ error: '请选择转入账户' }, { status: 400 });
    if (dst === accountId) return NextResponse.json({ error: '转出与转入账户不能相同' }, { status: 400 });
    const { data: dstAccount } = await supabaseAdmin
      .from('finance_accounts')
      .select('id, centre_id, is_active, name, opening_as_of')
      .eq('id', dst)
      .maybeSingle();
    if (!dstAccount || dstAccount.centre_id !== centreId) return NextResponse.json({ error: '转入账户无效' }, { status: 400 });
    if (!dstAccount.is_active) return NextResponse.json({ error: '转入账户已停用' }, { status: 400 });
    // The destination leg has its own cutoff — the two wallets can differ.
    if (dstAccount.opening_as_of && txnDate < dstAccount.opening_as_of) {
      return NextResponse.json(
        { error: `日期不能早于账户「${dstAccount.name}」的期初日期 ${dstAccount.opening_as_of}` },
        { status: 400 }
      );
    }
    counterpartyAccountId = dst;
  } else {
    // in/out — a category is REQUIRED and its kind must match the direction.
    const cid = typeof body.category_id === 'string' ? body.category_id : '';
    if (!cid) return NextResponse.json({ error: '请选择类别' }, { status: 400 });
    const { data: category } = await supabaseAdmin
      .from('finance_categories')
      .select('id, kind, is_active')
      .eq('id', cid)
      .maybeSingle();
    if (!category) return NextResponse.json({ error: '类别无效' }, { status: 400 });
    if (!category.is_active) return NextResponse.json({ error: '该类别已停用' }, { status: 400 });
    const wanted = direction === 'in' ? 'income' : 'expense';
    if (category.kind !== wanted) return NextResponse.json({ error: '类别与收支方向不符' }, { status: 400 });
    categoryId = cid;
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';

  let receiptPath: string | null = null;
  if (typeof body.receipt_path === 'string' && body.receipt_path.trim()) {
    const p = body.receipt_path.trim();
    if (!RECEIPT_PATH_RE.test(p)) return NextResponse.json({ error: '单据照片无效' }, { status: 400 });
    receiptPath = p;
  }

  const me = access.volunteer;
  const { data: txn, error: insErr } = await supabaseAdmin
    .from('finance_transactions')
    .insert({
      centre_id: centreId,
      txn_date: txnDate,
      direction,
      category_id: categoryId,
      account_id: accountId,
      counterparty_account_id: counterpartyAccountId,
      counterparty_centre_id: null, // Phase 3
      amount,
      description: description || null,
      reference: reference || null,
      receipt_path: receiptPath,
      entered_by: me.id,
    })
    .select(TXN_SELECT)
    .single();
  if (insErr || !txn) {
    console.error('[finance/txns] insert failed:', insErr);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }

  await writeAudit({
    actorId: me.id,
    actorEmail: me.email,
    module: 'finance',
    action: 'create',
    tableName: 'finance_transactions',
    recordId: (txn as unknown as { id: string }).id,
    after: { centre_id: centreId, txn_date: txnDate, direction, category_id: categoryId, account_id: accountId, counterparty_account_id: counterpartyAccountId, amount, description, reference },
  });

  return NextResponse.json({ txn }, { status: 201 });
}
