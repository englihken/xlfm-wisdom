// i18n part: 财务 — 月费台账 (ledger) + 支出记录 (expenses) bodies.
// The 财务总览 overview lives in core zh/en/id under finance.* — this part uses the
// FRESH ledger.* and expenses.* namespaces so nothing clashes on merge.
const zh = {
  // ═══ 月费台账 (ledger) ════════════════════════════════════════════════════════
  // ── header / chrome ─────────────────────────────────────────────────────────
  'ledger.title': '💰 月费台账',
  'ledger.subtitle': 'Fee Ledger',
  'ledger.loading': '加载中…',
  'ledger.cancel': '取消',
  'ledger.save': '保存',
  'ledger.saving': '保存中…',
  'ledger.processing': '处理中…',
  'ledger.close': '关闭',
  'ledger.void': '作废',
  'ledger.confirmVoid': '确认作废',

  // ── controls ────────────────────────────────────────────────────────────────
  'ledger.searchPlaceholder': '搜索姓名 / 电话…',
  'ledger.recordPayment': '＋ 记录收款',
  'ledger.exportCsv': '导出 CSV',
  'ledger.receiptBookAt': '收据簿至 № {no}',

  // ── grid ────────────────────────────────────────────────────────────────────
  'ledger.emptyCentre': '此中心暂无会员记录。',
  'ledger.col.sponsor': '赞助者',
  'ledger.col.pledge': '认捐',
  'ledger.col.paidThrough': '付至',
  'ledger.monthCol': '{m}月',
  'ledger.waiving': '豁免中',
  'ledger.waived': '豁免',
  'ledger.mark.waived': '豁',
  'ledger.footer': '单元格 hover → 收据号 / 日期 / 金额 / 录入人 · 空白格 = 未付（不是逾期——只陈述“付至”，不催缴）',

  // ── record-collection modal ─────────────────────────────────────────────────
  'ledger.modal.recordTitle': '记录收款 · {centre}',
  'ledger.field.sponsor': '赞助者',
  'ledger.field.receiptNo': '收据号 №',
  'ledger.receiptHint': '自动接续本中心号簿，可改',
  'ledger.field.paidDate': '收款日期',
  'ledger.field.amount': '金额 RM',
  'ledger.field.channel': '渠道',
  'ledger.field.coverFrom': '覆盖月份 从',
  'ledger.field.coverTo': '至',
  'ledger.field.noteOptional': '备注（可选）',
  'ledger.recordHelp': '💡 金额与月份互相独立：系统不会用金额÷认捐推月份。RM100 覆盖两个月是财政与赞助者的共识，如实记录即可。',
  'ledger.savePayment': '保存收款',
  'ledger.err.selectSponsor': '请选择赞助者',
  'ledger.err.receiptNo': '请填写收据号',
  'ledger.err.amountPositive': '金额须大于 0',
  'ledger.err.coverMonths': '请填写覆盖月份',
  'ledger.err.saveFailed': '保存失败',

  // ── pause chip / modal ──────────────────────────────────────────────────────
  'ledger.pause.chipPaused': '本月已足 · 已暂停',
  'ledger.pause.chipCollecting': '收款中',
  'ledger.pause.titlePause': '暂停本月收款',
  'ledger.pause.titleResume': '恢复本月收款',
  'ledger.pause.bodyPause': '本月中心需求已足，暂停收款。会员自查页会显示「本月已满，感恩 🙏」。这是透明化的手动开关，不是自动上限。',
  'ledger.pause.bodyResume': '恢复本月收款。',
  'ledger.pause.noteLabel': '说明（可选，透明化）',
  'ledger.pause.notePlaceholder': '如：本月已足额',
  'ledger.pause.doPause': '暂停收款',
  'ledger.pause.doResume': '恢复收款',

  // ── member picker ───────────────────────────────────────────────────────────
  'ledger.picker.noMatch': '没有匹配的赞助者',
  'ledger.picker.selected': '已选：{who}',
  'ledger.picker.hint': '在上方点选一位赞助者',

  // ── member panel ────────────────────────────────────────────────────────────
  'ledger.noPhone': '（无电话）',
  'ledger.waivedFrom': '豁免起 {date}',
  'ledger.editPledge': '认捐 / 豁免 ✏️',
  'ledger.paymentsHeading': '缴付记录（{n}）',
  'ledger.noPayments': '本年暂无缴付记录。',
  'ledger.coverRange': '覆盖 {from} → {to}',
  'ledger.voidedHeading': '已作废（保留号簿）',
  'ledger.voidedTag': '（已作废：{reason}）',

  // ── void-collection modal ───────────────────────────────────────────────────
  'ledger.voidTitle': '作废收款 №{no}',
  'ledger.voidBody': '作废保留审计痕迹（不删除）。请说明原因。',
  'ledger.err.voidReason': '请填写作废原因',
  'ledger.err.voidFailed': '作废失败',

  // ── pledge / waiver modal ───────────────────────────────────────────────────
  'ledger.pledge.title': '认捐 / 豁免 · {name}',
  'ledger.pledge.help': '认捐与豁免互相独立：豁免的会员也可保留历史认捐额。留空认捐金额 = 未认捐。',
  'ledger.pledge.amountLabel': '认捐金额 RM（留空=未认捐）',
  'ledger.pledge.periodLabel': '周期',
  'ledger.pledge.monthly': '每月',
  'ledger.pledge.yearly': '每年',
  'ledger.pledge.waivedFromLabel': '豁免起始（留空=不豁免）',
  'ledger.pledge.waiverNoteLabel': '豁免说明',
  'ledger.pledge.waiverNotePlaceholder': '如：理事会决议',
  'ledger.err.pledgeAmount': '认捐金额须大于 0，或留空表示未认捐',

  // ── CSV export ──────────────────────────────────────────────────────────────
  'ledger.csv.filename': '月费台账',
  'ledger.csv.phone': '电话',

  // ═══ 支出记录 (expenses) ═════════════════════════════════════════════════════
  // ── header / chrome ─────────────────────────────────────────────────────────
  'expenses.title': '🧾 支出记录',
  'expenses.subtitle': 'Expenses',
  'expenses.loading': '加载中…',
  'expenses.cancel': '取消',
  'expenses.save': '保存',
  'expenses.saving': '保存中…',
  'expenses.processing': '处理中…',
  'expenses.void': '作废',
  'expenses.confirmVoid': '确认作废',
  'expenses.addExpense': '＋ 记支出',
  'expenses.exportCsv': '⬇ 导出 CSV',

  // ── table ───────────────────────────────────────────────────────────────────
  'expenses.col.date': '日期',
  'expenses.col.category': '类别',
  'expenses.col.description': '说明',
  'expenses.col.amount': '金额',
  'expenses.col.enterer': '录入',
  'expenses.empty': '本月暂无支出记录。',
  'expenses.viewReceipt': '查看单据照片',
  'expenses.voidedTag': '（已作废：{reason}）',
  'expenses.monthTotal': '本月合计',
  'expenses.footer': '类别固定枚举（租金 / 水电 / 维护 / 活动 / 杂项）· 单据照片稍后接入（私有 bucket）· 无删除，错录 = 作废',

  // ── add-expense modal ───────────────────────────────────────────────────────
  'expenses.modal.title': '记支出 · {centre}',
  'expenses.field.date': '日期',
  'expenses.field.category': '类别',
  'expenses.field.description': '说明',
  'expenses.field.amount': '金额 RM',
  'expenses.field.photoOptional': '单据照片（可选）',
  'expenses.err.description': '请填写说明',
  'expenses.err.amountPositive': '金额须大于 0',
  'expenses.err.uploadFailed': '照片上传失败',
  'expenses.err.saveFailed': '保存失败',

  // ── void-expense modal ──────────────────────────────────────────────────────
  'expenses.voidTitle': '作废支出',
  'expenses.voidBody': '{cat} · {desc} · {money}。作废保留审计痕迹（不删除）。',
  'expenses.err.voidReason': '请填写作废原因',
  'expenses.err.voidFailed': '作废失败',

  // ── CSV export ──────────────────────────────────────────────────────────────
  'expenses.csv.filename': '支出',
  'expenses.csv.col.status': '状态',
  'expenses.csv.voided': '已作废：{reason}',
};

