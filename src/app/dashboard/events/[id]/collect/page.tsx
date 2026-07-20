// src/app/dashboard/events/[id]/collect/page.tsx
// 现场收款 — the event-day cash counter, plus the 日结 daily close.
// Same desk crew and same wall as 签到, and the same lookup UX: scan the person's
// check-in QR, or search. The header carries 今日现金 — the number the cash box
// must match at close.
//
// 收款 tab: events:edit at a hosting centre.
// 日结 tab: HQ finance only (the server enforces it; the tab hides itself when
// the close endpoint says no, rather than guessing from the role client-side).

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { moneyRM } from '@/lib/finance-display';
import { toCents, fromCents } from '@/lib/event-payments';
import { useT } from '@/lib/i18n-react';
import type { TFunc } from '@/lib/i18n';

type Person = {
  id: string; reg_no: string; name: string; centre_name: string | null;
  fee_total: number; paid_amount: number | null; payment_status: string;
  payment_method: string | null; action: 'settled' | 'nothing_due' | 'collect';
};
type Header = { day: string; todayCash: number; todayCashCount: number; event: { id: string; code: string; title: string } };
type CloseRow = {
  id: string; close_date: string; expected_cents: number; counted_cents: number;
  counted_by: string; witnessed_by: string; variance_note: string | null;
  banked_at: string | null; finance_txn_id: string | null;
};
type ClosePack = {
  date: string; expectedCents: number; expected: number; close: CloseRow | null;
  hqAccounts: { id: string; name: string; kind: string }[];
  witnesses: { id: string; name: string }[];
};

const inputCls = 'w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-accent';

export default function CollectPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  return (
    <ErpGate active="events" module="events" titleSuffix={t('ep.collect.title')}>
      {(me) => <Counter me={me} id={id} />}
    </ErpGate>
  );
}

