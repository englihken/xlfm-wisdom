// src/app/m/mail-form-client.tsx
// PUBLIC 共修会事务来信 form (E2 §5.4) — the interactive form, extracted
// verbatim from page.tsx in E3 so the page can be a SERVER component that
// checks org_settings public.inbox_form_enabled (fail-open) and passes the
// optional inbox_form_notice down (shown at the top when set). Posts to
// /api/public/inbox (no auth). Success screen shows the mailbox auto-reply
// (on-screen only — no email in plumbing A) + the crisis-openness line.

'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n-react';

type Centre = { code: string; name_cn: string };

export function MailFormClient({ notice }: { notice: string | null }) {
  const t = useT();
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreCode, setCentreCode] = useState('HQ');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — must stay empty
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [autoReply, setAutoReply] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/public/centres')
      .then((r) => (r.ok ? r.json() : { centres: [] }))
      .then((j) => { if (active) setCentres(j.centres ?? []); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const submit = async () => {
    setErr(null);
    if (!name.trim() || !phone.trim() || !subject.trim() || !body.trim()) {
      setErr(t('mailForm.validationRequired'));
      return;
    }
    setState('loading');
    try {
      const res = await fetch('/api/public/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centre_code: centreCode, name: name.trim(), phone: phone.trim(), email: email.trim() || undefined, subject: subject.trim(), body: body.trim(), website }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? t('mailForm.submitFailed'));
        setState('idle');
        return;
      }
      setAutoReply(j.auto_reply_text ?? null);
      setState('done');
    } catch {
      setErr(t('mailForm.networkError'));
      setState('idle');
    }
  };

  if (state === 'done') {
    return (
      <div className="bg-surface border border-border rounded-2xl p-6 text-center">
        <p className="text-4xl mb-2">🪷</p>
        <p className="font-serif font-semibold text-ink text-lg">{t('mailForm.successTitle')}</p>
        <p className="mt-1 text-sm text-ink-muted">{t('mailForm.successSub')}</p>
        {autoReply && (
          <p className="mt-4 text-sm text-ink leading-relaxed bg-accent/10 rounded-xl px-4 py-3 text-left whitespace-pre-wrap">{autoReply}</p>
        )}
        <p className="mt-4 text-xs text-ink-muted leading-relaxed">{t('mailForm.crisisNote')}</p>
      </div>
    );
  }

  const inputCls = 'w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-accent';

  return (
    <div className="space-y-3">
      {/* E3: optional org-wide notice (org_settings public.inbox_form_notice) */}
      {notice && (
        <div className="rounded-xl px-4 py-3 bg-[#FBF3DE] border border-gold-border text-[#4A3A14] text-sm leading-relaxed whitespace-pre-wrap">
          {notice}
        </div>
      )}
      <div className="bg-surface border border-border rounded-2xl p-5 space-y-3">
        {err && <p className="text-sm text-red-600">{err}</p>}

        <div>
          <label className="block text-sm font-medium text-ink mb-1">{t('mailForm.centreLabel')}</label>
          <select value={centreCode} onChange={(e) => setCentreCode(e.target.value)} className={inputCls}>
            <option value="HQ">{t('mailForm.centreHQ')}</option>
            {centres.filter((c) => c.code !== 'HQ').map((c) => (
              <option key={c.code} value={c.code}>{c.name_cn}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">{t('mailForm.nameLabel')} <span className="text-red-600">*</span></label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">{t('mailForm.phoneLabel')} <span className="text-red-600">*</span></label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="012-345 6789" className={inputCls} />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">{t('mailForm.emailLabel')} <span className="text-ink-faint">{t('mailForm.optional')}</span></label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" className={inputCls} />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">{t('mailForm.subjectLabel')} <span className="text-red-600">*</span></label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">{t('mailForm.bodyLabel')} <span className="text-red-600">*</span></label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className={inputCls} />
        </div>

        {/* honeypot — visually hidden; bots fill it, humans don't */}
        <input
          type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1} autoComplete="off" aria-hidden="true"
          className="absolute -left-[9999px] w-px h-px opacity-0"
        />

        <button disabled={state === 'loading'} onClick={submit} className="w-full mt-1 py-2.5 text-sm btn-primary disabled:opacity-50">
          {state === 'loading' ? t('mailForm.submitting') : t('mailForm.submitButton')}
        </button>
        <p className="text-[10.5px] text-ink-faint text-center leading-relaxed">{t('mailForm.crisisNote')}</p>
      </div>
    </div>
  );
}
