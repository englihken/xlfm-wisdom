// src/app/r/[token]/status/page.tsx
// PUBLIC status lookup (C2). reg_no + phone → POST /api/public/lookup → a masked summary.
// NO auth. Public editing is intentionally NOT offered (C1 has no public selections-edit
// route — only staff may 修改选项); we state that plainly. Wrong/unknown → warm not-found.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { moneyRM } from '@/lib/events-display';
import { REG_STATUS_LABELS, REG_STATUS_STYLES } from '@/lib/events-display';

type LookupResult = {
  reg_no: string; status: string; fee_total: number;
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
      <div className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl p-4">
        <h1 className="font-semibold text-[#583A0F] mb-1">查询我的报名</h1>
        <p className="text-xs text-[#8B6F47] mb-3">输入报名编号与手机号查询状态。</p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-[#583A0F] mb-1">报名编号 Reg. No.</label>
            <input value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="XLFM-2608-0001"
              className="w-full rounded-xl border border-[#EFE3BF] bg-white px-3 py-2.5 font-mono outline-none focus:border-[#D89938]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#583A0F] mb-1">手机号 Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="0123456789"
              className="w-full rounded-xl border border-[#EFE3BF] bg-white px-3 py-2.5 outline-none focus:border-[#D89938]" />
          </div>
          <button onClick={lookup} disabled={busy || !regNo.trim() || !phone.trim()}
            className="w-full rounded-xl bg-[#D89938] text-white py-2.5 font-medium disabled:opacity-50">
            {busy ? '查询中…' : '查询'}
          </button>
        </div>
      </div>

      {state === 'notfound' && (
        <div className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl p-4 text-center">
          <div className="text-3xl mb-2">🙏</div>
          <p className="text-sm text-[#583A0F]">找不到，请确认编号与手机号</p>
        </div>
      )}

      {state === 'found' && result && (
        <div className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[#583A0F]">{result.reg_no}</span>
            <span className={`text-xs px-3 py-1 rounded-full ${REG_STATUS_STYLES[result.status] ?? 'bg-[#F1EADA] text-[#8B6F47]'}`}>
              {REG_STATUS_LABELS[result.status] ?? result.status}
            </span>
          </div>
          {result.event && (
            <p className="text-sm text-[#583A0F]">{result.event.title}
              <span className="text-xs text-[#8B6F47]"> · {result.event.starts_on}{result.event.ends_on && result.event.ends_on !== result.event.starts_on ? ` — ${result.event.ends_on}` : ''}</span>
            </p>
          )}
          {selSummary(result.selections) && <p className="text-sm text-[#8B6F47]">{selSummary(result.selections)}</p>}
          <div className="flex items-center justify-between pt-2 border-t border-[#EFE3BF] text-sm">
            <span className="text-[#8B6F47]">费用合计</span>
            <span className="font-semibold text-[#583A0F]">{moneyRM(result.fee_total)}</span>
          </div>
          <p className="text-xs text-[#B89968] pt-1">如需修改，请联系活动负责人。</p>
        </div>
      )}

      <div className="text-center">
        <Link href={`/r/${token}`} className="text-sm text-[#8B6F47]">← 返回报名</Link>
      </div>
    </div>
  );
}
