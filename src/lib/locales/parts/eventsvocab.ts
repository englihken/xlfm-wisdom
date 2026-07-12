// i18n part: 活动 display vocabulary (events-display.ts labels/options)
const zh = {
  // ── event type (法会/共修/佛学班/放生/兴趣班/其他) ─────────────────────────────
  'evtvocab.type.fahui': '法会',
  'evtvocab.type.gongxiu': '共修',
  'evtvocab.type.foxueban': '佛学班',
  'evtvocab.type.fangsheng': '放生',
  'evtvocab.type.xingquban': '兴趣班',
  'evtvocab.type.other': '其他',

  // ── event status (草稿/开放报名/已满额/已截止/已结束) ─────────────────────────
  'evtvocab.status.draft': '草稿',
  'evtvocab.status.open': '开放报名',
  'evtvocab.status.full': '已满额',
  'evtvocab.status.closed': '已截止',
  'evtvocab.status.completed': '已结束',

  // ── registration status (待审核/已批准/已拒绝/已取消) ────────────────────────
  'evtvocab.reg.pending': '待审核',
  'evtvocab.reg.approved': '已批准',
  'evtvocab.reg.rejected': '已拒绝',
  'evtvocab.reg.cancelled': '已取消',

  // ── payment status (未付款/已提交凭证/已核实/已豁免) ─────────────────────────
  'evtvocab.pay.unpaid': '未付款',
  'evtvocab.pay.proof_submitted': '已提交凭证',
  'evtvocab.pay.verified': '已核实',
  'evtvocab.pay.waived': '已豁免',

  // ── fee rows (报名费/餐费/住宿/机场接送/制服/结缘品·其他) ────────────────────
  'evtvocab.fee.registration': '报名费',
  'evtvocab.fee.meal': '餐费',
  'evtvocab.fee.accommodation': '住宿',
  'evtvocab.fee.transfer': '机场接送',
  'evtvocab.fee.uniform': '制服',
  'evtvocab.fee.other': '结缘品·其他',

  // ── billing basis (每人一次/每人每天/每人每晚/每件) ──────────────────────────
  'evtvocab.billing.per_person': '每人一次',
  'evtvocab.billing.per_day': '每人每天',
  'evtvocab.billing.per_night': '每人每晚',
  'evtvocab.billing.per_item': '每件',

  // ── meal billing (每餐/每天) ────────────────────────────────────────────────
  'evtvocab.mealBilling.per_item': '每餐',
  'evtvocab.mealBilling.per_day': '每天',

  // ── meal columns (早/午/晚 — kept to 1 char to fit the grid) ─────────────────
  'evtvocab.meal.breakfast': '早',
  'evtvocab.meal.lunch': '午',
  'evtvocab.meal.dinner': '晚',
};

