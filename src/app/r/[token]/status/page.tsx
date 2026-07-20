// src/app/r/[token]/status/page.tsx
// PUBLIC status page v2 (self-service). reg_no + phone → POST /api/public/lookup →
// the owner's FULL record: status/fee (as before) + team, meals day-by-day, stay
// (resolved stay ?? import813 via resolveStay), t-shirt, remarks, flight info.
// While the SHARED edit window is open (events.reg_edit_cutoff_days — same rule as
// the staff selections PATCH, enforced again server-side by the update route) the
// registrant may self-edit MEALS (same MealGrid as the register wizard) and STAY
// (needs_accommodation / room type / check-in / check-out with a live nights count).
// 同房 room ASSIGNMENT is centrally planned — always read-only. After the cutoff the
// page is read-only with a trilingual notice.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useT } from '@/lib/i18n-react';
import { moneyRM, regStatusLabel, REG_STATUS_STYLES, paymentStatusLabel, PAYMENT_STATUS_STYLES, mealColLabel, weekdayCn } from '@/lib/events-display';
import { stayNights, STAY_ROOM_TYPES, type StayInfo } from '@/lib/stay';
import { ProofUploader } from '../page';
import { MealGrid } from '../meal-grid';
import { QrSvg } from '@/components/qr-svg';

type Detail = {
  teamName: string | null;
  meals: string[];
  stay: StayInfo;
  extras: {
    tshirt: string | null; remarks: string | null; special_note: string | null;
    flight: {
      airport_pickup: boolean | null; arrival_date: string | null; arrival_time: string | null; flight_arr: string | null;
      airport_dropoff: boolean | null; departure_date: string | null; departure_time: string | null; flight_dep: string | null;
    };
  };
  editable: boolean;
  cutoffDate: string | null;
  offeredSlots: string[];
  stayWindow: { min: string; max: string } | null;
};

type LookupResult = {
  reg_no: string; status: string; fee_total: number;
  payment_status: string; has_proof: boolean;
  // 活动签到: null for a cancelled/rejected registration (no door to show it at).
  checkin_token: string | null; display_name: string | null;
  event: { title: string; code: string; starts_on: string; ends_on: string | null } | null;
  detail: Detail;
};

const dateLabel = (d: string) => `${d.slice(5).replace('-', '月')}日 ${weekdayCn(d)}`;

// meals ['YYYY-MM-DD:meal'] → per-date read-only lines, in serving order
function mealsByDate(meals: string[]): [string, string[]][] {
  const map = new Map<string, string[]>();
  for (const k of [...meals].sort()) {
    const [date, meal] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(meal);
  }
  const order = ['breakfast', 'lunch', 'dinner'];
  return [...map.entries()].map(([d, ms]) => [d, ms.sort((a, b) => order.indexOf(a) - order.indexOf(b))]);
}

