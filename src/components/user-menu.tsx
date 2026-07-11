// src/components/user-menu.tsx
// The top-right user menu (shell refactor): avatar initial + display name +
// chevron toggling a dropdown with an identity header (name · role · centre ·
// email), 账号设置 → /dashboard/account, 系统设置 → the EXISTING
// /dashboard/settings (shown only when canOpenSettings — the same settings≥edit
// gate that governed the old rail item; the page itself stays gated regardless),
// and 登出 via the caller's existing logout handler (which uses the server
// logout route — the d48e9c9 cookie fix, never client-only signOut).
//
// Self-contained: fetches /api/dashboard/me once on mount for the identity
// fields, falling back to the label the shell already passes, so no page shell
// needed changing. Click-outside and ESC close; proper menu aria. All strings
// via t() (E3 rule — E4 inserts its 语言/Language row into the marked slot).

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { canOpenSettings, type Grants } from '@/lib/access';
import { LOCALES, LOCALE_NATIVE_NAME, type TFunc } from '@/lib/i18n';
import { useT, useLocale, useChangeLocale } from '@/lib/i18n-react';

type MenuMe = {
  displayName: string | null;
  email: string;
  role: string;
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

const roleLabel = (t: TFunc, role: string): string => (ROLE_KEY[role] ? t(ROLE_KEY[role]) : role);

function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const dim = size === 'md' ? 'w-10 h-10 text-base' : 'w-8 h-8 text-sm';
  return (
    <span
      aria-hidden="true"
      className={`${dim} shrink-0 rounded-full inline-flex items-center justify-center font-semibold text-white select-none`}
      style={{ background: 'linear-gradient(160deg, #D9A63E, #B8862B)' }}
    >
      {initial}
    </span>
  );
}

export function UserMenu({ fallbackLabel, onLogout }: { fallbackLabel?: string; onLogout?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const changeLocale = useChangeLocale();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<MenuMe | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Identity for the header block — best-effort; the fallback label keeps the
  // button usable while (or if) this is still loading.
  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) {
          setMe({
            displayName: j.displayName ?? null,
            email: j.email,
            role: j.role,
            centreName: j.centreName ?? null,
            grants: j.grants ?? {},
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Click-outside + ESC close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const name = me?.displayName || me?.email || fallbackLabel || '';
  const showSettings = canOpenSettings(me?.grants);

  const itemCls =
    'w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-accent/5 transition text-left';

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full pl-1 pr-2.5 py-1 hover:bg-accent/5 transition"
      >
        <Avatar name={name || '?'} />
        <span className="hidden sm:inline text-sm text-ink max-w-[28vw] truncate">{name}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('shell.usermenu.label')}
          className="absolute right-0 top-full mt-2 w-64 bg-surface border border-border rounded-2xl shadow-lg overflow-hidden z-50"
        >
          {/* identity header — read-only, from the session's volunteer row */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-surface-soft">
            <Avatar name={name || '?'} size="md" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink truncate">{name}</p>
              {me && (
                <>
                  <p className="text-[11.5px] text-ink-muted truncate">
                    {roleLabel(t, me.role)}
                    {me.centreName ? ` · ${me.centreName}` : ''}
                  </p>
                  <p className="text-[11px] text-ink-faint truncate">{me.email}</p>
                </>
              )}
            </div>
          </div>

          <div className="py-1">
            <Link href="/dashboard/account" role="menuitem" className={itemCls} onClick={() => setOpen(false)}>
              <span aria-hidden="true">👤</span> {t('shell.usermenu.account')}
            </Link>
            {showSettings && (
              <Link href="/dashboard/settings" role="menuitem" className={itemCls} onClick={() => setOpen(false)}>
                <span aria-hidden="true">⚙️</span> {t('shell.usermenu.settings')}
              </Link>
            )}
            {/* 语言 / Language (E4) — between 系统设置 and 登出. Persists to the
                session volunteer's volunteers.locale (+ NEXT_LOCALE cookie) and
                re-renders through the t() layer. Names always in their own language. */}
            <div className="my-1 border-t border-border" />
            <div className="px-4 pt-1.5 pb-1 text-[11px] text-ink-faint">{t('shell.usermenu.language')}</div>
            <div className="px-2 pb-1.5 flex flex-col">
              {LOCALES.map((loc) => (
                <button
                  key={loc}
                  role="menuitemradio"
                  aria-checked={locale === loc}
                  onClick={() => {
                    void changeLocale(loc, { persist: true });
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm text-left transition ${
                    locale === loc ? 'bg-accent/10 text-accent-deep font-medium' : 'text-ink hover:bg-accent/5'
                  }`}
                >
                  <span className={`w-3.5 shrink-0 ${locale === loc ? 'text-accent-deep' : 'text-transparent'}`}>✓</span>
                  <span>{LOCALE_NATIVE_NAME[loc]}</span>
                </button>
              ))}
            </div>
            <div className="my-1 border-t border-border" />
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLogout?.();
              }}
              className={itemCls}
            >
              <span aria-hidden="true">↩</span> {t('shell.usermenu.logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
