// src/components/erp-gate.tsx
// Shared shell + access gate for the Members (ERP) pages, mirroring the care pages'
// pattern: auth gate → /me → mustChangePassword gate → module-access gate → shell
// (top bar + DashboardNav + main). Renders children with the resolved `me` (incl.
// grants) so each page can gate its own edit actions. members:view is required to
// see the page; a lack of it shows a polite notice (the API 403s regardless).

'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient, signOutEverywhere } from '@/lib/supabase-browser';
import { PasswordChangeGate } from '@/components/password-change-gate';
import { DashboardNav, type NavKey } from '@/components/dashboard-nav';
import { TopBar } from '@/components/top-bar';
import { grantAllows, type Grants } from '@/lib/access';
import { useT } from '@/lib/i18n-react';

export type ErpMe = {
  email: string;
  displayName: string | null;
  role: 'admin' | 'volunteer' | 'erp_admin' | 'committee';
  grants: Grants;
};

export function ErpGate({
  active,
  module = 'members',
  titleSuffix,
  children,
}: {
  active: NavKey;
  // Which ERP module this page belongs to — gates on grants[module] >= view and sets
  // the header title. Members pages omit it (default 'members') → unchanged behavior.
  module?: 'members' | 'events' | 'inventory' | 'finance' | 'outreach';
  // Short page-context breadcrumb (新增/资料/编辑 / 详情).
  titleSuffix?: string;
  children: (me: ErpMe) => ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<ErpMe | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [gate, setGate] = useState<'checking' | 'denied' | 'ok'>('checking');

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
    let active2 = true;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/me');
        if (!active2) return;
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
        if (!active2) return;
        const grants: Grants = json.grants ?? {};
        setMe({ email: json.email, displayName: json.displayName ?? null, role: json.role, grants });
        if (json.mustChangePassword) setMustChangePassword(true);
        setGate(grantAllows(grants, module, 'view') ? 'ok' : 'denied');
      } catch {
        /* neutral loader covers a failure */
      }
    })();
    return () => {
      active2 = false;
    };
  }, [checking, router, forceSignOut, module]);

  const handleLogout = async () => {
    await forceSignOut();
    router.refresh();
  };

  if (checking || gate === 'checking') {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-sm text-ink-muted">{t('common.loading')}</p>
      </div>
    );
  }

  if (mustChangePassword) {
    return <PasswordChangeGate onDone={() => setMustChangePassword(false)} />;
  }

  if (gate === 'denied') {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-ink">{t('erp.denied', { module: t(`nav.${module}`) })}</p>
          <p className="mt-2 text-sm text-ink-muted">{t('common.deniedHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg md:ml-[72px]">
      <TopBar
        moduleTitle={`${t(`erp.title.${module}`)}${titleSuffix ? ` · ${titleSuffix}` : ''}`}
        userLabel={me?.displayName || me?.email || undefined}
        onLogout={handleLogout}
      />

      <DashboardNav role={me?.role ?? 'volunteer'} active={active} grants={me?.grants} />

      <main className="flex-1 min-w-0 overflow-y-auto">{me && children(me)}</main>
    </div>
  );
}
