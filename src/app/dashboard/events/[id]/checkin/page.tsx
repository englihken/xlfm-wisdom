// src/app/dashboard/events/[id]/checkin/page.tsx
// 签到台 (活动签到 Phase 1) — the volunteer's desk, used one-handed on a phone at a
// door. Mobile-first: big targets, one decision per screen, the result card sized
// to be read at arm's length.
//
// Three paths, one per tab: 扫码 (camera) · 搜索 (roster) · 新增 (walk-in).
// The scanner keeps running between people — a successful scan shows the result
// for ~2s, then re-arms itself, because the queue does not stop for the UI.
// A repeat scan is amber 「已签到」, never a red error: the person did nothing
// wrong, and the desk should not sound an alarm at them.
//
// events:edit at a hosting centre is required to check anyone in; the header
// counters need only events:view.

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { regStatusLabel } from '@/lib/events-display';
import { useT } from '@/lib/i18n-react';
import type { TFunc } from '@/lib/i18n';

type Tab = 'scan' | 'search' | 'walkin';
type Person = { reg_no: string | null; name: string; centre_id: string | null; reg_status: string | null };
type Attendance = { id: string; checked_in_at: string; method: string };
type Result = { already: boolean; person: Person; attendance: Attendance };
type Stats = {
  event: { id: string; title: string; code: string };
  checkedIn: number;
  regTotal: number;
  perCentre: { centre_id: string | null; name: string | null; count: number }[];
  recent: { id: string; name: string; reg_no: string | null; method: string; checked_in_at: string; centre_name: string | null; checked_in_by: string }[];
  centres: Centre[];
};
type SearchRow = {
  registration_id: string; reg_no: string; name: string; phone: string | null;
  centre_name: string | null; reg_status: string; checked_in: boolean;
  checked_in_at: string | null; attendance_id: string | null;
};
type Centre = { id: string; code: string; name_cn: string };

const POLL_MS = 15_000;
const RESULT_MS = 2000;
const inputCls =
  'w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-ink placeholder:text-ink-faint outline-none focus:border-accent';

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });

export default function CheckinPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  return (
    <ErpGate active="events" module="events" titleSuffix={t('ci.title')}>
      {(me) => <Desk me={me} id={id} />}
    </ErpGate>
  );
}