export default function StatusLookupPage() {
  const t = useT();
  const { token } = useParams<{ token: string }>();
  const [regNo, setRegNo] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'found' | 'notfound'>('idle');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // meal edit state
  const [editMeals, setEditMeals] = useState(false);
  const [mealDraft, setMealDraft] = useState<Set<string>>(new Set());
  // stay edit state
  const [editStay, setEditStay] = useState(false);
  const [stayNeed, setStayNeed] = useState(false);
  const [stayType, setStayType] = useState('');
  const [stayIn, setStayIn] = useState('');
  const [stayOut, setStayOut] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast((x) => (x === msg ? null : x)), 2500); };

  async function lookup() {
    setBusy(true);
    setState('idle');
    setEditMeals(false);
    setEditStay(false);
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

  async function save(section: 'meals' | 'stay') {
    if (!result) return;
    setSaveBusy(true);
    setSaveErr(null);
    try {
      const body: Record<string, unknown> = { reg_no: result.reg_no, phone };
      if (section === 'meals') body.meals = [...mealDraft];
      else {
        body.stay = stayNeed
          ? { needs_accommodation: true, room_type: stayType || null, check_in: stayIn, check_out: stayOut }
          : { needs_accommodation: false, room_type: null, check_in: null, check_out: null };
      }
      const res = await fetch('/api/public/registrations/update', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setSaveErr(j?.error ?? t('reg.errRetry')); return; }
      setResult(j as LookupResult);
      setEditMeals(false);
      setEditStay(false);
      flash(t('reg.saved'));
    } catch {
      setSaveErr(t('reg.errNetwork'));
    } finally {
      setSaveBusy(false);
    }
  }

  const startMealEdit = () => { setMealDraft(new Set(result?.detail.meals ?? [])); setSaveErr(null); setEditMeals(true); };
  const startStayEdit = () => {
    const st = result?.detail.stay;
    setStayNeed(st?.needs_accommodation === true);
    setStayType(st?.room_type ?? '');
    setStayIn(st?.check_in ?? '');
    setStayOut(st?.check_out ?? '');
    setSaveErr(null);
    setEditStay(true);
  };

  const d = result?.detail;
  const flight = d?.extras.flight;
  const hasFlight = !!flight && (flight.arrival_date || flight.flight_arr || flight.departure_date || flight.flight_dep);
  const gridSlots = (d?.offeredSlots ?? []).map((k) => ({ slot_date: k.slice(0, k.indexOf(':')), meal: k.slice(k.indexOf(':') + 1) }));
  const draftNights = stayNights(stayIn || null, stayOut || null);
  const stayDatesOk = !stayNeed || (!!stayIn && !!stayOut && stayOut > stayIn);

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-ink text-white text-sm shadow-lg">{toast}</div>
      )}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <h1 className="font-serif font-semibold text-ink mb-1">{t('reg.lookupCta')}</h1>
        <p className="text-xs text-ink-muted mb-3">{t('reg.lookup.sub')}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">{t('reg.regNoLabel')}</label>
            <input value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="XLFM-2608-0001"
              className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 font-mono text-ink placeholder:text-ink-faint outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">{t('reg.phoneLabel')}</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="0123456789"
              className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-ink placeholder:text-ink-faint outline-none focus:border-accent" />
          </div>
          <button onClick={lookup} disabled={busy || !regNo.trim() || !phone.trim()}
            className="w-full btn-primary py-2.5 font-medium">
            {busy ? t('reg.searching') : t('reg.lookupBtn')}
          </button>
        </div>
      </div>

      {state === 'notfound' && (
        <div className="bg-surface border border-border rounded-2xl p-4 text-center">
          <div className="text-3xl mb-2">🙏</div>
          <p className="text-sm text-ink">{t('reg.lookup.notFound')}</p>
        </div>
      )}

      {state === 'found' && result && d && (
        <>
          {/* ── summary ── */}
          <div className="bg-surface border border-border rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-ink">{result.reg_no}</span>
              <span className={`text-xs px-3 py-1 rounded-full ${REG_STATUS_STYLES[result.status] ?? 'pill-muted'}`}>
                {regStatusLabel(result.status, t)}
              </span>
            </div>
            {result.event && (
              <p className="text-sm text-ink">{result.event.title}
                <span className="text-xs text-ink-muted"> · {result.event.starts_on}{result.event.ends_on && result.event.ends_on !== result.event.starts_on ? ` — ${result.event.ends_on}` : ''}</span>
              </p>
            )}
            <div className="text-sm text-ink-muted space-y-0.5">
              {d.teamName && <p>{t('reg.detail.team')}{d.teamName}</p>}
              {d.extras.tshirt && <p>{t('reg.detail.tshirt')}{d.extras.tshirt}</p>}
              {(d.extras.remarks || d.extras.special_note) && (
                <p>{t('reg.detail.remarks')}{[d.extras.remarks, d.extras.special_note].filter(Boolean).join(' · ')}</p>
              )}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border text-sm">
              <span className="text-ink-muted">{t('reg.feeTotal')}</span>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${PAYMENT_STATUS_STYLES[result.payment_status] ?? PAYMENT_STATUS_STYLES.unpaid}`}>
                  {paymentStatusLabel(result.payment_status, t)}
                </span>
                <span className="font-semibold text-ink">{moneyRM(result.fee_total)}</span>
              </div>
            </div>
            {result.fee_total > 0 && result.payment_status !== 'waived' && (
              <div className="pt-2">
                <ProofUploader regNo={result.reg_no} phone={phone} onUploaded={lookup} />
              </div>
            )}
          </div>

          {/* ── 入场签到码 — a volunteer scans this at the desk. There is no
                self-check-in: the code identifies you, the volunteer's device
                marks you present. ── */}
          {result.checkin_token && (
            <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col items-center text-center">
              <h2 className="text-sm font-medium text-ink mb-3">{t('ci.qr.title')}</h2>
              <div className="rounded-xl bg-white p-3 border border-border">
                <QrSvg text={result.checkin_token} px={200} alt={t('ci.qr.alt')} />
              </div>
              {result.display_name && <p className="mt-3 text-base font-medium text-ink">{result.display_name}</p>}
              <p className="font-mono text-sm text-ink-muted mt-0.5">{result.reg_no}</p>
              <p className="text-xs text-ink-muted mt-2">{t('ci.qr.hint')}</p>
            </div>
          )}

          {/* ── edit-window notice ── */}
          {d.editable ? (
            d.cutoffDate && <p className="text-xs text-ink-muted px-1">{t('reg.editableUntil', { date: d.cutoffDate })}</p>
          ) : (
            <div className="rounded-xl border border-[#E7D9A8] bg-[#FBF6E3] p-3">
              <p className="text-sm text-[#7A6420]">{t('reg.editClosed', { date: d.cutoffDate ?? '—' })}</p>
            </div>
          )}

          {/* ── meals ── */}
          <div className="bg-surface border border-border rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-serif font-semibold text-ink">🍚 {t('reg.detail.meals')}</h2>
              {d.editable && !editMeals && (
                <button onClick={startMealEdit} className="px-3 py-1 text-xs btn-secondary">{t('reg.edit')}</button>
              )}
            </div>
            {editMeals ? (
              <div className="space-y-3">
                <MealGrid slots={gridSlots} value={mealDraft} onChange={setMealDraft} />
                {saveErr && <p className="text-sm text-red-600">{saveErr}</p>}
                <div className="flex gap-2">
                  <button disabled={saveBusy} onClick={() => save('meals')} className="flex-1 btn-primary py-2 text-sm font-medium disabled:opacity-50">{saveBusy ? t('reg.searching') : t('reg.save')}</button>
                  <button disabled={saveBusy} onClick={() => setEditMeals(false)} className="px-4 btn-secondary text-sm">{t('reg.cancelEdit')}</button>
                </div>
              </div>
            ) : d.meals.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('reg.detail.noMeals')}</p>
            ) : (
              <ul className="text-sm text-ink space-y-0.5">
                {mealsByDate(d.meals).map(([date, ms]) => (
                  <li key={date} className="flex gap-2">
                    <span className="w-28 shrink-0 text-ink-muted">{dateLabel(date)}</span>
                    <span>{ms.map((m) => mealColLabel(m, t)).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── stay ── */}
          <div className="bg-surface border border-border rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-serif font-semibold text-ink">🏨 {t('reg.detail.stay')}</h2>
              {d.editable && !editStay && (
                <button onClick={startStayEdit} className="px-3 py-1 text-xs btn-secondary">{t('reg.edit')}</button>
              )}
            </div>
            {editStay ? (
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={stayNeed} onChange={(e) => setStayNeed(e.target.checked)} className="w-4 h-4 accent-accent" />
                  {t('reg.stay.need')}
                </label>
                {stayNeed && (
                  <>
                    <div>
                      <label className="block u-label mb-1">{t('reg.stay.roomType')}</label>
                      <select value={stayType} onChange={(e) => setStayType(e.target.value)}
                        className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent">
                        <option value="">{t('reg.stay.anyType')}</option>
                        {STAY_ROOM_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block u-label mb-1">{t('reg.stay.checkIn')}</label>
                        <input type="date" value={stayIn} min={d.stayWindow?.min} max={d.stayWindow?.max}
                          onChange={(e) => setStayIn(e.target.value)}
                          className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
                      </div>
                      <div className="flex-1">
                        <label className="block u-label mb-1">{t('reg.stay.checkOut')}</label>
                        <input type="date" value={stayOut} min={d.stayWindow?.min} max={d.stayWindow?.max}
                          onChange={(e) => setStayOut(e.target.value)}
                          className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
                      </div>
                    </div>
                    <p className="text-sm text-ink-muted">
                      {draftNights !== null
                        ? t('reg.stay.nights', { n: draftNights })
                        : stayIn && stayOut ? <span className="text-red-600">{t('reg.stay.badDates')}</span> : t('reg.stay.pickDates')}
                    </p>
                  </>
                )}
                {saveErr && <p className="text-sm text-red-600">{saveErr}</p>}
                <div className="flex gap-2">
                  <button disabled={saveBusy || !stayDatesOk} onClick={() => save('stay')} className="flex-1 btn-primary py-2 text-sm font-medium disabled:opacity-50">{saveBusy ? t('reg.searching') : t('reg.save')}</button>
                  <button disabled={saveBusy} onClick={() => setEditStay(false)} className="px-4 btn-secondary text-sm">{t('reg.cancelEdit')}</button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-ink space-y-0.5">
                <p>{d.stay.needs_accommodation === true ? t('reg.stay.need') : d.stay.needs_accommodation === false ? t('reg.stay.noNeed') : '—'}</p>
                {d.stay.needs_accommodation === true && (
                  <>
                    {d.stay.room_type && <p className="text-ink-muted">{t('reg.stay.roomType')}：{d.stay.room_type}</p>}
                    {d.stay.check_in && d.stay.check_out && (
                      <p className="text-ink-muted">
                        {t('reg.stay.checkIn')} {d.stay.check_in} → {t('reg.stay.checkOut')} {d.stay.check_out}
                        {stayNights(d.stay.check_in, d.stay.check_out) !== null && ` · ${t('reg.stay.nights', { n: stayNights(d.stay.check_in, d.stay.check_out)! })}`}
                      </p>
                    )}
                    {d.stay.room_assign && (
                      <p className="text-ink-muted">{t('reg.stay.roomAssign')}：{d.stay.room_assign} <span className="text-ink-faint">{t('reg.stay.assignNote')}</span></p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── flight (read-only, import extras) ── */}
          {hasFlight && flight && (
            <div className="bg-surface border border-border rounded-2xl p-4 space-y-1 text-sm">
              <h2 className="font-serif font-semibold text-ink mb-1">✈️ {t('reg.detail.flight')}</h2>
              {(flight.arrival_date || flight.flight_arr) && (
                <p className="text-ink-muted">
                  {t('reg.flight.arrive')}：{[flight.arrival_date, flight.arrival_time, flight.flight_arr].filter(Boolean).join(' · ')}
                  {flight.airport_pickup === true ? ` · ${t('reg.flight.pickup')}✓` : ''}
                </p>
              )}
              {(flight.departure_date || flight.flight_dep) && (
                <p className="text-ink-muted">
                  {t('reg.flight.depart')}：{[flight.departure_date, flight.departure_time, flight.flight_dep].filter(Boolean).join(' · ')}
                  {flight.airport_dropoff === true ? ` · ${t('reg.flight.dropoff')}✓` : ''}
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div className="text-center">
        <Link href={`/r/${token}`} className="text-sm text-ink-muted">{t('reg.backToReg')}</Link>
      </div>
    </div>
  );
}
