// src/app/f/fee-lookup-client.tsx
// PUBLIC 会员月费自查 (D5) — the interactive form, extracted verbatim from
// page.tsx in E3 so the page can be a SERVER component that checks org_settings
// public.fee_check_enabled (fail-open) before rendering this. Screen 1: phone →
// 查询. Screen 2: per ACTIVE member — MASKED name, centre + pledge, 已付至 card,
// 缴付记录, transparency block. All data from POST /api/public/fee-lookup.

'use client';

import { useState } from 'react';
import { pledgeLabel, moneyRM } from '@/lib/finance-display';
import { useT } from '@/lib/i18n-react';

type Member = {
  maskedName: string;
  centre: string | null;
  pledge: { fee_pledge_amount: number | null; fee_pledge_period: string | null; fee_waived_from: string | null };
  paidThrough: string | null;
  payments: { receipt_no: string; paid_at: string; amount: number; months_from: string; months_to: string }[];
  transparency: { collected: number; expenses: number; surplus: number; paused: boolean; pausedNote: string | null } | null;
};

function paidThroughLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${y} 年 ${Number(m)} 月`;
}

export function FeeLookupClient() {
  const t = useT();
  const [phone, setPhone] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [members, setMembers] = useState<Member[]>([]);

  const lookup = async () => {
    if (!phone.trim()) return;
    setState('loading');
    try {
      const res = await fetch('/api/public/fee-lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim() }) });
      const j = await res.json().catch(() => ({ members: [] }));
      setMembers(j.members ?? []);
    } catch {
      setMembers([]);
    } finally {
      setState('done');
    }
  };

  if (state === 'done' && members.length > 0) {
    return (
      <div className="space-y-4">
        {members.map((m, i) => (
          <MemberCard key={i} m={m} />
        ))}
        <button onClick={() => { setState('idle'); setMembers([]); setPhone(''); }} className="w-full py-2 text-sm text-accent-deep">{t('feeLookup.lookupAnother')}</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-surface border border-border rounded-2xl p-5">
        <p className="text-[10.5px] tracking-wide text-[#8A7444] uppercase mb-1.5">{t('feeLookup.phoneLabel')}</p>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="012-345 6789"
          onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }}
          className="w-full text-base px-3 py-2.5 border border-border-strong rounded-xl bg-surface-soft text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent" />
        <button disabled={state === 'loading'} onClick={lookup} className="w-full mt-3 py-2.5 text-sm btn-primary">{state === 'loading' ? t('feeLookup.lookingUp') : t('feeLookup.lookupButton')}</button>
        <p className="mt-2 text-[10.5px] text-ink-faint text-center">{t('feeLookup.privacyNote')}</p>
      </div>

      {state === 'done' && members.length === 0 && (
        <div className="bg-surface border border-border rounded-2xl p-6 text-center">
          <p className="text-2xl mb-1">🪷</p>
          <p className="text-sm text-ink">{t('feeLookup.notFound')}</p>
          <p className="mt-1 text-xs text-ink-muted">{t('feeLookup.notFoundSub')}</p>
        </div>
      )}
    </div>
  );
}

function MemberCard({ m }: { m: Member }) {
  const t = useT();
  const pl = pledgeLabel(m.pledge, t);
  const waived = !!m.pledge.fee_waived_from;
  const trans = m.transparency;
  return (
    <div className="space-y-3">
      <div className="text-center">
        <div className="font-serif text-base font-bold text-ink">{t('feeLookup.memberGreeting', { name: m.maskedName })}</div>
        <div className="text-xs text-ink-muted">{t('feeLookup.centrePledge', { centre: m.centre ?? '—', pledge: pl.text })}</div>
      </div>

      <div className="rounded-2xl p-5 text-center border" style={{ background: 'linear-gradient(150deg,#FCF4DF,#F8ECCB)', borderColor: '#EDDCAC' }}>
        <p className="text-[10.5px] tracking-wide text-[#8A7444] uppercase">{t('feeLookup.paidThroughLabel')}</p>
        {waived ? (
          <>
            <p className="font-serif text-2xl font-bold text-[#6B5B8A] my-1">{t('feeLookup.waived')}</p>
            <p className="text-xs text-ink-body">{t('feeLookup.waivedNote')}</p>
          </>
        ) : m.paidThrough ? (
          <>
            <p className="font-serif text-3xl font-bold text-accent-deep my-1">{paidThroughLabel(m.paidThrough)}</p>
            <p className="text-xs text-ink-body">{t('feeLookup.paidNote')}</p>
          </>
        ) : (
          <>
            <p className="font-serif text-xl font-bold text-accent-deep my-1">{t('feeLookup.noPayments')}</p>
            <p className="text-xs text-ink-body">{t('feeLookup.thanks')}</p>
          </>
        )}
      </div>

      {m.payments.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-4">
          <p className="text-[10.5px] tracking-wide text-[#8A7444] uppercase mb-2">{t('feeLookup.paymentsTitle')}</p>
          <table className="w-full text-[11.5px]">
            <tbody>
              {m.payments.map((p, i) => (
                <tr key={i} className="border-b border-border last:border-b-0">
                  <td className="py-1.5 font-mono text-ink-muted">№{p.receipt_no}</td>
                  <td className="py-1.5 text-ink-muted">{p.paid_at.slice(2)}</td>
                  <td className="py-1.5 text-right text-ink">{moneyRM(p.amount)}</td>
                  <td className="py-1.5 text-right text-ink-faint">{p.months_from} → {p.months_to.slice(5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {trans && (
        <div className="text-xs text-[#4A3A14] bg-[#FBF3DE] border border-gold-border rounded-xl px-4 py-3 leading-relaxed">
          {t('feeLookup.transparency', { centre: m.centre ?? t('feeLookup.thisCentre'), collected: moneyRM(trans.collected), expenses: moneyRM(trans.expenses), surplus: moneyRM(trans.surplus) })}
          {trans.paused && <b> {t('feeLookup.monthFull')}</b>}
          {trans.paused && trans.pausedNote && <span className="block mt-1 text-ink-muted">{trans.pausedNote}</span>}
        </div>
      )}
    </div>
  );
}
