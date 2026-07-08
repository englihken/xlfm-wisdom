// src/app/r/[token]/status/page.tsx
// PUBLIC status lookup (C2). reg_no + phone → POST /api/public/lookup → a masked summary.
// NO auth. Public editing is intentionally NOT offered (C1 has no public selections-edit
// route — only staff may 修改选项); we state that plainly. Wrong/unknown → warm not-found.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { moneyRM, REG_STATUS_LABELS, REG_STATUS_STYLES, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_STYLES } from '@/lib/events-display';
import { ProofUploader } from '../page';

type LookupResult = {
  reg_no: string; status: string; fee_total: number;
  payment_status: string; has_proof: boolean;
  event: { title: string; code: string; starts_on: string; ends_on: string | null } | null;
  selections: Record<string, unknown>;
};

function selSummary(sel: Record<string, unknown>): string {
  const p: string[] = [];
  if (Number(sel.meals) > 0) p.push(`🍚${sel.meals}餐`);
  if (Number(sel.meal_days) > 0) p.push(`🍚${sel.meal_days}天`);
  if (Number(sel.nights) > 0) p.push(`🏨${sel.nights}晚`);
  if (sel.transfer === true) p.push('🚐 接送');
  const u = sel.uniform as { size?: string; qty?: number } | undefined;
  if (u?.qty) p.push(`👕${u.size ?? ''}×${u.qty}`);
  return p.join(' ');
}

export default function StatusLookupPage() {
  const { token } = useParams<{ token: string }>();
  const [regNo, setRegNo] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'found' | 'notfound'>('idle');
  const [result, setResult] = useState<LookupResult | null>(null);

  async function lookup() {
    setBusy(true);
    setState('idle');
    try {
      const res = await fetch('/api/public/lookup', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reg_no: regNo.trim(), phone }),
      });
      if (!res.ok) { setState('notfound'); setResult(null); return; }
      setResult((await res.json()) as LookupResult);
      setState('found');
    } catch {
      setState('notfound');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-border rounded-2xl p-4">
        <h1 className="font-serif font-semibold text-ink mb-1">查询我的报名</h1>
        <p className="text-xs text-ink-muted mb-3">输入报名编号与手机号查询状态。</p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">报名编号 Reg. No.</label>
            <input value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="XLFM-2608-0001"
              className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 font-mono text-ink placeholder:text-ink-faint outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">手机号 Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="0123456789"
              className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-ink placeholder:text-ink-faint outline-none focus:border-accent" />
          </div>
          <button onClick={lookup} disabled={busy || !regNo.trim() || !phone.trim()}
            className="w-full btn-primary py-2.5 font-medium">
            {busy ? '查询中…' : '查询'}
          </button>
        </div>
      </div>

      {state === 'notfound' && (
        <div className="bg-surface border border-border rounded-2xl p-4 text-center">
          <div className="text-3xl mb-2">🙏</div>
          <p className="text-sm text-ink">找不到，请确认编号与手机号</p>
        </div>
      )}

      {state === 'found' && result && (
        <div className="bg-surface border border-border rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-ink">{result.reg_no}</span>
            <span className={`text-xs px-3 py-1 rounded-full ${REG_STATUS_STYLES[result.status] ?? 'pill-muted'}`}>
              {REG_STATUS_LABELS[result.status] ?? result.status}
            </span>
          </div>
          {result.event && (
            <p className="text-sm text-ink">{result.event.title}
              <span className="text-xs text-ink-muted"> · {result.event.starts_on}{result.event.ends_on && result.event.ends_on !== result.event.starts_on ? ` — ${result.event.ends_on}` : ''}</span>
            </p>
          )}
          {selSummary(result.selections) && <p className="text-sm text-ink-muted">{selSummary(result.selections)}</p>}
          <div className="flex items-center justify-between pt-2 border-t border-border text-sm">
            <span className="text-ink-muted">费用合计</span>
            <div className="flex items-center gap-2">
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${PAYMENT_STATUS_STYLES[result.payment_status] ?? PAYMENT_STATUS_STYLES.unpaid}`}>
                {PAYMENT_STATUS_LABELS[result.payment_status] ?? '未付款'}
              </span>
              <span className="font-semibold text-ink">{moneyRM(result.fee_total)}</span>
            </div>
          </div>

          {/* optional receipt upload — gentle, addable anytime; never required */}
          {result.fee_total > 0 && result.payment_status !== 'waived' && (
            <div className="pt-2">
              <ProofUploader regNo={result.reg_no} phone={phone} onUploaded={lookup} />
            </div>
          )}

          <p className="text-xs text-ink-faint pt-1">如需修改用餐或其他选项，请联系活动负责人。</p>
        </div>
      )}

      <div className="text-center">
        <Link href={`/r/${token}`} className="text-sm text-ink-muted">← 返回报名</Link>
      </div>
    </div>
  );
}
