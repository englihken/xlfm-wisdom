// i18n part: 收件箱 thread-status/kind chip vocabulary (src/lib/inbox.ts) + the
// 主页 (home) relative-time strings (relTime). These are shared vocab maps rather
// than a single screen, so they live in their own part. zh is byte-identical to the
// values previously hardcoded in inbox.ts / home/page.tsx.
const zh = {
  // ── inbox thread status chips ────────────────────────────────────────────────
  'inbox.status.new': '未处理',
  'inbox.status.in_progress': '处理中',
  'inbox.status.replied': '已回复',
  'inbox.status.archived': '已归档',

  // ── inbox thread kind chips ──────────────────────────────────────────────────
  'inbox.kind.form': '公开表单',
  'inbox.kind.internal': '内部往来',

  // ── 主页 relative time ───────────────────────────────────────────────────────
  'home.rel.justNow': '刚刚',
  'home.rel.minutesAgo': '{m}分钟前',
  'home.rel.hoursAgo': '{h}小时前',
  'home.rel.daysAgo': '{d}天前',
};

export const inboxVocabPart: {
  zh: typeof zh;
  en: Record<keyof typeof zh, string>;
  id: Record<keyof typeof zh, string>;
} = {
  zh,
  en: {
    // ── inbox thread status chips ──
    'inbox.status.new': 'Unhandled',
    'inbox.status.in_progress': 'In progress',
    'inbox.status.replied': 'Replied',
    'inbox.status.archived': 'Archived',

    // ── inbox thread kind chips ──
    'inbox.kind.form': 'Public form',
    'inbox.kind.internal': 'Internal',

    // ── Home relative time ──
    'home.rel.justNow': 'Just now',
    'home.rel.minutesAgo': '{m}m ago',
    'home.rel.hoursAgo': '{h}h ago',
    'home.rel.daysAgo': '{d}d ago',
  },
  id: {
    // ── inbox thread status chips ──
    'inbox.status.new': 'Belum ditangani',
    'inbox.status.in_progress': 'Sedang diproses',
    'inbox.status.replied': 'Telah dibalas',
    'inbox.status.archived': 'Diarsipkan',

    // ── inbox thread kind chips ──
    'inbox.kind.form': 'Formulir publik',
    'inbox.kind.internal': 'Internal',

    // ── Home relative time ──
    'home.rel.justNow': 'Baru saja',
    'home.rel.minutesAgo': '{m} mnt lalu',
    'home.rel.hoursAgo': '{h} jam lalu',
    'home.rel.daysAgo': '{d} hr lalu',
  },
};
