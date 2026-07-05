// src/components/erp-gate.tsx
// Shared shell + access gate for the Members (ERP) pages, mirroring the care pages'
// pattern: auth gate → /me → mustChangePassword gate → module-access gate → shell
// (top bar + DashboardNav + main). Renders children with the resolved `me` (incl.
// grants) so each page can gate its own edit actions. members:view is required to
// see the page; a lack of it shows a polite notice (the API 403s regardless).

'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { PasswordChangeGate } from '@/components/password-change-gate';
import { DashboardNav, type NavKey } from '@/components/dashboard-nav';
import { grantAllows, type Grants } from '@/lib/access';
import { PLATFORM_NAME } from '@/lib/platform';

export type ErpMe = {
  email: string;
  displayName: string | null;
  role: 'admin' | 'volunteer' | 'erp_admin' | 'committee';
  grants: Grants;
};

export function ErpGate({
  active,
  titleSuffix,
  children,
}: {
  active: NavKey;
  // Short page-context breadcrumb (新增/资料/编辑). The module title is always 会员.
  titleSuffix?: string;
  children: (me: ErpMe) => ReactNode;
}) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<ErpMe | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [gate, setGate] = useState<'checking' | 'denied' | 'ok'>('checking');

  const forceSignOut = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
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
        setGate(grantAllows(grants, 'members', 'view') ? 'ok' : 'denied');
      } catch {
        /* neutral loader covers a failure */
      }
    })();
    return () => {
      active2 = false;
    };
  }, [checking, router, forceSignOut]);

  const handleLogout = async () => {
    await forceSignOut();
    router.refresh();
  };

  if (checking || gate === 'checking') {
    return (
      <div className="min-h-screen bg-[#FFF3DA] flex items-center justify-center">
        <p className="text-sm text-[#8B6F47]">加载中…</p>
      </div>
    );
  }

  if (mustChangePassword) {
    return <PasswordChangeGate onDone={() => setMustChangePassword(false)} />;
  }

  if (gate === 'denied') {
    return (
      <div className="min-h-screen bg-[#FFF3DA] flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-[#583A0F]">此页面需要会员模块权限</p>
          <p className="mt-2 text-sm text-[#8B6F47]">如需帮助，请联系系统管理员。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#FFF3DA] md:ml-[72px]">
      <header className="shrink-0 border-b border-[#EFE3BF] bg-white/60 backdrop-blur-sm">
        <div className="px-5 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] leading-none text-[#B89968]">🪷 {PLATFORM_NAME}</p>
            <h1 className="mt-0.5 text-lg font-bold text-[#583A0F] leading-tight">
              会员{' '}
              <span className="text-sm font-normal text-[#B89968]">
                · Members{titleSuffix ? ` · ${titleSuffix}` : ''}
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-sm text-[#8B6F47]">{me?.displayName || me?.email}</span>
            <button
              onClick={handleLogout}
              className="px-4 py-1.5 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      <DashboardNav role={me?.role ?? 'volunteer'} active={active} grants={me?.grants} />

      <main className="flex-1 min-w-0 overflow-y-auto">{me && children(me)}</main>
    </div>
  );
}
