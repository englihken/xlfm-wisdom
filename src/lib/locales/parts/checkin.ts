// src/lib/locales/parts/checkin.ts
// i18n part: 活动签到 (event check-in, Phase 1) — the volunteer desk page and the
// attendee's personal QR block on the public status page.
// zh is the source of truth; en/id are Record<keyof typeof zh, string> so a
// missing key is a compile error.

const zh = {
  // ── 公开状态页：个人签到码 ────────────────────────────────────────────────
  'ci.qr.title': '入场签到码',
  'ci.qr.hint': '入场时请出示此码',
  'ci.qr.alt': '个人签到二维码',

  // ── 签到台：页面外壳 ──────────────────────────────────────────────────────
  'ci.title': '活动签到',
  'ci.back': '← 返回活动',
  'ci.loading': '载入中…',
  'ci.counter': '已签到 {n} / {total}',
  'ci.centre.other': '其他',
  'ci.recent.title': '最近签到',
  'ci.recent.empty': '还没有人签到。',
  'ci.undo': '取消签到',
  'ci.undo.confirm': '确定取消「{name}」的签到吗？',
  'ci.undo.done': '已取消签到',

  // ── 三种方式 ──────────────────────────────────────────────────────────────
  'ci.tab.scan': '扫码',
  'ci.tab.search': '搜索',
  'ci.tab.walkin': '新增',

  // ── 扫码 ──────────────────────────────────────────────────────────────────
  'ci.scan.start': '开始扫码',
  'ci.scan.stop': '停止',
  'ci.scan.opening': '正在打开相机…',
  'ci.scan.aim': '请对准二维码',
  'ci.scan.notOurs': '这不是本系统的签到码',
  'ci.scan.unsupported': '此浏览器不支持扫码，请改用「搜索」。',
  'ci.scan.noCamera': '无法打开相机。请允许相机权限，或改用「搜索」。',
  'ci.scan.ready': '可以扫下一位了',

  // ── 结果卡 ────────────────────────────────────────────────────────────────
  'ci.result.ok': '签到成功 ✓',
  'ci.result.already': '已签到 · {time}',
  'ci.result.notApproved': '报名状态：{status}（仍已签到）',
  'ci.result.walkin': '现场新增',

  // ── 搜索 ──────────────────────────────────────────────────────────────────
  'ci.search.placeholder': '姓名 / 电话 / 报名号',
  'ci.search.hint': '请输入至少 2 个字',
  'ci.search.empty': '找不到符合的报名。',
  'ci.search.checkin': '签到',
  'ci.search.done': '已签到',

  // ── 现场新增 ──────────────────────────────────────────────────────────────
  'ci.walkin.name': '姓名',
  'ci.walkin.phone': '电话（可选）',
  'ci.walkin.centre': '共修会（可选）',
  'ci.walkin.centreNone': '— 未选择 —',
  'ci.walkin.submit': '新增并签到',
  'ci.walkin.saving': '处理中…',
  'ci.walkin.errName': '请填写姓名',

  'ci.err.failed': '签到失败，请重试',

  // ── 活动详情页 ────────────────────────────────────────────────────────────
  'ci.detail.count': '已签到 ',
  'ci.detail.open': '签到台',
} as const;

