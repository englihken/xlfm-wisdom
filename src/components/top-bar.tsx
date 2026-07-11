// src/components/top-bar.tsx
// The shared platform top bar (2b theme). One frame for every wing: a white
// surface with a --border bottom edge and a 3px gold hairline, the platform
// wordmark + optional serif wing/module title on the left, and the UserMenu
// (avatar + name + dropdown: 账号设置 / 系统设置 / 登出) on the right.
//
// Shell refactor: the static user name is replaced by the functional UserMenu;
// the gold lotus lives at the TOP OF THE RAIL on desktop (dashboard-nav), so
// the top-bar logo renders on MOBILE ONLY (where the rail is a horizontal row
// with no room for it) — never twice on one breakpoint. The caller still owns
// auth/logout and passes `userLabel` + `onLogout` exactly as before.

'use client';

import { PLATFORM_NAME } from '@/lib/platform';
import { UserMenu } from '@/components/user-menu';

export function TopBar({
  moduleTitle,
  userLabel,
  onLogout,
}: {
  /** Serif wing/module title (e.g. 收件箱). Omit on the hub for brand-only. */
  moduleTitle?: string;
  /** Display name or email of the signed-in user (UserMenu fallback while /me loads). */
  userLabel?: string;
  onLogout?: () => void;
}) {
  return (
    <header className="shrink-0 bg-surface border-b border-border">
      <div className="px-5 py-3 flex items-center justify-between gap-3">
        {/* brand: wordmark (+ serif module title). Lotus is rail-top on desktop. */}
        <div className="flex items-center gap-3 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/xlfm-logo.png"
            alt=""
            width={40}
            height={40}
            className="w-10 h-10 object-contain select-none shrink-0 md:hidden"
          />
          <div className="min-w-0">
            {moduleTitle ? (
              <>
                <p className="u-label">{PLATFORM_NAME}</p>
                <h1 className="font-serif text-[18px] font-bold text-ink leading-tight truncate">
                  {moduleTitle}
                </h1>
              </>
            ) : (
              <h1 className="font-serif text-[18px] font-bold text-ink leading-tight truncate">
                {PLATFORM_NAME}
              </h1>
            )}
          </div>
        </div>

        <UserMenu fallbackLabel={userLabel} onLogout={onLogout} />
      </div>
      {/* 3px gold hairline under the bar */}
      <div
        className="h-[3px] w-full"
        style={{
          background:
            'linear-gradient(90deg,#E9CD86,#C08A2D 40%,#E9CD86 80%,#F4E5BC)',
        }}
      />
    </header>
  );
}