function Desk({ me, id }: { me: ErpMe; id: string }) {
  const t = useT();
  const canEdit = grantAllows(me.grants, 'events', 'edit');
  const [tab, setTab] = useState<Tab>('scan');
  const [stats, setStats] = useState<Stats | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState('');

  const loadStats = useCallback(() => {
    fetch(`/api/dashboard/events/${id}/checkin/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setStats(j); })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    loadStats();
    const h = setInterval(loadStats, POLL_MS);
    return () => clearInterval(h);
  }, [loadStats]);

  // One submit path for all three tabs — the payload shape is the only difference,
  // so the result card, the error line and the counter refresh stay identical.
  const submit = useCallback(
    async (payload: Record<string, unknown>): Promise<Result | null> => {
      setErr('');
      try {
        const res = await fetch(`/api/dashboard/events/${id}/checkin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setErr(j.error ?? t('ci.err.failed')); return null; }
        setResult(j as Result);
        loadStats();
        return j as Result;
      } catch {
        setErr(t('ci.err.failed'));
        return null;
      }
    },
    [id, loadStats, t]
  );

  const undo = async (attendanceId: string, name: string) => {
    if (!window.confirm(t('ci.undo.confirm', { name }))) return;
    try {
      const res = await fetch(`/api/dashboard/events/${id}/checkin/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance_id: attendanceId }),
      });
      if (res.ok) { setResult(null); loadStats(); }
      else { const j = await res.json().catch(() => ({})); setErr(j.error ?? t('ci.err.failed')); }
    } catch {
      setErr(t('ci.err.failed'));
    }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'scan', label: t('ci.tab.scan') },
    { key: 'search', label: t('ci.tab.search') },
    { key: 'walkin', label: t('ci.tab.walkin') },
  ];

  return (
    <div className={`${PAGE_WIDE} space-y-4`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-xl font-bold font-serif text-ink">{t('ci.title')}</h2>
          {stats && <p className="text-sm text-ink-muted">{stats.event.title}</p>}
        </div>
        <Link href={`/dashboard/events/${id}`} className="text-sm text-ink-muted hover:text-accent-deep px-2 py-1">
          {t('ci.back')}
        </Link>
      </div>

      {/* live counters */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <p className="text-2xl font-extrabold tabular-nums text-ink">
          {stats ? t('ci.counter', { n: stats.checkedIn, total: stats.regTotal }) : t('ci.loading')}
        </p>
        {stats && stats.perCentre.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {stats.perCentre.map((c) => (
              <span key={c.centre_id ?? '__none'} className="text-[11.5px] px-2.5 py-0.5 rounded-full pill-gold">
                {c.name ?? t('ci.centre.other')} <b className="tabular-nums">{c.count}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      {canEdit && (
        <>
          <div className="flex gap-1.5">
            {TABS.map((x) => (
              <button
                key={x.key}
                onClick={() => { setTab(x.key); setResult(null); setErr(''); }}
                className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border transition ${
                  tab === x.key ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border-strong hover:border-accent'
                }`}
              >
                {x.label}
              </button>
            ))}
          </div>

          {err && (
            <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-xl px-3 py-2.5">{err}</p>
          )}

          {result && <ResultCard result={result} t={t} onUndo={() => undo(result.attendance.id, result.person.name)} onDismiss={() => setResult(null)} />}

          {tab === 'scan' && <ScanPanel onToken={(token) => submit({ token })} t={t} />}
          {tab === 'search' && <SearchPanel id={id} t={t} onCheckin={(registration_id) => submit({ registration_id })} />}
          {tab === 'walkin' && <WalkinPanel t={t} centres={stats?.centres ?? []} onSubmit={(walkin) => submit({ walkin })} />}
        </>
      )}

      {/* recent — visible to view-only roles too */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border">
          <b className="text-[13px] text-ink">{t('ci.recent.title')}</b>
        </div>
        {!stats || stats.recent.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-muted text-center">{stats ? t('ci.recent.empty') : t('ci.loading')}</p>
        ) : (
          <ul>
            {stats.recent.map((r) => (
              <li key={r.id} className="px-4 py-2.5 border-b border-border last:border-b-0 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-ink truncate">
                    {r.name}
                    {r.centre_name && <span className="text-xs text-ink-faint"> · {r.centre_name}</span>}
                  </p>
                  <p className="text-[11px] text-ink-faint font-mono truncate">
                    {r.reg_no ?? t('ci.result.walkin')} · {r.checked_in_by}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-ink-muted tabular-nums">{hhmm(r.checked_in_at)}</span>
                  {canEdit && (
                    <button onClick={() => undo(r.id, r.name)} className="text-xs text-[#B4402E] hover:underline">
                      {t('ci.undo')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Green for a fresh check-in, amber for a repeat. Never red — a repeat scan is a
// normal thing for a person to do, and the tone should say "you're fine".
function ResultCard({ result, t, onUndo, onDismiss }: { result: Result; t: TFunc; onUndo: () => void; onDismiss: () => void }) {
  const { already, person, attendance } = result;
  const tone = already
    ? 'bg-[#FBF6E3] border-[#E7D9A8] text-[#7A6420]'
    : 'bg-[#E7F0E0] border-[#3F6B2E]/25 text-[#3F6B2E]';
  return (
    <div className={`rounded-2xl border p-5 text-center ${tone}`} onClick={onDismiss} role="status">
      <p className="text-2xl font-bold text-ink">{person.name}</p>
      {person.reg_no && <p className="font-mono text-sm text-ink-muted mt-0.5">{person.reg_no}</p>}
      <p className="text-lg font-semibold mt-2">
        {already ? t('ci.result.already', { time: hhmm(attendance.checked_in_at) }) : t('ci.result.ok')}
      </p>
      {person.reg_status && person.reg_status !== 'approved' && (
        <p className="text-xs mt-1.5 text-[#7A6420]">{t('ci.result.notApproved', { status: regStatusLabel(person.reg_status, t) })}</p>
      )}
      <button onClick={(e) => { e.stopPropagation(); onUndo(); }} className="mt-3 text-xs text-[#B4402E] hover:underline">
        {t('ci.undo')}
      </button>
    </div>
  );
}

// Camera scanner. Native BarcodeDetector first, jsqr as the iOS-Safari fallback —
// the same ladder as the inventory scanner. Refs (not state) drive the rAF loop so
// it never closes over a stale callback, and `busy` gates re-entry while a POST is
// in flight so one steady hand doesn't fire the same token five times.
function ScanPanel({ onToken, t }: { onToken: (token: string) => Promise<Result | null>; t: TFunc }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(true);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let busy = false;
    let lastToken = '';
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
      if (video && video.readyState >= 2 && !busy) {
        try {
          let raw: string | null = null;
          if (detector) {
            const codes = await detector.detect(video);
            if (codes.length) raw = codes[0].rawValue;
          } else if (jsQR) {
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (w && h) {
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(video, 0, 0, w, h);
                const img = ctx.getImageData(0, 0, w, h);
                const code = jsQR(img.data, w, h);
                if (code) raw = code.data;
              }
            }
          }
          const token = (raw ?? '').trim();
          if (token) {
            if (!/^[0-9a-f]{64}$/i.test(token)) {
              setStatus(t('ci.scan.notOurs'));
            } else if (token !== lastToken) {
              // Hold the camera on this token until it leaves the frame, so the
              // same person isn't posted repeatedly while the volunteer lowers
              // the phone. A DIFFERENT token always goes straight through.
              busy = true;
              lastToken = token;
              await onTokenRef.current(token);
              setStatus(t('ci.scan.ready'));
              // Re-arm after the result has had time to be read.
              setTimeout(() => { busy = false; }, RESULT_MS);
            }
          }
        } catch {
          /* transient decode error — keep scanning */
        }
      }
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        setStatus(t('ci.scan.opening'));
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) { stream.getTracks().forEach((x) => x.stop()); return; }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => typeof detector }).BarcodeDetector;
        if (BD) { try { detector = new BD({ formats: ['qr_code'] }); } catch { detector = null; } }
        if (!detector) { try { jsQR = (await import('jsqr')).default as unknown as JsQr; } catch { jsQR = null; } }
        if (!detector && !jsQR) { setErr(t('ci.scan.unsupported')); cleanup(); return; }
        setStatus(t('ci.scan.aim'));
        raf = requestAnimationFrame(tick);
      } catch {
        setErr(t('ci.scan.noCamera'));
      }
    })();

    return () => cleanup();
  }, [on, t]);

  if (err) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-5">
        <p className="text-sm text-ink-muted text-center leading-relaxed">{err}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-3">
      {on ? (
        <>
          <div className="relative rounded-xl overflow-hidden bg-black aspect-square max-w-sm mx-auto">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
            <div className="absolute inset-8 border-2 border-white/70 rounded-xl pointer-events-none" />
          </div>
          <p className="mt-2 text-xs text-ink-muted text-center">{status}</p>
          <button onClick={() => setOn(false)} className="mt-2 w-full py-2.5 rounded-xl border border-border-strong bg-surface text-ink text-sm">
            {t('ci.scan.stop')}
          </button>
        </>
      ) : (
        <button onClick={() => setOn(true)} className="w-full btn-primary py-3 font-medium">
          {t('ci.scan.start')}
        </button>
      )}
    </div>
  );
}

