// src/components/top-bar.tsx
// The shared platform top bar (2b theme). One frame for every wing: a white
// surface with a --border bottom edge and a 3px gold hairline, the platform
// logo + small-caps platform label, an optional serif wing/module title, and
// the signed-in user + logout on the right.
//
// T1 wires this into the hub (dashboard/home) only; module pages adopt it in
// T2/T3. Purely presentational — the caller owns auth/logout logic and passes
// `userLabel` + `onLogout`.

'use client';

import { PLATFORM_NAME } from '@/lib/platform';

export function TopBar({
  moduleTitle,
  userLabel,
  onLogout,
}: {
  /** Serif wing/module title (e.g. 收件箱). Omit on the hub for brand-only. */
  moduleTitle?: string;
  /** Display name or email of the signed-in user. */
  userLabel?: string;
  onLogout?: () => void;
}) {
  return (
    <header className="shrink-0 bg-surface border-b border-border">
      <div className="px-5 py-3 flex items-center justify-between gap-3">
        {/* brand: logo + (platform label kicker · serif title) */}
        <div className="flex items-center gap-3 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/xlfm-logo.png"
            alt=""
            width={40}
            height={40}
            className="w-10 h-10 object-contain select-none shrink-0"
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

        {/* user + logout */}
        {(userLabel || onLogout) && (
          <div className="flex items-center gap-4 shrink-0">
            {userLabel && (
              <span className="hidden sm:inline text-sm text-ink-muted truncate max-w-[40vw]">
                {userLabel}
              </span>
            )}
            {onLogout && (
              <button onClick={onLogout} className="btn-secondary px-4 py-1.5 text-sm">
                登出
              </button>
            )}
          </div>
        )}
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
