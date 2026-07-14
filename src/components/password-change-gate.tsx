// src/components/password-change-gate.tsx
// Full-screen warm-palette gate shown on first login when the volunteer still has
// the admin-set initial password (mustChangePassword). Blocks the dashboard until
// they set a new one, then calls onDone() so the app continues in the SAME session
// (no re-login). Used by both the inbox and the settings page.
//
// Fail-open is the caller's job: only render this when /me explicitly reports
// mustChangePassword === true. All setState here lives in the submit handler.

'use client';

import { useState, type FormEvent } from 'react';

export function PasswordChangeGate({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);

    if (!currentPassword) {
      setError('请输入当前密码（初始密码）');
      return;
    }
    if (password.length < 8) {
      setError('密码至少需要 8 位');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/dashboard/me/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword: password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? '设置失败，请重试');
        setSaving(false);
        return;
      }
      // Success — the parent clears the gate and we stay in the same session.
      onDone();
    } catch {
      setError('设置失败，请重试');
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-serif text-2xl font-bold text-ink">首次登录，请设置您的新密码</h1>
          <p className="mt-2 text-sm text-ink-muted">为了账号安全，请将初始密码更换为您自己的密码。</p>
        </div>

        <form
          onSubmit={handleSubmit}
          autoComplete="off"
          className="bg-surface border border-border rounded-2xl shadow-sm p-6 sm:p-8 space-y-5"
        >
          <div>
            <label htmlFor="current-password" className="block text-sm font-medium text-ink mb-1.5">
              当前密码（初始密码）
            </label>
            <input
              id="current-password"
              name="current-password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={saving}
              placeholder="登录时使用的密码"
              className="w-full p-3 border border-border-strong rounded-xl bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-ink mb-1.5">
              新密码
            </label>
            <input
              id="new-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={saving}
              placeholder="至少 8 位"
              className="w-full p-3 border border-border-strong rounded-xl bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-ink mb-1.5">
              确认密码
            </label>
            <input
              id="confirm-password"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={saving}
              placeholder="再次输入新密码"
              className="w-full p-3 border border-border-strong rounded-xl bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || !currentPassword || password.length < 8 || confirm.length < 8}
            className="btn-primary w-full py-3 text-sm font-medium"
          >
            {saving ? '设置中…' : '确认'}
          </button>
        </form>
      </div>
    </div>
  );
}
