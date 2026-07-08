// src/app/r/[token]/page.tsx
// PUBLIC login-free registration flow (C2). A 4-step client state machine over the C1
// anonymous API. NO auth, NO dashboard imports. On mount it GETs the public event; a
// 404 (bad/disabled/closed token) shows a warm "link closed/invalid" card.
//
// Steps: 1 identify (老同修 phone-match OR newcomer) → 2 selections (meal grid + logistics,
// live fee via computeFees — the SAME numbers the server will store) → 3 confirm + payment
// instructions (PLACEHOLDER bank/QR pending 理事会) → 4 done (reg_no + status-lookup link).
//
// DESIGN NOTE (newcomer 中心): the public event JSON exposes only its OWN organizing centre,
// not the full centres list, and the C1 register API validates centre_id against real
// centres. Since a public visitor has no centre picker, we OMIT centre entirely from the
// newcomer form and let the approver assign it at 建档 (staff). volunteer-team assignment is
// likewise a staff action (teams aren't in the public JSON) — no 义工组 field here.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { computeFees, type FeeItem, type Selections } from '@/lib/event-fees';
import { mealSlotKey } from '@/lib/events';
import { MEAL_COLS, EVENT_TYPE_LABELS, FEE_LABEL, feeBillingLabel, weekdayCn, moneyRM } from '@/lib/events-display';

type PublicFee = { item: string; label_cn: string | null; amount: number; billing: string; sort: number };
type PublicEvent = {
  id: string; code: string; title: string; event_type: string;
  organizing_centre: { name_cn: string; name_en: string } | null;
  starts_on: string; ends_on: string | null; location: string | null; reg_deadline: string | null;
  capacity: number | null; approved: number; remaining: number | null; reg_edit_cutoff_days: number;
  fees: PublicFee[]; meal_slots: { slot_date: string; meal: string }[];
};

const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
const dateLabel = (d: string) => `${d.slice(5).replace('-', '月')}日 ${weekdayCn(d)}`;

