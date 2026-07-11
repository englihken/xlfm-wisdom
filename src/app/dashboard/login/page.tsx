// src/app/dashboard/login/page.tsx
// 义工登录 — Volunteer login for the care dashboard.
// Signs in via Supabase Auth (email + password) using the browser ANON client,
// then redirects to /dashboard on success.

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { PLATFORM_NAME } from '@/lib/platform';
import { visibleModules } from '@/lib/access';
import { useT } from '@/lib/i18n-react';

export default function DashboardLoginPage() {
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setError(null);
    setIsLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(t('login.errorInvalid'));
        setIsLoading(false);
        return;
      }

      // Success — LOGIN is the only landing moment. Decide the destination once here
      // from the caller's visible doors; module pages never re-run a landing redirect.
      //  >1 door → the hub; exactly members → members; otherwise (incl. any /me failure,
      //  failing toward care) → the inbox. mustChangePassword is handled by the target
      //  page's existing gate.
      let dest = '/dashboard';
      try {
        const meRes = await fetch('/api/dashboard/me');
        if (meRes.ok) {
          const me = await meRes.json();
          const mods = visibleModules({ role: me.role, grants: me.grants ?? {} });
          if (mods.length > 1) dest = '/dashboard/home';
          else if (mods.length === 1 && mods[0] === 'members') dest = '/dashboard/members';
        }
      } catch {
        /* fail toward care — dest stays /dashboard */
      }
      router.replace(dest);
      router.refresh();
    } catch {
      setError(t('login.errorConnection'));
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/xlfm-logo.png" alt="" width={40} height={40} className="w-10 h-10 object-contain mb-3" />
          <h1 className="font-serif text-2xl font-bold text-ink">{PLATFORM_NAME}</h1>
          <p className="mt-2 text-sm text-ink-muted">{t('login.subtitle')}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-2xl shadow-sm p-6 sm:p-8 space-y-5"
        >
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-ink mb-1.5">
              {t('login.emailLabel')}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              placeholder="you@example.com"
              className="w-full p-3 border border-border rounded-xl bg-white text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-ink mb-1.5">
              {t('login.passwordLabel')}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              placeholder="••••••••"
              className="w-full p-3 border border-border rounded-xl bg-white text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !email.trim() || !password}
            className="btn-primary w-full py-3 text-sm font-medium"
          >
            {isLoading ? t('login.submitting') : t('login.submit')}
          </button>
        </form>

        <p className="text-center text-xs text-ink-muted mt-6">
          {t('login.footer')}
        </p>
      </div>
    </div>
  );
}