const en: Record<keyof typeof zh, string> = {
  'ci.qr.title': 'Check-in code',
  'ci.qr.hint': 'Please show this code at the door',
  'ci.qr.alt': 'Personal check-in QR code',

  'ci.title': 'Event check-in',
  'ci.back': '← Back to event',
  'ci.loading': 'Loading…',
  'ci.counter': 'Checked in {n} / {total}',
  'ci.centre.other': 'Other',
  'ci.recent.title': 'Recent check-ins',
  'ci.recent.empty': 'Nobody has checked in yet.',
  'ci.undo': 'Undo check-in',
  'ci.undo.confirm': 'Undo the check-in for "{name}"?',
  'ci.undo.done': 'Check-in undone',

  'ci.tab.scan': 'Scan',
  'ci.tab.search': 'Search',
  'ci.tab.walkin': 'Walk-in',

  'ci.scan.start': 'Start scanning',
  'ci.scan.stop': 'Stop',
  'ci.scan.opening': 'Opening camera…',
  'ci.scan.aim': 'Point at the QR code',
  'ci.scan.notOurs': 'That is not a check-in code from this system',
  'ci.scan.unsupported': 'This browser cannot scan. Please use Search instead.',
  'ci.scan.noCamera': 'Cannot open the camera. Allow camera access, or use Search instead.',
  'ci.scan.ready': 'Ready for the next person',

  'ci.result.ok': 'Checked in ✓',
  'ci.result.already': 'Already checked in · {time}',
  'ci.result.notApproved': 'Registration status: {status} (checked in anyway)',
  'ci.result.walkin': 'Walk-in',

  'ci.search.placeholder': 'Name / phone / registration no.',
  'ci.search.hint': 'Type at least 2 characters',
  'ci.search.empty': 'No matching registration.',
  'ci.search.checkin': 'Check in',
  'ci.search.done': 'Checked in',

  'ci.walkin.name': 'Name',
  'ci.walkin.phone': 'Phone (optional)',
  'ci.walkin.centre': 'Centre (optional)',
  'ci.walkin.centreNone': '— none —',
  'ci.walkin.submit': 'Add and check in',
  'ci.walkin.saving': 'Working…',
  'ci.walkin.errName': 'Please enter a name',

  'ci.err.failed': 'Check-in failed, please try again',

  'ci.detail.count': 'Checked in ',
  'ci.detail.open': 'Check-in desk',
};

const id: Record<keyof typeof zh, string> = {
  'ci.qr.title': 'Kode check-in',
  'ci.qr.hint': 'Tunjukkan kode ini saat masuk',
  'ci.qr.alt': 'Kode QR check-in pribadi',

  'ci.title': 'Check-in acara',
  'ci.back': '← Kembali ke acara',
  'ci.loading': 'Memuat…',
  'ci.counter': 'Sudah check-in {n} / {total}',
  'ci.centre.other': 'Lainnya',
  'ci.recent.title': 'Check-in terbaru',
  'ci.recent.empty': 'Belum ada yang check-in.',
  'ci.undo': 'Batalkan check-in',
  'ci.undo.confirm': 'Batalkan check-in untuk "{name}"?',
  'ci.undo.done': 'Check-in dibatalkan',

  'ci.tab.scan': 'Pindai',
  'ci.tab.search': 'Cari',
  'ci.tab.walkin': 'Tambah',

  'ci.scan.start': 'Mulai memindai',
  'ci.scan.stop': 'Berhenti',
  'ci.scan.opening': 'Membuka kamera…',
  'ci.scan.aim': 'Arahkan ke kode QR',
  'ci.scan.notOurs': 'Ini bukan kode check-in dari sistem ini',
  'ci.scan.unsupported': 'Peramban ini tidak bisa memindai. Silakan gunakan Cari.',
  'ci.scan.noCamera': 'Tidak dapat membuka kamera. Izinkan akses kamera, atau gunakan Cari.',
  'ci.scan.ready': 'Siap untuk orang berikutnya',

  'ci.result.ok': 'Check-in berhasil ✓',
  'ci.result.already': 'Sudah check-in · {time}',
  'ci.result.notApproved': 'Status pendaftaran: {status} (tetap di-check-in)',
  'ci.result.walkin': 'Tambahan di tempat',

  'ci.search.placeholder': 'Nama / telepon / no. pendaftaran',
  'ci.search.hint': 'Ketik minimal 2 karakter',
  'ci.search.empty': 'Pendaftaran tidak ditemukan.',
  'ci.search.checkin': 'Check-in',
  'ci.search.done': 'Sudah check-in',

  'ci.walkin.name': 'Nama',
  'ci.walkin.phone': 'Telepon (opsional)',
  'ci.walkin.centre': 'Pusat (opsional)',
  'ci.walkin.centreNone': '— tidak dipilih —',
  'ci.walkin.submit': 'Tambah dan check-in',
  'ci.walkin.saving': 'Memproses…',
  'ci.walkin.errName': 'Mohon isi nama',

  'ci.err.failed': 'Check-in gagal, silakan coba lagi',

  'ci.detail.count': 'Sudah check-in ',
  'ci.detail.open': 'Meja check-in',
};

export const checkinPart: {
  zh: typeof zh;
  en: Record<keyof typeof zh, string>;
  id: Record<keyof typeof zh, string>;
} = { zh, en, id };