export default function PublicRegPage() {
  const { token } = useParams<{ token: string }>();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [load, setLoad] = useState<'loading' | 'ok' | 'invalid'>('loading');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/public/events/${token}`);
        if (!alive) return;
        if (res.ok) { setEvent((await res.json()).event as PublicEvent); setLoad('ok'); }
        else setLoad('invalid');
      } catch {
        if (alive) setLoad('invalid');
      }
    })();
    return () => { alive = false; };
  }, [token]);

  if (load === 'loading') return <Card><p className="text-center text-ink-muted py-8">加载中…</p></Card>;
  if (load === 'invalid' || !event) {
    return (
      <Card>
        <div className="text-center py-8">
          <div className="text-4xl mb-3">🙏</div>
          <p className="font-semibold text-ink">报名已关闭或链接无效</p>
          <p className="mt-2 text-sm text-ink-muted">This registration link is closed or invalid.</p>
        </div>
      </Card>
    );
  }
  return <Flow token={token} event={event} />;
}

function Flow({ token, event }: { token: string; event: PublicEvent }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // identify state
  const [phone, setPhone] = useState('');
  const [identifyMode, setIdentifyMode] = useState<'unknown' | 'matched' | 'newcomer'>('unknown');
  const [masked, setMasked] = useState<{ name?: string; centre?: string } | null>(null);
  const [nameCn, setNameCn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [idBusy, setIdBusy] = useState(false);
  const [idErr, setIdErr] = useState<string | null>(null);

  // selections state
  const [meals, setMeals] = useState<Set<string>>(new Set());
  const [mealDays, setMealDays] = useState(0);
  const [nights, setNights] = useState(0);
  const [transfer, setTransfer] = useState(false);
  const [uniformSize, setUniformSize] = useState('M');
  const [uniformQty, setUniformQty] = useState(0);
  const [otherQty, setOtherQty] = useState(0);

  // submit state
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ reg_no: string } | null>(null);
  const [payNow, setPayNow] = useState(false); // done-step: reveal payment details (optional)

  const feeItems = useMemo<FeeItem[]>(
    () => event.fees.map((f) => ({ item: f.item, label_cn: f.label_cn, amount: f.amount, billing: f.billing }) as FeeItem),
    [event.fees]
  );
  const has = (item: string) => event.fees.some((f) => f.item === item);
  const mealFee = event.fees.find((f) => f.item === 'meal');
  const mealPerItem = mealFee?.billing === 'per_item';

  const selections = useMemo<Selections>(() => ({
    meals: mealPerItem ? [...meals] : undefined,
    meal_days: has('meal') && !mealPerItem ? mealDays : undefined,
    nights: has('accommodation') ? nights : undefined,
    transfer: has('transfer') ? transfer : undefined,
    uniform: has('uniform') ? { size: uniformSize, qty: uniformQty } : undefined,
    other_qty: has('other') ? otherQty : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [meals, mealDays, nights, transfer, uniformSize, uniformQty, otherQty, mealPerItem, event.fees]);

  const { total, breakdown } = useMemo(() => computeFees(feeItems, selections), [feeItems, selections]);

  // offered meal cells grouped by date (already offered-only from the API)
  const mealDates = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of event.meal_slots) {
      if (!map.has(s.slot_date)) map.set(s.slot_date, new Set());
      map.get(s.slot_date)!.add(s.meal);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [event.meal_slots]);

  const toggleMeal = (key: string) =>
    setMeals((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const selectDay = (date: string, offered: Set<string>) =>
    setMeals((prev) => { const n = new Set(prev); for (const m of offered) n.add(mealSlotKey(date, m)); return n; });
  const selectAll = () =>
    setMeals(() => { const n = new Set<string>(); for (const [d, o] of mealDates) for (const m of o) n.add(mealSlotKey(d, m)); return n; });

  async function doIdentify() {
    setIdErr(null);
    setIdBusy(true);
    try {
      const res = await fetch(`/api/public/events/${token}/identify`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }),
      });
      const j = await res.json();
      if (!res.ok) { setIdErr(j.error ?? '出错了，请重试'); return; }
      if (j.matched) { setMasked({ name: j.maskedName, centre: j.maskedCentre }); setIdentifyMode('matched'); }
      else { setMasked(null); setIdentifyMode('newcomer'); }
    } catch {
      setIdErr('网络错误，请重试');
    } finally {
      setIdBusy(false);
    }
  }

  function identifyNext() {
    // matched → phone is the key, no name needed. newcomer → require 中文姓名.
    if (identifyMode === 'newcomer' && !nameCn.trim()) { setIdErr('请填写中文姓名'); return; }
    setIdErr(null);
    setStep(2);
  }

  async function submit() {
    setSubmitErr(null);
    setSubmitBusy(true);
    try {
      const body: Record<string, unknown> = { phone, selections };
      if (identifyMode === 'newcomer') {
        body.name = nameCn.trim();
        if (nameEn.trim()) body.name_en = nameEn.trim();
      }
      const res = await fetch(`/api/public/events/${token}/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (res.status === 409) { setSubmitErr(`${j.error ?? '您已报名此活动'}${j.existing?.reg_no ? `（编号 ${j.existing.reg_no}）` : ''}`); return; }
      if (!res.ok) { setSubmitErr(j.error ?? '报名失败，请重试'); return; }
      setResult({ reg_no: j.reg_no });
      setStep(4);
    } catch {
      setSubmitErr('网络错误，请重试');
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <StepDots step={step} />

      {step === 1 && (
        <Card>
          <EventHeader event={event} />
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-medium text-ink">手机号 Phone</label>
            <input
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setIdentifyMode('unknown'); setMasked(null); }}
              inputMode="tel" placeholder="例如 0123456789"
              className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-ink placeholder:text-ink-faint outline-none focus:border-accent"
            />

            {identifyMode === 'unknown' && (
              <button onClick={doIdentify} disabled={idBusy || !phone.trim()}
                className="w-full btn-primary py-2.5 font-medium">
                {idBusy ? '查询中…' : '下一步'}
              </button>
            )}

            {identifyMode === 'matched' && masked && (
              <div className="rounded-xl border border-[#CBE3BF] bg-[#EAF3E2] p-3">
                <p className="text-sm text-[#3F6B2E]">✓ 找到您了：<span className="font-semibold">{masked.name}</span>{masked.centre ? ` · ${masked.centre}` : ''}</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={identifyNext} className="flex-1 btn-primary py-2 font-medium">这是我，继续</button>
                  <button onClick={() => { setIdentifyMode('newcomer'); setMasked(null); }}
                    className="px-3 btn-secondary text-sm">不是我？</button>
                </div>
              </div>
            )}

            {identifyMode === 'newcomer' && (
              <div className="space-y-3">
                <p className="text-xs text-ink-muted">首次报名？请填写姓名（本会将于审核时为您建档）。</p>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">中文姓名 <span className="text-red-600">*</span></label>
                  <input value={nameCn} onChange={(e) => setNameCn(e.target.value)}
                    className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">英文姓名 <span className="text-ink-faint">(选填)</span></label>
                  <input value={nameEn} onChange={(e) => setNameEn(e.target.value)}
                    className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-accent" />
                </div>
                <button onClick={identifyNext} className="w-full btn-primary py-2.5 font-medium">下一步</button>
              </div>
            )}

            {idErr && <p className="text-sm text-red-600">{idErr}</p>}
          </div>
        </Card>
      )}

      {step === 2 && (
        <>
          <Card>
            <h2 className="font-serif font-semibold text-ink mb-1">选择项目</h2>
            <p className="text-xs text-ink-muted mb-3">请选择您需要的项目；费用会实时更新。</p>

            {/* meal */}
            {has('meal') && (
              <Section title={`🍚 ${mealFee?.label_cn || '餐费'}`} sub={feeBillingLabel('meal', mealFee?.billing ?? '')}>
                {mealPerItem ? (
                  mealDates.length === 0 ? (
                    <p className="text-sm text-ink-muted">本活动暂未开放餐点。</p>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-ink-muted">已选 {meals.size} 餐</span>
                        <div className="flex gap-2 text-xs">
                          <button onClick={selectAll} className="text-accent">全选</button>
                          <button onClick={() => setMeals(new Set())} className="text-ink-muted">清空</button>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {mealDates.map(([date, offered]) => (
                          <div key={date} className="flex items-center gap-2">
                            <button onClick={() => selectDay(date, offered)} className="w-24 shrink-0 text-left text-xs text-ink-muted hover:text-accent">{dateLabel(date)}</button>
                            <div className="flex gap-1.5 flex-1">
                              {MEAL_COLS.map(({ meal, label }) => {
                                const isOffered = offered.has(meal);
                                const key = mealSlotKey(date, meal);
                                const on = meals.has(key);
                                if (!isOffered) return <span key={meal} className="flex-1 text-center py-1.5 text-ink-faint text-sm">—</span>;
                                return (
                                  <button key={meal} onClick={() => toggleMeal(key)}
                                    className={`flex-1 rounded-lg py-1.5 text-sm border transition ${on ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border'}`}>
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                ) : (
                  <NumberRow label="用餐天数" value={mealDays} onChange={setMealDays} />
                )}
              </Section>
            )}

            {has('accommodation') && (
              <Section title="🏨 住宿" sub={feeBillingLabel('accommodation', event.fees.find((f) => f.item === 'accommodation')!.billing)}>
                <NumberRow label="住宿晚数" value={nights} onChange={setNights} />
              </Section>
            )}

            {has('transfer') && (
              <Section title={`🚐 ${event.fees.find((f) => f.item === 'transfer')!.label_cn || '机场接送'}`} sub="">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={transfer} onChange={(e) => setTransfer(e.target.checked)} className="w-4 h-4 accent-accent" />
                  需要机场接送
                </label>
              </Section>
            )}

            {has('uniform') && (
              <Section title="👕 制服" sub="每件">
                <div className="flex items-center gap-2">
                  <select value={uniformSize} onChange={(e) => setUniformSize(e.target.value)}
                    className="rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent">
                    {SHIRT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <NumberRow label="数量" value={uniformQty} onChange={setUniformQty} />
                </div>
              </Section>
            )}

            {has('registration') && (
              <Section title={`🎟️ ${event.fees.find((f) => f.item === 'registration')!.label_cn || '报名费'}`} sub="每人一次">
                <p className="text-sm text-ink-muted">报名费将自动计入。</p>
              </Section>
            )}

            {has('other') && (
              <Section title={`🎁 ${event.fees.find((f) => f.item === 'other')!.label_cn || '其他'}`} sub="">
                <NumberRow label="数量" value={otherQty} onChange={setOtherQty} />
              </Section>
            )}
          </Card>

          <StickyBar total={total}>
            <button onClick={() => setStep(1)} className="px-4 btn-secondary">上一步</button>
            <button onClick={() => setStep(3)} className="flex-1 btn-primary py-2.5 font-medium">下一步</button>
          </StickyBar>
        </>
      )}

      {step === 3 && (
        <>
          <Card>
            <h2 className="font-serif font-semibold text-ink mb-3">确认报名</h2>
            <div className="rounded-xl bg-accent/10 p-3 text-sm">
              <p className="text-ink font-medium">{event.title}</p>
              <p className="text-xs text-ink-muted mt-0.5">{identifyMode === 'newcomer' ? `${nameCn}${nameEn ? `（${nameEn}）` : ''}` : masked?.name ?? ''} · {phone}</p>
            </div>

            <div className="mt-3 space-y-1.5">
              {breakdown.length === 0 ? (
                <p className="text-sm text-ink-muted">未选择任何收费项目（如活动免费可直接确认）。</p>
              ) : breakdown.map((b) => (
                <div key={b.item} className="flex items-center justify-between text-sm">
                  <span className="text-ink">{b.label} <span className="text-[11px] text-ink-faint">×{b.qty}</span></span>
                  <span className="text-ink">{moneyRM(b.subtotal)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-border font-semibold text-ink">
                <span>合计 Total</span><span>{moneyRM(total)}</span>
              </div>
            </div>
          </Card>

          <PaymentCard fee={total} />

          <StickyBar total={total}>
            <button onClick={() => setStep(2)} className="px-4 btn-secondary">上一步</button>
            <button onClick={submit} disabled={submitBusy} className="flex-1 btn-primary py-2.5 font-medium">
              {submitBusy ? '提交中…' : '确认报名'}
            </button>
          </StickyBar>
          {submitErr && <Card><p className="text-sm text-red-600">{submitErr}</p></Card>}
        </>
      )}

      {step === 4 && result && (
        <Card>
          <div className="text-center py-4">
            <div className="text-4xl mb-2">🪷</div>
            <p className="font-serif font-semibold text-ink text-lg">报名已提交</p>
            <p className="mt-1 text-sm text-ink-muted">Registration submitted</p>
            <div className="mt-4 inline-block font-mono text-lg tracking-wider bg-accent/10 text-ink px-4 py-2 rounded-xl">{result.reg_no}</div>
            <div className="mt-3">
              <span className="inline-block text-xs px-3 py-1 rounded-full pill-gold">待审核 Pending</span>
            </div>
            <p className="mt-4 text-xs text-ink-muted leading-relaxed">
              凭 <span className="font-mono">编号</span> + 手机号可随时查询状态、补上付款凭证<br />
              （用餐修改请联系负责人；活动开始前 {event.reg_edit_cutoff_days} 天截止）
            </p>
          </div>

          {/* GENTLE, optional payment — never blocks; already registered. */}
          {total > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-sm text-center text-ink">费用 {moneyRM(total)} · <span className="text-ink-muted">随喜发心，可现在付款、日后补上，或到场再说 🙏</span></p>
              {!payNow ? (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setPayNow(true)} className="flex-1 btn-primary py-2.5 text-sm font-medium">我现在付款</button>
                  <button onClick={() => { /* already registered — nothing to do */ }} disabled
                    className="flex-1 btn-secondary py-2.5 text-sm">我稍后再说</button>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <PaymentCard fee={total} />
                  <ProofUploader regNo={result.reg_no} phone={phone} />
                </div>
              )}
            </div>
          )}

          <div className="mt-4 text-center">
            <Link href={`/r/${token}/status`} className="inline-block btn-secondary px-5 py-2 text-sm font-medium">查询我的报名</Link>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── presentational pieces ─────────────────────────────────────────────────────────────
function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface border border-border rounded-2xl p-4">{children}</div>;
}

function StepDots({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={`h-2 rounded-full transition-all ${n === step ? 'w-6 bg-accent' : n < step ? 'w-2 bg-accent' : 'w-2 bg-border'}`} />
      ))}
    </div>
  );
}

function EventHeader({ event }: { event: PublicEvent }) {
  const dates = `${event.starts_on}${event.ends_on && event.ends_on !== event.starts_on ? ` — ${event.ends_on}` : ''}`;
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-xl font-bold font-serif text-ink">{event.title}</h1>
        <span className="text-[11px] px-2 py-0.5 rounded-full pill-gold">{EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}</span>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        {event.organizing_centre ? `${event.organizing_centre.name_cn} · ` : ''}{dates}
        {event.location ? ` · ${event.location}` : ''}
      </p>
      {event.reg_deadline && <p className="mt-0.5 text-xs text-[#B4402E]">报名截止 {event.reg_deadline}</p>}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="py-3 border-t border-border first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-medium text-ink">{title}</span>
        {sub && <span className="text-[11px] text-ink-faint">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function NumberRow({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-ink-muted">{label}</span>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(Math.max(0, value - 1))} className="w-8 h-8 rounded-lg border border-border text-ink">−</button>
        <span className="w-8 text-center text-ink font-medium">{value}</span>
        <button onClick={() => onChange(value + 1)} className="w-8 h-8 rounded-lg border border-border text-ink">+</button>
      </div>
    </div>
  );
}

function StickyBar({ total, children }: { total: number; children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-4 px-4 pt-3 pb-4 bg-gradient-to-t from-bg via-bg to-transparent">
      <div className="bg-surface border border-border rounded-2xl p-3 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-ink-muted">合计 Total</span>
          <span className="text-lg font-bold text-ink">{moneyRM(total)}</span>
        </div>
        <div className="flex gap-2">{children}</div>
      </div>
    </div>
  );
}

function PaymentCard({ fee }: { fee: number }) {
  return (
    <Card>
      <p className="text-sm text-ink mb-2">费用 {moneyRM(fee)} · <span className="text-ink-muted">随喜发心，可现在付款、日后补上，或到场再说</span></p>
      <h3 className="font-semibold text-ink mb-2">缴费说明 <span className="text-[11px] text-ink-faint">（PLACEHOLDER · 待理事会提供）</span></h3>
      <div className="rounded-xl bg-accent/10 p-3 text-sm text-ink space-y-1">
        <p>银行：<span className="text-ink-muted">＿＿＿＿（待提供）</span></p>
        <p>户名：<span className="text-ink-muted">＿＿＿＿（待提供）</span></p>
        <p>账号：<span className="font-mono text-ink-muted">＿＿＿＿＿＿（待提供）</span></p>
      </div>
      <div className="mt-3 flex justify-center">
        <div className="w-40 h-40 rounded-xl border-2 border-dashed border-gold-border flex items-center justify-center text-center text-xs text-ink-faint p-2">
          收款 QR<br />（待理事会提供）
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-muted leading-relaxed">转账后请保留收据，现场核对；线上缴费日后开放。</p>
    </Card>
  );
}

// Optional receipt uploader (image/pdf ≤5MB) → POST /api/public/registrations/proof. Never
// required; can be added anytime from the status page too.
export function ProofUploader({ regNo, phone, onUploaded }: { regNo: string; phone: string; onUploaded?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(file: File) {
    setMsg(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('reg_no', regNo);
      fd.append('phone', phone);
      fd.append('file', file);
      const res = await fetch('/api/public/registrations/proof', { method: 'POST', body: fd });
      if (res.ok) { setMsg({ ok: true, text: '✓ 付款凭证已上传，感恩护持 🙏' }); onUploaded?.(); }
      else { const j = await res.json().catch(() => null); setMsg({ ok: false, text: j?.error ?? '上传失败，请重试' }); }
    } catch {
      setMsg({ ok: false, text: '网络错误，请重试' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-gold-border p-3 text-center">
      <label className="cursor-pointer inline-block">
        <span className={`inline-block rounded-xl pill-gold px-4 py-2 text-sm ${busy ? 'opacity-50' : ''}`}>
          {busy ? '上传中…' : '上传付款证明（可选）'}
        </span>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" className="hidden"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
      </label>
      <p className="mt-2 text-[11px] text-ink-faint">图片或 PDF · 上限 5MB · 可日后再上传</p>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-[#3F6B2E]' : 'text-[#B4402E]'}`}>{msg.text}</p>}
    </div>
  );
}
