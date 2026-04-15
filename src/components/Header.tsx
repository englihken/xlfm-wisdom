"use client";

import { useState } from "react";

const navItems = [
  { label: "首页", href: "/" },
  { label: "认识心灵法门", href: "#about" },
  { label: "修学方法", href: "#practice" },
  { label: "智慧学习", href: "#wisdom" },
  { label: "人生指引", href: "#guidance" },
  { label: "智慧问答", href: "#qa" },
];

const languages = ["中文", "EN", "ID"];

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeLang, setActiveLang] = useState("中文");

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-card-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Top bar */}
        <div className="flex items-center justify-between h-16 sm:h-20">
          {/* Logo */}
          <a href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-gold-banner to-amber flex items-center justify-center">
              <svg
                viewBox="0 0 32 32"
                className="w-5 h-5 sm:w-6 sm:h-6 text-white"
                fill="currentColor"
              >
                <path d="M16 2C14 6 10 8 8 12c-2 4-1 8 2 10s7 2 10-1c3 3 7 3 10 1s4-6 2-10C30 8 26 6 24 2c-2 4-4 6-8 6S18 6 16 2z" />
              </svg>
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-bold text-brown leading-tight">
                心灵法门马来西亚
              </div>
              <div className="text-xs text-amber tracking-wide">
                XIN LING FA MEN MALAYSIA
              </div>
            </div>
            <div className="sm:hidden">
              <div className="text-xs font-bold text-brown leading-tight">
                心灵法门
              </div>
            </div>
          </a>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map(item => (
              <a
                key={item.label}
                href={item.href}
                className="px-3 py-2 text-sm text-brown/80 hover:text-amber transition-colors rounded-lg hover:bg-gold-light/50"
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Language + mobile toggle */}
          <div className="flex items-center gap-2">
            <div className="flex bg-gold-light/60 rounded-full p-0.5">
              {languages.map(lang => (
                <button
                  key={lang}
                  onClick={() => setActiveLang(lang)}
                  className={`px-2.5 py-1 text-xs rounded-full transition-all ${
                    activeLang === lang
                      ? "bg-white text-amber font-semibold shadow-sm"
                      : "text-brown/60 hover:text-brown"
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-2 text-brown/70 hover:text-amber"
              aria-label="Toggle menu"
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
        <nav className="lg:hidden border-t border-card-border bg-white px-4 pb-4">
          {navItems.map(item => (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className="block py-3 text-brown/80 hover:text-amber border-b border-card-border/50 last:border-0"
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
