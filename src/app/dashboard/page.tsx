// src/app/dashboard/page.tsx
// 心灵法门人文关怀系统 — volunteer dashboard.
// Phase 3 Session 1: auth gate + placeholder only. Proves login works; the real
// inbox UI comes in the next session. Redirects unauthenticated visitors to login.

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

export default function DashboardPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getUser().then(({ data, error }) => {
      if (error || !data.user) {
        router.replace('/dashboard/login');
        return;
      }
      setEmail(data.user.email ?? '');
      setChecking(false);
    });
  }, [router]);

  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace('/dashboard/login');
    router.refresh();
  };

  // While verifying the session (or redirecting), show a quiet placeholder so we
  // never flash protected content to a logged-out visitor.
  if (checking) {
    return (
      <div className="min-h-screen bg-[#FFF3DA] flex items-center justify-center">
        <p className="text-sm text-[#8B6F47]">加载中…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFF3DA]">
      <header className="border-b border-[#EFE3BF] bg-white/60 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-[#583A0F]">心灵法门人文关怀系统</h1>
          <button
            onClick={handleLogout}
            className="px-4 py-1.5 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition"
          >
            登出
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl shadow-sm p-8 text-center">
          <p className="text-lg text-[#583A0F]">
            欢迎，<span className="font-semibold">{email}</span>
          </p>
          <p className="mt-3 text-sm text-[#8B6F47]">
            登录成功。义工关怀收件箱即将上线。
          </p>
        </div>
      </main>
    </div>
  );
}
