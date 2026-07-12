// src/components/dashboard-nav.tsx
// The global left navigation rail — one shared component for every dashboard page
// (inbox · reports · settings). A calm, Monday.com-style rail: flat warm bg, clean
// inline line icons (NO emoji except the 🪷 brand mark), generous spacing, a gold
// active pill with a left accent bar.
//
// Desktop (≥768px): a ~72px FIXED rail down the left edge — pages give their content
// `md:ml-[72px]` so it clears the rail. Mobile (<768px): the same items collapse to a
// horizontal row placed under the page's top bar (kept deliberately simple).
//
// adminOnly items (报表 / 设置) render only for admins. The page passes the caller's
// role and which item is `active`.

'use client';

import Link from 'next/link';
import { visibleModules, type Grants, type ModuleDoor } from '@/lib/access';
import { useT } from '@/lib/i18n-react';

type Role = 'admin' | 'volunteer' | 'erp_admin' | 'committee' | 'centre_head';
// The nav keys are the module doors (from visibleModules) plus the hub 'home'.
export type NavKey = ModuleDoor | 'home';

type IconProps = { className?: string };

// Minimal line icons: stroke = currentColor (so the parent's text colour drives
// both icon and label), 1.5 stroke-width, no fill. 22px square.
function InboxIcon({ className }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function ChartIcon({ className }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}

function GearIcon({ className }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    </svg>
  );
}

// Two-person "people" icon for 会员, in the same line-icon style as the others.
function PeopleIcon({ className }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// Calendar icon for 活动, in the same line-icon style.
function CalendarIcon({ className }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

// House icon for the hub 主页, in the same line-icon style.
function HomeIcon({ className }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

// Box/package icon for 库存, in the same line-icon style.
function BoxIcon({ className }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
      <path d="M7.5 5.5l9 5" />
    </svg>
  );
}

// Coins/ledger icon for 财务, in the same line-icon style.
function CoinsIcon({ className }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  );
}

// Lotus icon for 渡人, in the same line-icon style (a lotus bloom on water).
function LotusIcon({ className }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 12c1.6-2.2 2.4-4.4 2.4-6.6C13.4 6 12.6 7.4 12 8.8 11.4 7.4 10.6 6 9.6 5.4 9.6 7.6 10.4 9.8 12 12z" />
      <path d="M12 12c2.4-1 4.6-1.2 6.4-.4-1 1.8-3 3.2-5.2 3.6M12 12c-2.4-1-4.6-1.2-6.4-.4 1 1.8 3 3.2 5.2 3.6" />
      <path d="M3.5 15c2.4 2 5.4 3 8.5 3s6.1-1 8.5-3" />
    </svg>
  );
}

// Chat-bubble icon for 智慧问答 (the care chat inbox), same line-icon style.
function ChatIcon({ className }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 11.5c0 4.1-4 7.5-9 7.5-1 0-2-.13-2.9-.38L4 20l1.2-3.6C3.8 15.1 3 13.4 3 11.5 3 7.4 7 4 12 4s9 3.4 9 7.5z" />
      <path d="M8 10.5h8M8 13h5" />
    </svg>
  );
}

// labelKey routes each door name through the i18n dictionary (nav.*) so the rail
// switches with the active locale; the zh values are byte-identical to the previous
// hardcoded labels.
type Door = { labelKey: string; href: string; Icon: (props: IconProps) => React.ReactElement };

// Destination for every nav key. Which keys actually render is decided ONLY by
// visibleModules (+ the hub, for multi-door accounts) — never here.
// E2 (Ken 2026-07-10): the care module's rail label is now 智慧问答 (chat icon; key stays
// 'inbox', route /dashboard unchanged); the freed name 收件箱 is the NEW centre-mail module
// (door 'mail' → /dashboard/inbox, envelope icon).
const DOORS: Record<NavKey, Door> = {
  home: { labelKey: 'nav.home', href: '/dashboard/home', Icon: HomeIcon },
  mail: { labelKey: 'nav.mail', href: '/dashboard/inbox', Icon: InboxIcon },
  inbox: { labelKey: 'nav.inbox', href: '/dashboard', Icon: ChatIcon },
  outreach: { labelKey: 'nav.outreach', href: '/dashboard/outreach', Icon: LotusIcon },
  members: { labelKey: 'nav.members', href: '/dashboard/members', Icon: PeopleIcon },
  events: { labelKey: 'nav.events', href: '/dashboard/events', Icon: CalendarIcon },
  inventory: { labelKey: 'nav.inventory', href: '/dashboard/inventory', Icon: BoxIcon },
  finance: { labelKey: 'nav.finance', href: '/dashboard/finance', Icon: CoinsIcon },
  reports: { labelKey: 'nav.reports', href: '/dashboard/reports', Icon: ChartIcon },
  settings: { labelKey: 'nav.settings', href: '/dashboard/settings', Icon: GearIcon },
};

export function DashboardNav({
  role,
  active,
  grants,
}: {
  role: Role;
  // 'settings' and 'account' are accepted but no rail item matches them (设置
  // lives in the user menu now) — the rail simply shows nothing highlighted.
  active: NavKey | 'account';
  grants?: Grants;
}) {
  const t = useT();
  // Single source of truth for door visibility. Multi-door accounts also get the
  // hub link (rendered first); single-door users never see it.
  const mods = visibleModules({ role, grants });
  const keys: NavKey[] = mods.length > 1 ? ['home', ...mods] : [...mods];

  return (
    <nav
      aria-label={t('nav.ariaLabel')}
      className="z-20 shrink-0 flex flex-row md:flex-col items-stretch bg-surface border-b md:border-b-0 md:border-r border-border md:fixed md:left-0 md:top-0 md:bottom-0 md:w-[72px]"
    >
      {/* Gold lotus at the TOP of the rail (shell refactor) — the existing
          asset, desktop only (mobile keeps it in the top bar), NO divider
          beneath it, just padding before the nav list. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/xlfm-logo.png"
        alt=""
        width={40}
        height={40}
        className="hidden md:block w-10 h-10 object-contain select-none mx-auto mt-3 mb-1"
      />
      {/* Icons + labels only — the TopBar carries the wordmark. ~56px cells on
          desktop so all 9 operational modules fit a 768px viewport without
          scroll (设置 moved to the user menu); mobile row unchanged. */}
      <ul className="flex flex-row md:flex-col flex-1 md:flex-none items-stretch justify-around md:justify-start gap-1 md:gap-1.5 px-2 py-2 md:pt-2">
        {keys.map((key) => {
          const { labelKey, href, Icon } = DOORS[key];
          const label = t(labelKey);
          const isActive = key === active;
          return (
            <li key={key} className="flex-1 md:flex-none">
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 py-[14px] md:py-2 px-1 rounded-lg transition ${
                  isActive
                    ? 'bg-accent/10 text-accent-deep'
                    : 'text-ink-muted hover:bg-accent/5'
                }`}
              >
                {/* 3px gold left accent bar for the active item */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-[3px] rounded-full bg-accent-deep" />
                )}
                <Icon />
                <span className="text-[10.5px] leading-none">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
