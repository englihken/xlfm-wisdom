// src/app/dashboard/account/page.tsx
// 账号设置 — the minimal personal page the UserMenu's 账号设置 item opens
// (shell refactor). Shows the session's OWN volunteer row read-only (name,
// role, centre, email) plus 修改密码, which reuses the EXISTING
// POST /api/dashboard/me/change-password route (same one behind the forced
// first-login gate — server-side, own-account only). Any active volunteer may
// open this page; there is nothing here beyond their own identity. All new
// strings via t() (E3 rule).

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient, signOutEverywhere } from '@/lib/supabase-browser';
import { PasswordChangeGate } from '@/components/password-change-gate';
import { DashboardNav } from '@/components/dashboard-nav';
import { TopBar } from '@/components/top-bar';
import type { Grants } from '@/lib/access';
import { useT } from '@/lib/i18n-react';

type Me = {
  email: string;
  displayName: string | null;
  role: 'admin' | 'volunteer' | 'erp_admin' | 'committee' | 'centre_head';
  centreName: string | null;
  grants: Grants;
};

const ROLE_KEY: Record<string, string> = {
  admin: 'shell.role.admin',
  volunteer: 'shell.role.volunteer',
  erp_admin: 'shell.role.erpAdmin',
  committee: 'shell.role.committee',
  centre_head: 'shell.role.centreHead',
  finance_director: 'shell.role.financeDirector',
  centre_finance: 'shell.role.centreFinance',
};

export default function AccountPage() {
  const t = useT();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const forceSignOut = useCallback(async () => {
    await signOutEverywhere();
    router.replace('/dashboard/login');
  }, [router]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data, error }) => {
      if (error || !data.user) {
        router.replace('/dashboard/login');
        return;
      }
      setChecking(false);
    });
  }, [router]);

  useEffect(() => {
    if (checking) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/me');
        if (!active) return;
        if (res.status === 401) {
          router.replace('/dashboard/login');
          return;
        }
        if (res.status === 403) {
          await forceSignOut();
          return;
        }
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        setMe({
          email: json.email,
          displayName: json.displayName ?? null,
          role: json.role,
          centreName: json.centreName ?? null,
          grants: json.grants ?? {},
        });
        if (json.mustChangePassword) setMustChangePassword(true);
      } catch {
        /* neutral loader covers a failure */
      }
    })();
    return () => {
      active = false;
    };
  }, [checking, router, forceSignOut]);

  const handleLogout = async () => {
    await forceSignOut();
    router.refresh();
  };

  if (checking || !me) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-sm text-ink-muted">{t('common.loading')}</p>
      </div>
    );
  }
  if (mustChangePassword) {
    return <PasswordChangeGate onDone={() => setMustChangePassword(false)} />;
  }

  const roleLabel = ROLE_KEY[me.role] ? t(ROLE_KEY[me.role]) : me.role;

  return (
    <div className="min-h-screen flex flex-col bg-bg md:ml-[72px]">
      <TopBar moduleTitle={t('account.moduleTitle')} userLabel={me.displayName || me.email} onLogout={handleLogout} />
      <DashboardNav role={me.role} active="account" grants={me.grants} />

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
          <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
            <h2 className="font-serif text-base font-semibold text-ink">{t('account.identityTitle')}</h2>
            <p className="mt-1 text-sm text-ink-muted">{t('account.identityHint')}</p>
            <dl className="mt-4 space-y-3">
              <Field label={t('account.field.name')} value={me.displayName || '—'} />
              <Field label={t('account.field.role')} value={roleLabel} />
              <Field label={t('account.field.centre')} value={me.centreName ?? '—'} />
              <Field label={t('account.field.email')} value={me.email} mono />
            </dl>
          </section>

          <ChangePasswordCard />
        </div>
      </main>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="u-label mb-0.5">{label}</dt>
      <dd className={`text-sm text-ink ${mono ? 'font-mono text-[13px]' : ''}`}>{value}</dd>
    </div>
  );
}

// 修改密码 — reuses the existing own-account change-password route.
function ChangePasswordCard() {
  const t = useT();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    if (busy) return;
    setMsg(null);
    if (pw.length < 8) {
      setMsg({ ok: false, text: t('account.pw.tooShort') });
      return;
    }
    if (pw !== pw2) {
      setMsg({ ok: false, text: t('account.pw.mismatch') });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/me/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: pw }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok) {
        setPw('');
        setPw2('');
        setMsg({ ok: true, text: t('account.pw.done') });
      } else {
        setMsg({ ok: false, text: j?.error ?? t('common.saveFailed') });
      }
    } catch {
      setMsg({ ok: false, text: t('common.saveFailed') });
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent disabled:opacity-50';

  return (
    <section className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
      <h2 className="font-serif text-base font-semibold text-ink">{t('account.pw.title')}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t('account.pw.hint')}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="acct-pw" className="u-label block mb-1">
            {t('account.pw.new')}
          </label>
          <input
            id="acct-pw"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            disabled={busy}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="acct-pw2" className="u-label block mb-1">
            {t('account.pw.confirm')}
          </label>
          <input
            id="acct-pw2"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            disabled={busy}
            className={inputCls}
          />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy || pw.length < 8 || pw2.length < 8}
          className="btn-primary px-5 py-2 text-sm disabled:cursor-not-allowed"
        >
          {busy ? t('account.pw.saving') : t('account.pw.submit')}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-accent-deep' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </section>
  );
}
