// src/lib/layout.ts
// ONE shared width standard for module DATA-VIEW pages (dashboards, tables, card grids), so every
// module uses the same wrapper — no per-page drift. Data views stretch to the full window with
// comfortable gutters, capped only for ultrawide monitors. FORMS and reading pages (member/event
// forms, the hub, message thread, public /f /r /s) deliberately stay narrow and do NOT use this.
//
// Usage: <div className={`${PAGE_WIDE} space-y-4`}> … </div>  (append the page's own space-y-*).
export const PAGE_WIDE = 'max-w-[1680px] mx-auto px-4 sm:px-8 py-6';
