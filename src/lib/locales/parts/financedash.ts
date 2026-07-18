// src/lib/locales/parts/financedash.ts
// 财务 v2 Phase 2 — the 仪表板 dashboard surface (centre view + HQ consolidated)
// and the 报表 finance pie. Trilingual bundle; en/id typed Record<keyof typeof zh,
// string> so a missing key is a compile error.
// Expense GROUP names are not here — they reuse cash.grp.* from the cashbook part.

const zh = {
  'fdash.tab.dashboard': '仪表板',
  'fdash.tab.overviewLegacy': '旧总览',

  'fdash.title': '财务仪表板',
  'fdash.subtitleCentre': '本中心收支概况',
  'fdash.subtitleOrg': '全国合并概况',
  'fdash.loading': '载入中…',
  'fdash.allCentres': '全国合并',
  'fdash.backToOrg': '← 返回全国合并',

  // ── KPI tiles ──────────────────────────────────────────────────────────────
  'fdash.kpi.income': '本月收入',
  'fdash.kpi.expense': '本月支出',
  'fdash.kpi.net': '本月结余',
  'fdash.kpi.balance': '现金+银行结存',
  'fdash.kpi.balanceSub': '截至今日的账户总额',
  'fdash.kpi.netSubSurplus': '收入多于支出',
  'fdash.kpi.netSubDeficit': '支出多于收入',

  // ── charts ─────────────────────────────────────────────────────────────────
  'fdash.trend.title': '近六个月收支',
  'fdash.trend.income': '收入',
  'fdash.trend.expense': '支出',
  'fdash.pie.title': '本月支出分类',
  'fdash.pie.center': '支出',
  'fdash.pie.valueHeader': '金额',
  'fdash.pie.empty': '本月还没有支出记录。',

  // ── accounts panel ─────────────────────────────────────────────────────────
  'fdash.accounts.title': '账户结存',
  'fdash.accounts.total': '合计',
  'fdash.accounts.empty': '这个中心还没有账户。',

  // ── HQ per-centre table ────────────────────────────────────────────────────
  'fdash.centres.title': '各中心本月比较',
  'fdash.centres.hint': '点击任一行可深入该中心。',
  'fdash.centres.col.centre': '中心',
  'fdash.centres.col.income': '收入',
  'fdash.centres.col.expense': '支出',
  'fdash.centres.col.net': '结余',
  'fdash.centres.col.balance': '结存',
  'fdash.centres.total': '全国合计',
  'fdash.centres.deficitTitle': '本月支出多于收入',
  'fdash.centres.empty': '本月没有中心记录。',

  'fdash.footer': '数据来自流水账（已作废的不计）。结存 = 期初余额 ＋ 收入 － 支出 ± 转账。',
  'fdash.readonly': '只读',

  // ── 报表 finance pie ───────────────────────────────────────────────────────
  'reports.ops.expensePie': '本月支出分类',
  'reports.ops.expensePieNote': '合计等于上方的本月支出。数据来自流水账（已作废的不计）。',
} as const;

const en: Record<keyof typeof zh, string> = {
  'fdash.tab.dashboard': 'Dashboard',
  'fdash.tab.overviewLegacy': 'Old overview',

  'fdash.title': 'Finance dashboard',
  'fdash.subtitleCentre': "This centre's income and expenses",
  'fdash.subtitleOrg': 'All centres combined',
  'fdash.loading': 'Loading…',
  'fdash.allCentres': 'All centres',
  'fdash.backToOrg': '← Back to all centres',

  'fdash.kpi.income': 'Income this month',
  'fdash.kpi.expense': 'Expenses this month',
  'fdash.kpi.net': 'Net this month',
  'fdash.kpi.balance': 'Cash + bank balance',
  'fdash.kpi.balanceSub': 'Total across accounts, as at today',
  'fdash.kpi.netSubSurplus': 'Income exceeds expenses',
  'fdash.kpi.netSubDeficit': 'Expenses exceed income',

  'fdash.trend.title': 'Income vs expenses, last 6 months',
  'fdash.trend.income': 'Income',
  'fdash.trend.expense': 'Expenses',
  'fdash.pie.title': 'Expenses by category this month',
  'fdash.pie.center': 'Spent',
  'fdash.pie.valueHeader': 'Amount',
  'fdash.pie.empty': 'No expenses recorded this month.',

  'fdash.accounts.title': 'Account balances',
  'fdash.accounts.total': 'Total',
  'fdash.accounts.empty': 'This centre has no accounts yet.',

  'fdash.centres.title': 'Centre comparison this month',
  'fdash.centres.hint': 'Click any row to drill into that centre.',
  'fdash.centres.col.centre': 'Centre',
  'fdash.centres.col.income': 'Income',
  'fdash.centres.col.expense': 'Expenses',
  'fdash.centres.col.net': 'Net',
  'fdash.centres.col.balance': 'Balance',
  'fdash.centres.total': 'All centres',
  'fdash.centres.deficitTitle': 'Expenses exceeded income this month',
  'fdash.centres.empty': 'No centre activity this month.',

  'fdash.footer': 'Figures come from the cash book (voided entries excluded). Balance = opening + income − expenses ± transfers.',
  'fdash.readonly': 'Read-only',

  'reports.ops.expensePie': 'Expenses by category this month',
  'reports.ops.expensePieNote': 'Totals to the expense figure above. From the cash book (voided entries excluded).',
};