export const financePart: {
  zh: typeof zh;
  en: Record<keyof typeof zh, string>;
  id: Record<keyof typeof zh, string>;
} = {
  zh,
  en: {
    // ═══ 月费台账 (ledger) ══════════════════════════════════════════════════════
    // ── header / chrome ───────────────────────────────────────────────────────
    'ledger.title': '💰 Fee Ledger',
    'ledger.subtitle': '',
    'ledger.loading': 'Loading…',
    'ledger.cancel': 'Cancel',
    'ledger.save': 'Save',
    'ledger.saving': 'Saving…',
    'ledger.processing': 'Processing…',
    'ledger.close': 'Close',
    'ledger.void': 'Void',
    'ledger.confirmVoid': 'Confirm void',

    // ── controls ──────────────────────────────────────────────────────────────
    'ledger.searchPlaceholder': 'Search name / phone…',
    'ledger.recordPayment': '＋ Record collection',
    'ledger.exportCsv': 'Export CSV',
    'ledger.receiptBookAt': 'Receipt book at № {no}',

    // ── grid ──────────────────────────────────────────────────────────────────
    'ledger.emptyCentre': 'No member records for this centre yet.',
    'ledger.col.sponsor': 'Sponsor',
    'ledger.col.pledge': 'Pledge',
    'ledger.col.paidThrough': 'Paid through',
    'ledger.monthCol': 'M{m}',
    'ledger.waiving': 'Waived',
    'ledger.waived': 'Waived',
    'ledger.mark.waived': 'W',
    'ledger.footer': 'Hover a cell → receipt № / date / amount / entered by · a blank cell = unpaid (not overdue—we only state “paid through”, never chase)',

    // ── record-collection modal ───────────────────────────────────────────────
    'ledger.modal.recordTitle': 'Record collection · {centre}',
    'ledger.field.sponsor': 'Sponsor',
    'ledger.field.receiptNo': 'Receipt №',
    'ledger.receiptHint': 'Auto-continues this centre’s book; editable',
    'ledger.field.paidDate': 'Collection date',
    'ledger.field.amount': 'Amount RM',
    'ledger.field.channel': 'Channel',
    'ledger.field.coverFrom': 'Covers from',
    'ledger.field.coverTo': 'to',
    'ledger.field.noteOptional': 'Note (optional)',
    'ledger.recordHelp': '💡 Amount and months are independent: the system never divides amount by pledge to infer months. RM100 covering two months is an understanding between the treasurer and the sponsor—just record it as it is.',
    'ledger.savePayment': 'Save collection',
    'ledger.err.selectSponsor': 'Please select a sponsor',
    'ledger.err.receiptNo': 'Please enter the receipt №',
    'ledger.err.amountPositive': 'Amount must be greater than 0',
    'ledger.err.coverMonths': 'Please enter the months covered',
    'ledger.err.saveFailed': 'Could not save',

    // ── pause chip / modal ────────────────────────────────────────────────────
    'ledger.pause.chipPaused': 'This month met · paused',
    'ledger.pause.chipCollecting': 'Collecting',
    'ledger.pause.titlePause': 'Pause this month’s collection',
    'ledger.pause.titleResume': 'Resume this month’s collection',
    'ledger.pause.bodyPause': 'This centre’s needs for the month are met, so collection is paused. The member self-check page will show “This month is full, with gratitude 🙏”. This is a transparent manual switch, not an automatic cap.',
    'ledger.pause.bodyResume': 'Resume this month’s collection.',
    'ledger.pause.noteLabel': 'Note (optional, for transparency)',
    'ledger.pause.notePlaceholder': 'e.g. this month is fully met',
    'ledger.pause.doPause': 'Pause collection',
    'ledger.pause.doResume': 'Resume collection',

    // ── member picker ─────────────────────────────────────────────────────────
    'ledger.picker.noMatch': 'No matching sponsors',
    'ledger.picker.selected': 'Selected: {who}',
    'ledger.picker.hint': 'Pick a sponsor above',

    // ── member panel ──────────────────────────────────────────────────────────
    'ledger.noPhone': '(no phone)',
    'ledger.waivedFrom': 'Waived from {date}',
    'ledger.editPledge': 'Pledge / waiver ✏️',
    'ledger.paymentsHeading': 'Payment records ({n})',
    'ledger.noPayments': 'No payment records this year yet.',
    'ledger.coverRange': 'Covers {from} → {to}',
    'ledger.voidedHeading': 'Voided (book № kept)',
    'ledger.voidedTag': '(voided: {reason})',

    // ── void-collection modal ─────────────────────────────────────────────────
    'ledger.voidTitle': 'Void collection №{no}',
    'ledger.voidBody': 'Voiding keeps an audit trail (not deleted). Please state the reason.',
    'ledger.err.voidReason': 'Please enter a void reason',
    'ledger.err.voidFailed': 'Could not void',

    // ── pledge / waiver modal ─────────────────────────────────────────────────
    'ledger.pledge.title': 'Pledge / waiver · {name}',
    'ledger.pledge.help': 'Pledge and waiver are independent: a waived member can still keep their historical pledge amount. A blank pledge amount = no pledge.',
    'ledger.pledge.amountLabel': 'Pledge amount RM (blank = no pledge)',
    'ledger.pledge.periodLabel': 'Period',
    'ledger.pledge.monthly': 'Monthly',
    'ledger.pledge.yearly': 'Yearly',
    'ledger.pledge.waivedFromLabel': 'Waived from (blank = no waiver)',
    'ledger.pledge.waiverNoteLabel': 'Waiver note',
    'ledger.pledge.waiverNotePlaceholder': 'e.g. committee resolution',
    'ledger.err.pledgeAmount': 'Pledge amount must be greater than 0, or leave blank for no pledge',

    // ── CSV export ────────────────────────────────────────────────────────────
    'ledger.csv.filename': 'Fee Ledger',
    'ledger.csv.phone': 'Phone',

    // ═══ 支出记录 (expenses) ═══════════════════════════════════════════════════
    // ── header / chrome ───────────────────────────────────────────────────────
    'expenses.title': '🧾 Expenses',
    'expenses.subtitle': '',
    'expenses.loading': 'Loading…',
    'expenses.cancel': 'Cancel',
    'expenses.save': 'Save',
    'expenses.saving': 'Saving…',
    'expenses.processing': 'Processing…',
    'expenses.void': 'Void',
    'expenses.confirmVoid': 'Confirm void',
    'expenses.addExpense': '＋ Add expense',
    'expenses.exportCsv': '⬇ Export CSV',

    // ── table ─────────────────────────────────────────────────────────────────
    'expenses.col.date': 'Date',
    'expenses.col.category': 'Category',
    'expenses.col.description': 'Description',
    'expenses.col.amount': 'Amount',
    'expenses.col.enterer': 'Entered by',
    'expenses.empty': 'No expenses this month yet.',
    'expenses.viewReceipt': 'View receipt photo',
    'expenses.voidedTag': '(voided: {reason})',
    'expenses.monthTotal': 'Month total',
    'expenses.footer': 'Categories are a fixed set (Rent / Utilities / Maintenance / Activity / Misc) · receipt photos come later (private bucket) · no deletes, a mis-entry = void',

    // ── add-expense modal ─────────────────────────────────────────────────────
    'expenses.modal.title': 'Add expense · {centre}',
    'expenses.field.date': 'Date',
    'expenses.field.category': 'Category',
    'expenses.field.description': 'Description',
    'expenses.field.amount': 'Amount RM',
    'expenses.field.photoOptional': 'Receipt photo (optional)',
    'expenses.err.description': 'Please enter a description',
    'expenses.err.amountPositive': 'Amount must be greater than 0',
    'expenses.err.uploadFailed': 'Photo upload failed',
    'expenses.err.saveFailed': 'Could not save',

    // ── void-expense modal ────────────────────────────────────────────────────
    'expenses.voidTitle': 'Void expense',
    'expenses.voidBody': '{cat} · {desc} · {money}. Voiding keeps an audit trail (not deleted).',
    'expenses.err.voidReason': 'Please enter a void reason',
    'expenses.err.voidFailed': 'Could not void',

    // ── CSV export ────────────────────────────────────────────────────────────
    'expenses.csv.filename': 'Expenses',
    'expenses.csv.col.status': 'Status',
    'expenses.csv.voided': 'Voided: {reason}',
  },
  id: {
    // ═══ 月费台账 (ledger) ══════════════════════════════════════════════════════
    // ── header / chrome ───────────────────────────────────────────────────────
    'ledger.title': '💰 Buku Iuran Bulanan',
    'ledger.subtitle': '',
    'ledger.loading': 'Memuat…',
    'ledger.cancel': 'Batal',
    'ledger.save': 'Simpan',
    'ledger.saving': 'Menyimpan…',
    'ledger.processing': 'Memproses…',
    'ledger.close': 'Tutup',
    'ledger.void': 'Batalkan',
    'ledger.confirmVoid': 'Konfirmasi pembatalan',

    // ── controls ──────────────────────────────────────────────────────────────
    'ledger.searchPlaceholder': 'Cari nama / telepon…',
    'ledger.recordPayment': '＋ Catat penerimaan',
    'ledger.exportCsv': 'Ekspor CSV',
    'ledger.receiptBookAt': 'Buku kuitansi sampai № {no}',

    // ── grid ──────────────────────────────────────────────────────────────────
    'ledger.emptyCentre': 'Belum ada catatan anggota untuk pusat ini.',
    'ledger.col.sponsor': 'Penyokong',
    'ledger.col.pledge': 'Janji sumbangan',
    'ledger.col.paidThrough': 'Dibayar sampai',
    'ledger.monthCol': 'Bln {m}',
    'ledger.waiving': 'Dibebaskan',
    'ledger.waived': 'Dibebaskan',
    'ledger.mark.waived': 'B',
    'ledger.footer': 'Arahkan ke sel → № kuitansi / tanggal / jumlah / pencatat · sel kosong = belum dibayar (bukan tunggakan—kami hanya menyatakan “dibayar sampai”, tanpa menagih)',

    // ── record-collection modal ───────────────────────────────────────────────
    'ledger.modal.recordTitle': 'Catat penerimaan · {centre}',
    'ledger.field.sponsor': 'Penyokong',
    'ledger.field.receiptNo': 'Kuitansi №',
    'ledger.receiptHint': 'Otomatis melanjutkan buku pusat ini; bisa diubah',
    'ledger.field.paidDate': 'Tanggal penerimaan',
    'ledger.field.amount': 'Jumlah RM',
    'ledger.field.channel': 'Saluran',
    'ledger.field.coverFrom': 'Mencakup dari',
    'ledger.field.coverTo': 'sampai',
    'ledger.field.noteOptional': 'Catatan (opsional)',
    'ledger.recordHelp': '💡 Jumlah dan bulan saling independen: sistem tidak pernah membagi jumlah dengan janji untuk menghitung bulan. RM100 mencakup dua bulan adalah kesepakatan antara bendahara dan penyokong—cukup catat apa adanya.',
    'ledger.savePayment': 'Simpan penerimaan',
    'ledger.err.selectSponsor': 'Mohon pilih penyokong',
    'ledger.err.receiptNo': 'Mohon isi № kuitansi',
    'ledger.err.amountPositive': 'Jumlah harus lebih dari 0',
    'ledger.err.coverMonths': 'Mohon isi bulan yang dicakup',
    'ledger.err.saveFailed': 'Gagal menyimpan',

    // ── pause chip / modal ────────────────────────────────────────────────────
    'ledger.pause.chipPaused': 'Bulan ini cukup · dijeda',
    'ledger.pause.chipCollecting': 'Sedang menerima',
    'ledger.pause.titlePause': 'Jeda penerimaan bulan ini',
    'ledger.pause.titleResume': 'Lanjutkan penerimaan bulan ini',
    'ledger.pause.bodyPause': 'Kebutuhan pusat untuk bulan ini sudah terpenuhi, jadi penerimaan dijeda. Halaman cek mandiri anggota akan menampilkan “Bulan ini sudah penuh, terima kasih 🙏”. Ini adalah sakelar manual yang transparan, bukan batas otomatis.',
    'ledger.pause.bodyResume': 'Lanjutkan penerimaan bulan ini.',
    'ledger.pause.noteLabel': 'Catatan (opsional, demi transparansi)',
    'ledger.pause.notePlaceholder': 'mis. bulan ini sudah cukup',
    'ledger.pause.doPause': 'Jeda penerimaan',
    'ledger.pause.doResume': 'Lanjutkan penerimaan',

    // ── member picker ─────────────────────────────────────────────────────────
    'ledger.picker.noMatch': 'Tidak ada penyokong yang cocok',
    'ledger.picker.selected': 'Terpilih: {who}',
    'ledger.picker.hint': 'Pilih penyokong di atas',

    // ── member panel ──────────────────────────────────────────────────────────
    'ledger.noPhone': '(tanpa telepon)',
    'ledger.waivedFrom': 'Dibebaskan sejak {date}',
    'ledger.editPledge': 'Janji / pembebasan ✏️',
    'ledger.paymentsHeading': 'Catatan pembayaran ({n})',
    'ledger.noPayments': 'Belum ada catatan pembayaran tahun ini.',
    'ledger.coverRange': 'Mencakup {from} → {to}',
    'ledger.voidedHeading': 'Dibatalkan (№ buku disimpan)',
    'ledger.voidedTag': '(dibatalkan: {reason})',

    // ── void-collection modal ─────────────────────────────────────────────────
    'ledger.voidTitle': 'Batalkan penerimaan №{no}',
    'ledger.voidBody': 'Pembatalan menyimpan jejak audit (tidak dihapus). Mohon sebutkan alasannya.',
    'ledger.err.voidReason': 'Mohon isi alasan pembatalan',
    'ledger.err.voidFailed': 'Gagal membatalkan',

    // ── pledge / waiver modal ─────────────────────────────────────────────────
    'ledger.pledge.title': 'Janji / pembebasan · {name}',
    'ledger.pledge.help': 'Janji dan pembebasan saling independen: anggota yang dibebaskan tetap bisa menyimpan jumlah janji lamanya. Jumlah janji kosong = tanpa janji.',
    'ledger.pledge.amountLabel': 'Jumlah janji RM (kosong = tanpa janji)',
    'ledger.pledge.periodLabel': 'Periode',
    'ledger.pledge.monthly': 'Bulanan',
    'ledger.pledge.yearly': 'Tahunan',
    'ledger.pledge.waivedFromLabel': 'Dibebaskan sejak (kosong = tanpa pembebasan)',
    'ledger.pledge.waiverNoteLabel': 'Catatan pembebasan',
    'ledger.pledge.waiverNotePlaceholder': 'mis. keputusan pengurus',
    'ledger.err.pledgeAmount': 'Jumlah janji harus lebih dari 0, atau kosongkan untuk tanpa janji',

    // ── CSV export ────────────────────────────────────────────────────────────
    'ledger.csv.filename': 'Buku Iuran Bulanan',
    'ledger.csv.phone': 'Telepon',

    // ═══ 支出记录 (expenses) ═══════════════════════════════════════════════════
    // ── header / chrome ───────────────────────────────────────────────────────
    'expenses.title': '🧾 Pengeluaran',
    'expenses.subtitle': '',
    'expenses.loading': 'Memuat…',
    'expenses.cancel': 'Batal',
    'expenses.save': 'Simpan',
    'expenses.saving': 'Menyimpan…',
    'expenses.processing': 'Memproses…',
    'expenses.void': 'Batalkan',
    'expenses.confirmVoid': 'Konfirmasi pembatalan',
    'expenses.addExpense': '＋ Catat pengeluaran',
    'expenses.exportCsv': '⬇ Ekspor CSV',

    // ── table ─────────────────────────────────────────────────────────────────
    'expenses.col.date': 'Tanggal',
    'expenses.col.category': 'Kategori',
    'expenses.col.description': 'Keterangan',
    'expenses.col.amount': 'Jumlah',
    'expenses.col.enterer': 'Pencatat',
    'expenses.empty': 'Belum ada pengeluaran bulan ini.',
    'expenses.viewReceipt': 'Lihat foto kuitansi',
    'expenses.voidedTag': '(dibatalkan: {reason})',
    'expenses.monthTotal': 'Total bulan ini',
    'expenses.footer': 'Kategori adalah daftar tetap (Sewa / Utilitas / Pemeliharaan / Kegiatan / Lain-lain) · foto kuitansi menyusul (bucket privat) · tanpa hapus, salah catat = batalkan',

    // ── add-expense modal ─────────────────────────────────────────────────────
    'expenses.modal.title': 'Catat pengeluaran · {centre}',
    'expenses.field.date': 'Tanggal',
    'expenses.field.category': 'Kategori',
    'expenses.field.description': 'Keterangan',
    'expenses.field.amount': 'Jumlah RM',
    'expenses.field.photoOptional': 'Foto kuitansi (opsional)',
    'expenses.err.description': 'Mohon isi keterangan',
    'expenses.err.amountPositive': 'Jumlah harus lebih dari 0',
    'expenses.err.uploadFailed': 'Gagal mengunggah foto',
    'expenses.err.saveFailed': 'Gagal menyimpan',

    // ── void-expense modal ────────────────────────────────────────────────────
    'expenses.voidTitle': 'Batalkan pengeluaran',
    'expenses.voidBody': '{cat} · {desc} · {money}. Pembatalan menyimpan jejak audit (tidak dihapus).',
    'expenses.err.voidReason': 'Mohon isi alasan pembatalan',
    'expenses.err.voidFailed': 'Gagal membatalkan',

    // ── CSV export ────────────────────────────────────────────────────────────
    'expenses.csv.filename': 'Pengeluaran',
    'expenses.csv.col.status': 'Status',
    'expenses.csv.voided': 'Dibatalkan: {reason}',
  },
};
