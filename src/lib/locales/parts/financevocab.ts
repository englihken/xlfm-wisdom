// i18n part: 财务 display vocabulary (channel · expense category · pledge pill)
// Shared by finance-display.ts helpers; zh stays byte-identical to the previous
// hard-coded labels (incl. （中心）, /月, /年).
const zh = {
  // ── 付款渠道 (channel labels) ────────────────────────────────────────────────
  'finvocab.channel.cash': '现金',
  'finvocab.channel.bank_transfer': '银行转账',
  'finvocab.channel.to_hq': '汇至总会',

  // ── 付款渠道 options (note: cash option reads 现金（中心）) ──────────────────
  'finvocab.channelOpt.cash': '现金（中心）',
  'finvocab.channelOpt.bank_transfer': '银行转账',
  'finvocab.channelOpt.to_hq': '汇至总会',

  // ── 支出类别 (expense category — labels + options share these) ────────────────
  'finvocab.expcat.rent': '租金',
  'finvocab.expcat.utilities': '水电',
  'finvocab.expcat.maintenance': '维护',
  'finvocab.expcat.activity': '活动',
  'finvocab.expcat.misc': '杂项',

  // ── 认捐 pill (compact) ──────────────────────────────────────────────────────
  'finvocab.pledge.waived': '已豁免',
  'finvocab.pledge.none': '未认捐',
  'finvocab.pledge.perMonth': '/月',
  'finvocab.pledge.perYear': '/年',
};

export const financeVocabPart: {
  zh: typeof zh;
  en: Record<keyof typeof zh, string>;
  id: Record<keyof typeof zh, string>;
} = {
  zh,
  en: {
    // ── 付款渠道 (channel labels) ──────────────────────────────────────────────
    'finvocab.channel.cash': 'Cash',
    'finvocab.channel.bank_transfer': 'Bank transfer',
    'finvocab.channel.to_hq': 'Remit to HQ',

    // ── 付款渠道 options ───────────────────────────────────────────────────────
    'finvocab.channelOpt.cash': 'Cash (centre)',
    'finvocab.channelOpt.bank_transfer': 'Bank transfer',
    'finvocab.channelOpt.to_hq': 'Remit to HQ',

    // ── 支出类别 (expense category) ────────────────────────────────────────────
    'finvocab.expcat.rent': 'Rent',
    'finvocab.expcat.utilities': 'Utilities',
    'finvocab.expcat.maintenance': 'Maintenance',
    'finvocab.expcat.activity': 'Activity',
    'finvocab.expcat.misc': 'Misc',

    // ── 认捐 pill (compact) ────────────────────────────────────────────────────
    'finvocab.pledge.waived': 'Waived',
    'finvocab.pledge.none': 'No pledge',
    'finvocab.pledge.perMonth': '/mo',
    'finvocab.pledge.perYear': '/yr',
  },
  id: {
    // ── 付款渠道 (channel labels) ──────────────────────────────────────────────
    'finvocab.channel.cash': 'Tunai',
    'finvocab.channel.bank_transfer': 'Transfer bank',
    'finvocab.channel.to_hq': 'Kirim ke pusat besar',

    // ── 付款渠道 options ───────────────────────────────────────────────────────
    'finvocab.channelOpt.cash': 'Tunai (pusat)',
    'finvocab.channelOpt.bank_transfer': 'Transfer bank',
    'finvocab.channelOpt.to_hq': 'Kirim ke pusat besar',

    // ── 支出类别 (expense category) ────────────────────────────────────────────
    'finvocab.expcat.rent': 'Sewa',
    'finvocab.expcat.utilities': 'Utilitas',
    'finvocab.expcat.maintenance': 'Pemeliharaan',
    'finvocab.expcat.activity': 'Kegiatan',
    'finvocab.expcat.misc': 'Lain-lain',

    // ── 认捐 pill (compact) ────────────────────────────────────────────────────
    'finvocab.pledge.waived': 'Dibebaskan',
    'finvocab.pledge.none': 'Belum berjanji',
    'finvocab.pledge.perMonth': '/bln',
    'finvocab.pledge.perYear': '/thn',
  },
};