function SearchPanel({ id, t, onCheckin }: { id: string; t: TFunc; onCheckin: (registrationId: string) => Promise<Result | null> }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); return; }
    let active = true;
    const h = setTimeout(() => {
      setLoading(true);
      fetch(`/api/dashboard/events/${id}/checkin/search?q=${encodeURIComponent(term)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (active && j) setRows(j.results ?? []); })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(h); };
  }, [q, id]);

  const check = async (row: SearchRow) => {
    setBusyId(row.registration_id);
    try {
      const r = await onCheckin(row.registration_id);
      // Reflect it locally so the row flips without waiting for a refetch.
      if (r) setRows((prev) => prev.map((x) => (x.registration_id === row.registration_id ? { ...x, checked_in: true } : x)));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('ci.search.placeholder')}
        className={inputCls}
        autoComplete="off"
      />
      {q.trim().length > 0 && q.trim().length < 2 && <p className="text-xs text-ink-faint px-1">{t('ci.search.hint')}</p>}
      {loading && <p className="text-sm text-ink-muted px-1">{t('ci.loading')}</p>}
      {!loading && q.trim().length >= 2 && rows.length === 0 && (
        <p className="text-sm text-ink-muted px-1">{t('ci.search.empty')}</p>
      )}
      {rows.length > 0 && (
        <ul className="bg-surface border border-border rounded-2xl overflow-hidden">
          {rows.map((r) => (
            <li key={r.registration_id} className="px-4 py-3 border-b border-border last:border-b-0 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-ink truncate">
                  {r.name}
                  {r.centre_name && <span className="text-xs text-ink-faint"> · {r.centre_name}</span>}
                </p>
                <p className="text-[11px] text-ink-faint font-mono truncate">{r.reg_no}</p>
              </div>
              {r.checked_in ? (
                <span className="text-xs px-3 py-1.5 rounded-full pill-muted shrink-0">{t('ci.search.done')}</span>
              ) : (
                <button
                  onClick={() => check(r)}
                  disabled={busyId === r.registration_id}
                  className="px-4 py-2 rounded-xl btn-primary text-sm shrink-0 disabled:opacity-50"
                >
                  {t('ci.search.checkin')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WalkinPanel({ t, centres, onSubmit }: { t: TFunc; centres: Centre[]; onSubmit: (walkin: Record<string, unknown>) => Promise<Result | null> }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [centreId, setCentreId] = useState('');
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState('');

  const submit = async () => {
    setLocalErr('');
    if (!name.trim()) { setLocalErr(t('ci.walkin.errName')); return; }
    setBusy(true);
    try {
      const r = await onSubmit({ name: name.trim(), phone: phone.trim() || null, centre_id: centreId || null });
      if (r) { setName(''); setPhone(''); setCentreId(''); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
      {localErr && <p className="text-sm text-[#B4402E]">{localErr}</p>}
      <div>
        <label className="block text-sm font-medium text-ink mb-1">{t('ci.walkin.name')}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoComplete="off" />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink mb-1">{t('ci.walkin.phone')}</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="0123456789" className={inputCls} />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink mb-1">{t('ci.walkin.centre')}</label>
        <select value={centreId} onChange={(e) => setCentreId(e.target.value)} className={inputCls}>
          <option value="">{t('ci.walkin.centreNone')}</option>
          {centres.map((c) => <option key={c.id} value={c.id}>{c.name_cn}</option>)}
        </select>
      </div>
      <button onClick={submit} disabled={busy} className="w-full btn-primary py-3 font-medium disabled:opacity-50">
        {busy ? t('ci.walkin.saving') : t('ci.walkin.submit')}
      </button>
    </div>
  );
}
