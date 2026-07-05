// src/app/dashboard/login/page.tsx
// 义工登录 — Volunteer login for the care dashboard.
// Signs in via Supabase Auth (email + password) using the browser ANON client,
// then redirects to /dashboard on success.

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { PLATFORM_NAME } from '@/lib/platform';

export default function DashboardLoginPage() {
  const router = useRouter();
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
        setError('登录失败，请检查邮箱和密码是否正确。');
        setIsLoading(false);
        return;
      }

      // Success — go to the protected dashboard.
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('暂时无法连接，请稍后再试。');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFF3DA] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#583A0F]">🪷 {PLATFORM_NAME}</h1>
          <p className="mt-2 text-sm text-[#8B6F47]">登录</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl shadow-sm p-6 sm:p-8 space-y-5"
        >
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[#583A0F] mb-1.5">
              邮箱
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
              className="w-full p-3 border border-[#EFE3BF] rounded-xl bg-white text-[#583A0F] placeholder:text-[#B89968] focus:outline-none focus:border-[#D89938] focus:ring-1 focus:ring-[#D89938] disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[#583A0F] mb-1.5">
              密码
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
              className="w-full p-3 border border-[#EFE3BF] rounded-xl bg-white text-[#583A0F] placeholder:text-[#B89968] focus:outline-none focus:border-[#D89938] focus:ring-1 focus:ring-[#D89938] disabled:opacity-50"
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
            className="w-full py-3 bg-[#D89938] hover:bg-[#A87929] text-white rounded-xl font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? '登录中…' : '登录'}
          </button>
        </form>

        <p className="text-center text-xs text-[#8B6F47] mt-6">
          一切免费结缘 · 菩萨慈悲 🙏
        </p>
      </div>
    </div>
  );
}