function Counter({ me, id }: { me: ErpMe; id: string }) {
  const t = useT();
  const canEdit = grantAllows(me.grants, 'events', 'edit');
  const [mode, setMode] = useState<'collect' | 'close'>('collect');
  const [scan, setScan] = useState(false);
  const [header, setHeader] = useState<Header | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<Person | null>(null);
  const [flash, setFlash] = useState('');
  const [err, setErr] = useState('');
  // Set once the close endpoint answers — HQ-only, and the server is the judge.
  const [canClose, setCanClose] = useState(false);

  const refreshHeader = useCallback(() => {
    fetch(`/api/dashboard/events/${id}/collect`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.event) setHeader(j); })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    refreshHeader();
    // Probe the close endpoint: 200 → HQ finance, 403 → hide the tab entirely.
    fetch(`/api/dashboard/events/${id}/collect/close`)
      .then((r) => setCanClose(r.ok))
      .catch(() => setCanClose(false));
  }, [id, refreshHeader]);

  const search = useCallback((term: string) => {
    if (term.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    fetch(`/api/dashboard/events/${id}/collect?q=${encodeURIComponent(term.trim())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) { setResults(j.results ?? []); if (j.event) setHeader(j); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const h = setTimeout(() => search(q), 300);
    return () => clearTimeout(h);
  }, [q, search]);

  const byToken = useCallback(async (token: string) => {
    setErr('');
    const res = await fetch(`/api/dashboard/events/${id}/collect?token=${encodeURIComponent(token)}`);
    const j = await res.json().catch(() => ({}));
    if (j?.event) setHeader(j);
    if (!res.ok) { setErr(j.error ?? t('ep.err.failed')); return; }
    const first = (j.results ?? [])[0] as Person | undefined;
    if (first) { setTarget(first); setScan(false); }
  }, [id, t]);

  const collect = async (person: Person, amount: number) => {
    setErr('');
    const res = await fetch(`/api/dashboard/events/${id}/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_id: person.id, amount }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error ?? t('ep.err.failed')); return; }
    setFlash(t('ep.collect.done', { amount: moneyRM(amount) }));
    setTarget(null);
    setResults([]);
    setQ('');
    refreshHeader();
  };

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-xl font-bold font-serif text-ink">{t('ep.collect.title')}</h2>
          {header && <p className="text-sm text-ink-muted">{header.event.title}</p>}
        </div>
        <Link href={`/dashboard/events/${id}`} className="text-sm text-ink-muted hover:text-accent-deep px-2 py-1">
          {t('ep.collect.back')}
        </Link>
      </div>

      <div className="bg-surface border border-border rounded-2xl p-4">
        <p className="text-2xl font-extrabold tabular-nums text-ink">
          {header ? t('ep.collect.todayCash', { amount: moneyRM(header.todayCash) }) : t('ep.loading')}
          {header && <span className="text-sm font-normal text-ink-faint ml-1">{t('ep.collect.todayCount', { n: header.todayCashCount })}</span>}
        </p>
      </div>

      {canClose && (
        <div className="flex gap-1.5">
          <button onClick={() => setMode('collect')}
            className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border transition ${mode === 'collect' ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border-strong'}`}>
            {t('ep.collect.title')}
          </button>
          <button onClick={() => setMode('close')}
            className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border transition ${mode === 'close' ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border-strong'}`}>
            {t('ep.close.title')}
          </button>
        </div>
      )}

      {flash && <p className="text-sm text-[#3F6B2E] bg-[#E7F0E0] border border-[#3F6B2E]/20 rounded-xl px-3 py-2.5">{flash}</p>}
      {err && <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-xl px-3 py-2.5">{err}</p>}

      {mode === 'close' && canClose ? (
        <ClosePanel id={id} t={t} onDone={refreshHeader} />
      ) : !canEdit ? (
        <p className="text-sm text-ink-muted">{t('ep.empty')}</p>
      ) : (
        <>
          <div className="flex gap-1.5">
            <button onClick={() => setScan((v) => !v)} className="flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border border-border-strong bg-surface text-ink">
              {scan ? t('ep.collect.scanStop') : t('ep.collect.scanStart')}
            </button>
          </div>
          {scan && <Scanner t={t} onToken={byToken} />}

          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ep.collect.searchPlaceholder')} className={inputCls} autoComplete="off" />
          {q.trim().length > 0 && q.trim().length < 2 && <p className="text-xs text-ink-faint px-1">{t('ep.collect.searchHint')}</p>}
          {loading && <p className="text-sm text-ink-muted px-1">{t('ep.loading')}</p>}

          {results.length > 0 && (
            <ul className="bg-surface border border-border rounded-2xl overflow-hidden">
              {results.map((p) => (
                <li key={p.id} className="px-4 py-3 border-b border-border last:border-b-0 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-ink truncate">{p.name}{p.centre_name && <span className="text-xs text-ink-faint"> · {p.centre_name}</span>}</p>
                    <p className="text-[11px] text-ink-faint font-mono">{p.reg_no} · {moneyRM(p.fee_total)}</p>
                  </div>
                  <ActionButton person={p} t={t} onPick={() => setTarget(p)} />
                </li>
              ))}
            </ul>
          )}

          {target && <CollectModal person={target} t={t} onClose={() => setTarget(null)} onConfirm={collect} />}
        </>
      )}
    </div>
  );
}

function ActionButton({ person, t, onPick }: { person: Person; t: TFunc; onPick: () => void }) {
  if (person.action === 'settled') {
    return <span className="text-xs px-3 py-1.5 rounded-full bg-[#E7F0E0] text-[#3F6B2E] shrink-0">{t('ep.collect.settled')}</span>;
  }
  if (person.action === 'nothing_due') {
    return <span className="text-xs px-3 py-1.5 rounded-full pill-muted shrink-0">{t('ep.collect.nothingDue')}</span>;
  }
  return (
    <button onClick={onPick} className="px-4 py-2 rounded-xl btn-primary text-sm shrink-0">
      {t('ep.collect.collect')}
    </button>
  );
}

function CollectModal({ person, t, onClose, onConfirm }: {
  person: Person; t: TFunc; onClose: () => void; onConfirm: (p: Person, amount: number) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(person.fee_total));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) return;
    setBusy(true);
    try { await onConfirm(person, fromCents(toCents(a))); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[70] bg-ink/45 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-surface w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-xl font-bold text-ink">{person.name}</p>
        <p className="font-mono text-xs text-ink-muted mb-3">{person.reg_no}</p>
        <p className="text-sm text-ink-muted mb-1">{t('ep.collect.due')} <b className="text-ink tabular-nums">{moneyRM(person.fee_total)}</b></p>
        <label className="block text-sm font-medium text-ink mb-1 mt-3">{t('ep.collect.amount')}</label>
        <input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} autoFocus />
        <div className="flex gap-2 justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2.5 text-sm border border-border-strong rounded-xl bg-surface text-ink">{t('ep.cancel')}</button>
          <button onClick={submit} disabled={busy} className="px-5 py-2.5 text-sm btn-primary rounded-xl disabled:opacity-50">
            {busy ? t('ep.saving') : t('ep.collect.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Same capability ladder as the 签到 scanner: native BarcodeDetector, then jsqr.
function Scanner({ t, onToken }: { t: TFunc; onToken: (token: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let done = false;
    let detector: { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } | null = null;
    type JsQr = (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null;
    let jsQR: JsQr | null = null;
    const canvas = document.createElement('canvas');

    const cleanup = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((x) => x.stop());
    };

    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && !done) {
        try {
          let raw: string | null = null;
          if (detector) {
            const codes = await detector.detect(video);
            if (codes.length) raw = codes[0].rawValue;
          } else if (jsQR) {
            const w = video.videoWidth, h = video.videoHeight;
            if (w && h) {
              canvas.width = w; canvas.height = h;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(video, 0, 0, w, h);
                const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
                if (code) raw = code.data;
              }
            }
          }
          const token = (raw ?? '').trim();
          if (token) {
            if (!/^[0-9a-f]{64}$/i.test(token)) setStatus(t('ep.collect.scanNotOurs'));
            else {
              // One person at a time: the counter takes money, so the scan stops
              // and hands over rather than racing ahead to the next code.
              done = true;
              cleanup();
              onTokenRef.current(token);
              return;
            }
          }
        } catch { /* transient decode error — keep scanning */ }
      }
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        setStatus(t('ep.collect.scanOpening'));
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) { stream.getTracks().forEach((x) => x.stop()); return; }
        const video = videoRef.current;
        if (video) { video.srcObject = stream; await video.play().catch(() => {}); }
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => typeof detector }).BarcodeDetector;
        if (BD) { try { detector = new BD({ formats: ['qr_code'] }); } catch { detector = null; } }
        if (!detector) { try { jsQR = (await import('jsqr')).default as unknown as JsQr; } catch { jsQR = null; } }
        if (!detector && !jsQR) { setErr(t('ep.collect.scanUnsupported')); cleanup(); return; }
        setStatus(t('ep.collect.scanAim'));
        raf = requestAnimationFrame(tick);
      } catch { setErr(t('ep.collect.scanNoCamera')); }
    })();

    return () => cleanup();
  }, [t]);

  if (err) return <div className="bg-surface border border-border rounded-2xl p-5"><p className="text-sm text-ink-muted text-center">{err}</p></div>;
  return (
    <div className="bg-surface border border-border rounded-2xl p-3">
      <div className="relative rounded-xl overflow-hidden bg-black aspect-square max-w-sm mx-auto">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        <div className="absolute inset-8 border-2 border-white/70 rounded-xl pointer-events-none" />
      </div>
      <p className="mt-2 text-xs text-ink-muted text-center">{status}</p>
    </div>
  );
}

