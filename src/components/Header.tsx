"use client";

import { useState } from "react";
import Link from "next/link";
import SealMark from "@/components/SealMark";

const navItems = [
  { label: "首页", href: "/" },
  { label: "认识心灵法门", href: "#about" },
  { label: "修学方法", href: "#practice" },
  { label: "智慧学习", href: "#wisdom" },
  { label: "人生指引", href: "#guidance" },
  { label: "智慧问答", href: "#qa" },
];

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-bg/95 backdrop-blur-sm border-b border-border-strong">
      <div className="h-1.5 bg-gradient-to-r from-sun via-sun-deep to-sun" aria-hidden />
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16 sm:h-20">
          {/* Brand — reading seal + serif wordmark */}
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <SealMark size={36} />
            <div>
              <div className="font-serif text-sm sm:text-base font-bold text-ink leading-tight tracking-wide">
                马来西亚卢台长心灵法门
              </div>
              <div className="u-label hidden sm:block mt-0.5">
                Xin Ling Fa Men Malaysia
              </div>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map(item => (
              <a
                key={item.label}
                href={item.href}
                className="px-3 py-2 text-sm text-ink-body hover:text-accent-deep transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* The homepage itself is Chinese-only; EN/ID live in 智慧问答,
              which is genuinely trilingual — link there instead of showing a
              switcher that translates nothing (08-16 audit §2.3). */}
          <div className="flex items-center gap-2">
            <Link
              href="/qa"
              className="text-xs text-ink-muted hover:text-accent-deep whitespace-nowrap px-2 py-1"
            >
              EN / ID<span className="hidden sm:inline"> → 智慧问答</span>
            </Link>

            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-2 text-ink-muted hover:text-accent-deep"
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <nav className="lg:hidden border-t border-border bg-bg px-4 pb-4">
          {navItems.map(item => (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className="block py-3 text-ink-body hover:text-accent-deep border-b border-border/50 last:border-0"
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