const id: Record<keyof typeof zh, string> = {
  'fdash.tab.dashboard': 'Dasbor',
  'fdash.tab.overviewLegacy': 'Ikhtisar lama',

  'fdash.title': 'Dasbor keuangan',
  'fdash.subtitleCentre': 'Pemasukan dan pengeluaran pusat ini',
  'fdash.subtitleOrg': 'Gabungan seluruh pusat',
  'fdash.loading': 'Memuat…',
  'fdash.allCentres': 'Semua pusat',
  'fdash.backToOrg': '← Kembali ke semua pusat',

  'fdash.kpi.income': 'Pemasukan bulan ini',
  'fdash.kpi.expense': 'Pengeluaran bulan ini',
  'fdash.kpi.net': 'Neto bulan ini',
  'fdash.kpi.balance': 'Saldo tunai + bank',
  'fdash.kpi.balanceSub': 'Total seluruh akun, per hari ini',
  'fdash.kpi.netSubSurplus': 'Pemasukan melebihi pengeluaran',
  'fdash.kpi.netSubDeficit': 'Pengeluaran melebihi pemasukan',

  'fdash.trend.title': 'Pemasukan vs pengeluaran, 6 bulan terakhir',
  'fdash.trend.income': 'Pemasukan',
  'fdash.trend.expense': 'Pengeluaran',
  'fdash.pie.title': 'Pengeluaran per kategori bulan ini',
  'fdash.pie.center': 'Keluar',
  'fdash.pie.valueHeader': 'Jumlah',
  'fdash.pie.empty': 'Belum ada pengeluaran bulan ini.',

  'fdash.accounts.title': 'Saldo akun',
  'fdash.accounts.total': 'Total',
  'fdash.accounts.empty': 'Pusat ini belum memiliki akun.',

  'fdash.centres.title': 'Perbandingan pusat bulan ini',
  'fdash.centres.hint': 'Klik baris mana pun untuk masuk ke pusat tersebut.',
  'fdash.centres.col.centre': 'Pusat',
  'fdash.centres.col.income': 'Pemasukan',
  'fdash.centres.col.expense': 'Pengeluaran',
  'fdash.centres.col.net': 'Neto',
  'fdash.centres.col.balance': 'Saldo',
  'fdash.centres.total': 'Seluruh pusat',
  'fdash.centres.deficitTitle': 'Pengeluaran melebihi pemasukan bulan ini',
  'fdash.centres.empty': 'Tidak ada aktivitas pusat bulan ini.',

  'fdash.footer': 'Angka berasal dari buku kas (yang dibatalkan tidak dihitung). Saldo = saldo awal + pemasukan − pengeluaran ± transfer.',
  'fdash.readonly': 'Hanya baca',

  'reports.ops.expensePie': 'Pengeluaran per kategori bulan ini',
  'reports.ops.expensePieNote': 'Totalnya sama dengan angka pengeluaran di atas. Dari buku kas (yang dibatalkan tidak dihitung).',
};

export const financeDashPart: {
  zh: typeof zh;
  en: Record<keyof typeof zh, string>;
  id: Record<keyof typeof zh, string>;
} = { zh, en, id };