// 日结 — expected vs counted, a second person, and the ledger posting.
function ClosePanel({ id, t, onDone }: { id: string; t: TFunc; onDone: () => void }) {
  const [pack, setPack] = useState<ClosePack | null>(null);
  const [counted, setCounted] = useState('');
  const [witness, setWitness] = useState('');
  const [variance, setVariance] = useState('');
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');

  const load = useCallback(() => {
    fetch(`/api/dashboard/events/${id}/collect/close`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ClosePack | null) => {
        if (!j) return;
        setPack(j);
        setAccountId((c) => c || j.hqAccounts[0]?.id || '');
        if (j.close) setCounted(String(fromCents(j.close.counted_cents)));
      })
      .catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!pack) return <p className="p-6 text-sm text-ink-muted">{t('ep.loading')}</p>;

  const countedCents = counted.trim() === '' ? null : toCents(Number(counted));
  const varianceCents = countedCents == null ? 0 : countedCents - pack.expectedCents;
  const close = pack.close;

  const submitClose = async () => {
    setErr(''); setFlash('');
    if (countedCents == null || !Number.isFinite(countedCents) || countedCents < 0) return setErr(t('ep.err.failed'));
    if (!witness) return setErr(t('ep.close.witnessHint'));
    if (varianceCents !== 0 && !variance.trim()) return setErr(t('ep.close.varianceRequired'));
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard/events/${id}/collect/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: pack.date, counted_cents: countedCents, witnessed_by: witness, variance_note: variance.trim() || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? t('ep.err.failed')); return; }
      setFlash(t('ep.close.done'));
      load(); onDone();
    } finally { setBusy(false); }
  };

  const bank = async () => {
    if (!close || !accountId) return;
    if (!window.confirm(t('ep.close.bankConfirm', { amount: moneyRM(fromCents(close.counted_cents)) }))) return;
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`/api/dashboard/events/${id}/collect/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bank', close_id: close.id, account_id: accountId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? t('ep.err.failed')); return; }
      setFlash(t('ep.close.banked', { ref: j.txn?.reference ?? '' }));
      load(); onDone();
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {flash && <p className="text-sm text-[#3F6B2E] bg-[#E7F0E0] border border-[#3F6B2E]/20 rounded-xl px-3 py-2.5">{flash}</p>}
      {err && <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-xl px-3 py-2.5">{err}</p>}

      <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-muted">{t('ep.close.date')}</span>
          <span className="text-sm font-medium text-ink tabular-nums">{pack.date}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-muted">{t('ep.close.expected')}</span>
          <span className="text-lg font-bold text-ink tabular-nums">{moneyRM(pack.expected)}</span>
        </div>

        {close ? (
          <>
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-sm text-ink-muted">{t('ep.close.counted')}</span>
              <span className="text-lg font-bold text-ink tabular-nums">{moneyRM(fromCents(close.counted_cents))}</span>
            </div>
            {close.counted_cents !== close.expected_cents && (
              <p className="text-xs text-[#7A6420]">
                {t('ep.close.varianceIs', { amount: moneyRM(fromCents(close.counted_cents - close.expected_cents)) })}
                {close.variance_note ? ` · ${close.variance_note}` : ''}
              </p>
            )}
            {close.banked_at ? (
              <p className="text-sm text-[#3F6B2E]">{t('ep.close.bankedAt', { at: close.banked_at.slice(0, 16).replace('T', ' ') })}</p>
            ) : pack.hqAccounts.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('ep.close.noAccounts')}</p>
            ) : (
              <div className="pt-2 border-t border-border space-y-2">
                <label className="block text-sm font-medium text-ink">{t('ep.close.bankAccount')}</label>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
                  {pack.hqAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button onClick={bank} disabled={busy} className="w-full btn-primary py-2.5 rounded-xl disabled:opacity-50">
                  {busy ? t('ep.saving') : t('ep.close.bank')}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">{t('ep.close.counted')}</label>
              <input type="number" min={0} step="0.01" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">{t('ep.close.witness')}</label>
              <select value={witness} onChange={(e) => setWitness(e.target.value)} className={inputCls}>
                <option value="">{t('ep.none')}</option>
                {pack.witnesses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <p className="text-[11px] text-ink-faint mt-1">{t('ep.close.witnessHint')}</p>
            </div>
            {countedCents != null && varianceCents !== 0 && (
              <div>
                <label className="block text-sm font-medium text-[#7A6420] mb-1">
                  {t('ep.close.variance')} · {t('ep.close.varianceIs', { amount: moneyRM(fromCents(varianceCents)) })}
                </label>
                <input value={variance} onChange={(e) => setVariance(e.target.value)} className={inputCls} />
              </div>
            )}
            <button onClick={submitClose} disabled={busy} className="w-full btn-primary py-2.5 rounded-xl disabled:opacity-50">
              {busy ? t('ep.saving') : t('ep.close.submit')}
            </button>
          </>
        )}
      </div>
      <p className="text-xs text-ink-faint">{t('ep.close.footer')}</p>
    </div>
  );
}
