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

type Role = 'admin' | 'volunteer' | 'erp_admin' | 'committee';
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

type Door = { label: string; href: string; Icon: (props: IconProps) => React.ReactElement };

// Destination for every nav key. Which keys actually render is decided ONLY by
// visibleModules (+ the hub, for multi-door accounts) — never here.
const DOORS: Record<NavKey, Door> = {
  home: { label: '主页', href: '/dashboard/home', Icon: HomeIcon },
  inbox: { label: '收件箱', href: '/dashboard', Icon: InboxIcon },
  members: { label: '会员', href: '/dashboard/members', Icon: PeopleIcon },
  events: { label: '活动', href: '/dashboard/events', Icon: CalendarIcon },
  reports: { label: '报表', href: '/dashboard/reports', Icon: ChartIcon },
  settings: { label: '设置', href: '/dashboard/settings', Icon: GearIcon },
};

export function DashboardNav({
  role,
  active,
  grants,
}: {
  role: Role;
  active: NavKey;
  grants?: Grants;
}) {
  // Single source of truth for door visibility. Multi-door accounts also get the
  // hub link (rendered first); single-door users never see it.
  const mods = visibleModules({ role, grants });
  const keys: NavKey[] = mods.length > 1 ? ['home', ...mods] : [...mods];

  return (
    <nav
      aria-label="主导航"
      className="z-20 shrink-0 flex flex-row md:flex-col items-stretch bg-[#FFFEF6] border-b md:border-b-0 md:border-r border-[#EFE3BF] md:fixed md:left-0 md:top-0 md:bottom-0 md:w-[72px]"
    >
      {/* 🪷 brand mark — the one allowed emoji. Desktop only; the mobile row stays
          lean (just icons + labels). */}
      <div className="hidden md:flex items-center justify-center py-5 text-2xl select-none">
        🪷
      </div>

      <ul className="flex flex-row md:flex-col flex-1 md:flex-none items-stretch justify-around md:justify-start gap-1 md:gap-3 px-2 py-2 md:py-1">
        {keys.map((key) => {
          const { label, href, Icon } = DOORS[key];
          const isActive = key === active;
          return (
            <li key={key} className="flex-1 md:flex-none">
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 py-[14px] px-1 rounded-lg transition ${
                  isActive
                    ? 'bg-[#FAEFD0] text-[#A87929]'
                    : 'text-[#8B6F47] hover:bg-[#FAEFD0]/50'
                }`}
              >
                {/* 3px gold left accent bar for the active item */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-[3px] rounded-full bg-[#A87929]" />
                )}
                <Icon />
                <span className="text-[11px] leading-none">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