export const eventsVocabPart: {
  zh: typeof zh;
  en: Record<keyof typeof zh, string>;
  id: Record<keyof typeof zh, string>;
} = {
  zh,
  en: {
    // ── event type ────────────────────────────────────────────────────────────
    'evtvocab.type.fahui': 'Dharma assembly',
    'evtvocab.type.gongxiu': 'Group practice',
    'evtvocab.type.foxueban': 'Dharma class',
    'evtvocab.type.fangsheng': 'Life release',
    'evtvocab.type.xingquban': 'Interest class',
    'evtvocab.type.other': 'Other',

    // ── event status ──────────────────────────────────────────────────────────
    'evtvocab.status.draft': 'Draft',
    'evtvocab.status.open': 'Open',
    'evtvocab.status.full': 'Full',
    'evtvocab.status.closed': 'Closed',
    'evtvocab.status.completed': 'Completed',

    // ── registration status ───────────────────────────────────────────────────
    'evtvocab.reg.pending': 'Pending',
    'evtvocab.reg.approved': 'Approved',
    'evtvocab.reg.rejected': 'Rejected',
    'evtvocab.reg.cancelled': 'Cancelled',

    // ── payment status ────────────────────────────────────────────────────────
    'evtvocab.pay.unpaid': 'Unpaid',
    'evtvocab.pay.proof_submitted': 'Proof submitted',
    'evtvocab.pay.verified': 'Verified',
    'evtvocab.pay.waived': 'Waived',

    // ── fee rows ──────────────────────────────────────────────────────────────
    'evtvocab.fee.registration': 'Registration fee',
    'evtvocab.fee.meal': 'Meals',
    'evtvocab.fee.accommodation': 'Accommodation',
    'evtvocab.fee.transfer': 'Airport transfer',
    'evtvocab.fee.uniform': 'Uniform',
    'evtvocab.fee.other': 'Offering item · Other',

    // ── billing basis ─────────────────────────────────────────────────────────
    'evtvocab.billing.per_person': 'Per person',
    'evtvocab.billing.per_day': 'Per person/day',
    'evtvocab.billing.per_night': 'Per person/night',
    'evtvocab.billing.per_item': 'Per item',

    // ── meal billing ──────────────────────────────────────────────────────────
    'evtvocab.mealBilling.per_item': 'Per meal',
    'evtvocab.mealBilling.per_day': 'Per day',

    // ── meal columns (B/L/D) ──────────────────────────────────────────────────
    'evtvocab.meal.breakfast': 'B',
    'evtvocab.meal.lunch': 'L',
    'evtvocab.meal.dinner': 'D',
  },
  id: {
    // ── event type ────────────────────────────────────────────────────────────
    'evtvocab.type.fahui': 'Puja bakti',
    'evtvocab.type.gongxiu': 'Kebaktian bersama',
    'evtvocab.type.foxueban': 'Kelas Dharma',
    'evtvocab.type.fangsheng': 'Pelepasan makhluk',
    'evtvocab.type.xingquban': 'Kelas minat',
    'evtvocab.type.other': 'Lainnya',

    // ── event status ──────────────────────────────────────────────────────────
    'evtvocab.status.draft': 'Draf',
    'evtvocab.status.open': 'Pendaftaran dibuka',
    'evtvocab.status.full': 'Penuh',
    'evtvocab.status.closed': 'Ditutup',
    'evtvocab.status.completed': 'Selesai',

    // ── registration status ───────────────────────────────────────────────────
    'evtvocab.reg.pending': 'Menunggu',
    'evtvocab.reg.approved': 'Disetujui',
    'evtvocab.reg.rejected': 'Ditolak',
    'evtvocab.reg.cancelled': 'Dibatalkan',

    // ── payment status ────────────────────────────────────────────────────────
    'evtvocab.pay.unpaid': 'Belum bayar',
    'evtvocab.pay.proof_submitted': 'Bukti dikirim',
    'evtvocab.pay.verified': 'Terverifikasi',
    'evtvocab.pay.waived': 'Dibebaskan',

    // ── fee rows ──────────────────────────────────────────────────────────────
    'evtvocab.fee.registration': 'Biaya pendaftaran',
    'evtvocab.fee.meal': 'Konsumsi',
    'evtvocab.fee.accommodation': 'Akomodasi',
    'evtvocab.fee.transfer': 'Antar-jemput bandara',
    'evtvocab.fee.uniform': 'Seragam',
    'evtvocab.fee.other': 'Barang jodoh Dharma · Lainnya',

    // ── billing basis ─────────────────────────────────────────────────────────
    'evtvocab.billing.per_person': 'Per orang',
    'evtvocab.billing.per_day': 'Per orang/hari',
    'evtvocab.billing.per_night': 'Per orang/malam',
    'evtvocab.billing.per_item': 'Per barang',

    // ── meal billing ──────────────────────────────────────────────────────────
    'evtvocab.mealBilling.per_item': 'Per hidangan',
    'evtvocab.mealBilling.per_day': 'Per hari',

    // ── meal columns (P/S/M) ──────────────────────────────────────────────────
    'evtvocab.meal.breakfast': 'P',
    'evtvocab.meal.lunch': 'S',
    'evtvocab.meal.dinner': 'M',
  },
};
