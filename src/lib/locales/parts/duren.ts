// i18n part: 渡人 outreach
const zh = {
  // ── shared chrome ───────────────────────────────────────────────────────────
  'duren.title': '🪷 渡人',
  'duren.loading': '加载中…',
  'duren.cancel': '取消',
  'duren.delete': '删除',
  'duren.close': '关闭',
  'duren.view': '查看',
  'duren.date': '日期',
  'duren.anonymous': '匿名结缘人',

  // ── workbench header ────────────────────────────────────────────────────────
  'duren.subtitle': '善缘名单 · 只记录善缘的成长',
  'duren.addGoodAffinity': '＋ 新增善缘',
  'duren.stat.newThisMonth': '本月新结缘',
  'duren.stat.chantingThisMonth': '本月开始念经',
  'duren.stat.total': '名单总数',
  'duren.stat.stale': '超过 30 天没动静',

  // ── filters / sort ──────────────────────────────────────────────────────────
  'duren.filter.allSources': '全部来源',
  'duren.filter.allStages': '全部阶段',
  'duren.filter.allCentres': '全部中心',
  'duren.searchPlaceholder': '搜索姓名 / 电话…',
  'duren.sort.stale': '最久未跟进',
  'duren.sort.recent': '最近动静',

  // ── queue table ─────────────────────────────────────────────────────────────
  'duren.emptyList': '名单里还没有符合条件的善缘。',
  'duren.col.name': '姓名',
  'duren.col.phone': '电话',
  'duren.col.source': '来源',
  'duren.col.stage': '当前阶段',
  'duren.col.centre': '中心',
  'duren.col.lastActivity': '最后动静',
  'duren.prevPage': '上一页',
  'duren.nextPage': '下一页',
  'duren.pageInfo': '{page} / {totalPages} · 共 {total}',

  // ── create modal ────────────────────────────────────────────────────────────
  'duren.create.nameRequired': '请填写姓名',
  'duren.alreadyOnList': '已在名单中',
  'duren.create.createFailed': '创建失败',
  'duren.create.openExistingCard': '打开已有渡人卡',
  'duren.field.name': '姓名（必填）',
  'duren.field.phone': '电话',
  'duren.field.source': '来源',
  'duren.opt.unfilled': '（未填）',
  'duren.field.centre': '中心',
  'duren.opt.unspecified': '（未指定）',
  'duren.field.sourceEvent': '来源活动',
  'duren.opt.none': '（不指定）',
  'duren.field.sourceNoteOptional': '来源备注（可选）',
  'duren.field.firstContactDate': '初次接触日期',
  'duren.create.creating': '创建中…',
  'duren.create.join': '加入名单',

  // ── 渡人卡 drawer ───────────────────────────────────────────────────────────
  'duren.saveFailed': '保存失败',
  'duren.recordFailed': '记录失败',
  'duren.confirmDeleteRecord': '删除这条记录？',
  'duren.deleteFailed': '删除失败',
  'duren.sourcePrefix': '来源：{source}',
  'duren.legacyStageTitle': '来自关怀模块的旧阶段字段',
  'duren.legacyChip': '旧记录 · {stage}',
  'duren.viewConversation': '查看对话 →',
  'duren.growthFootprints': '🌱 成长足迹',
  'duren.recordNextStep': '记录下一步',
  'duren.recordMilestoneBtn': '记录「{label}」',
  'duren.eventOptional': '活动（可选）',
  'duren.noteOptional': '备注（可选）',
  'duren.profile': '资料',
  'duren.field.phonePlaceholder': '可拨打/WhatsApp 的号码',
  'duren.field.sourceNote': '来源备注',
  'duren.saveProfile': '保存资料',
  'duren.memberProfile': '会员档案',
  'duren.linkedPrefix': '已关联：',
  'duren.unlink': '解除关联',
  'duren.memberSearchPlaceholder': '搜索会员姓名 / 电话…',

  // ── inbox quick panel ───────────────────────────────────────────────────────
  'duren.alreadyRecorded': '已记录过',
  'duren.recordedFlash': '已记录「{label}」🙏',
  'duren.openCard': '打开渡人卡 →',
  'duren.currentPrefix': '当前：',

  // ── bring-to-outreach button ────────────────────────────────────────────────
  'duren.addedToList': '已加入渡人名单 🪷',
  'duren.bringTitle': '加入渡人名单跟进',
  'duren.bring': '🪷 带入渡人',
};

export const durenPart: {
  zh: typeof zh;
  en: Record<keyof typeof zh, string>;
  id: Record<keyof typeof zh, string>;
} = {
  zh,
  en: {
    // ── shared chrome ─────────────────────────────────────────────────────────
    'duren.title': '🪷 Du Ren',
    'duren.loading': 'Loading…',
    'duren.cancel': 'Cancel',
    'duren.delete': 'Delete',
    'duren.close': 'Close',
    'duren.view': 'View',
    'duren.date': 'Date',
    'duren.anonymous': 'Anonymous friend',

    // ── workbench header ──────────────────────────────────────────────────────
    'duren.subtitle': 'Good affinity list · only recording their growth',
    'duren.addGoodAffinity': '＋ Add good affinity',
    'duren.stat.newThisMonth': 'New affinities this month',
    'duren.stat.chantingThisMonth': 'Started reciting sutras and mantras this month',
    'duren.stat.total': 'Total on the list',
    'duren.stat.stale': 'No activity in over 30 days',

    // ── filters / sort ────────────────────────────────────────────────────────
    'duren.filter.allSources': 'All sources',
    'duren.filter.allStages': 'All stages',
    'duren.filter.allCentres': 'All centres',
    'duren.searchPlaceholder': 'Search name / phone…',
    'duren.sort.stale': 'Longest without follow-up',
    'duren.sort.recent': 'Recent activity',

    // ── queue table ───────────────────────────────────────────────────────────
    'duren.emptyList': 'No good affinities match these filters yet.',
    'duren.col.name': 'Name',
    'duren.col.phone': 'Phone',
    'duren.col.source': 'Source',
    'duren.col.stage': 'Current stage',
    'duren.col.centre': 'Centre',
    'duren.col.lastActivity': 'Last activity',
    'duren.prevPage': 'Previous',
    'duren.nextPage': 'Next',
    'duren.pageInfo': '{page} / {totalPages} · {total} total',

    // ── create modal ──────────────────────────────────────────────────────────
    'duren.create.nameRequired': 'Please enter a name',
    'duren.alreadyOnList': 'Already on the list',
    'duren.create.createFailed': 'Could not create',
    'duren.create.openExistingCard': 'Open existing Du Ren card',
    'duren.field.name': 'Name (required)',
    'duren.field.phone': 'Phone',
    'duren.field.source': 'Source',
    'duren.opt.unfilled': '(not filled)',
    'duren.field.centre': 'Centre',
    'duren.opt.unspecified': '(unspecified)',
    'duren.field.sourceEvent': 'Source event',
    'duren.opt.none': '(none)',
    'duren.field.sourceNoteOptional': 'Source note (optional)',
    'duren.field.firstContactDate': 'First contact date',
    'duren.create.creating': 'Creating…',
    'duren.create.join': 'Add to list',

    // ── 渡人卡 drawer ─────────────────────────────────────────────────────────
    'duren.saveFailed': 'Could not save',
    'duren.recordFailed': 'Could not record',
    'duren.confirmDeleteRecord': 'Delete this record?',
    'duren.deleteFailed': 'Could not delete',
    'duren.sourcePrefix': 'Source: {source}',
    'duren.legacyStageTitle': 'Legacy stage field from the care module',
    'duren.legacyChip': 'Legacy · {stage}',
    'duren.viewConversation': 'View conversation →',
    'duren.growthFootprints': '🌱 Growth journey',
    'duren.recordNextStep': 'Record next step',
    'duren.recordMilestoneBtn': 'Record “{label}”',
    'duren.eventOptional': 'Event (optional)',
    'duren.noteOptional': 'Note (optional)',
    'duren.profile': 'Details',
    'duren.field.phonePlaceholder': 'Callable / WhatsApp number',
    'duren.field.sourceNote': 'Source note',
    'duren.saveProfile': 'Save details',
    'duren.memberProfile': 'Member profile',
    'duren.linkedPrefix': 'Linked: ',
    'duren.unlink': 'Unlink',
    'duren.memberSearchPlaceholder': 'Search member name / phone…',

    // ── inbox quick panel ─────────────────────────────────────────────────────
    'duren.alreadyRecorded': 'Already recorded',
    'duren.recordedFlash': 'Recorded “{label}” 🙏',
    'duren.openCard': 'Open Du Ren card →',
    'duren.currentPrefix': 'Current: ',

    // ── bring-to-outreach button ──────────────────────────────────────────────
    'duren.addedToList': 'Added to the Du Ren list 🪷',
    'duren.bringTitle': 'Add to the Du Ren list for follow-up',
    'duren.bring': '🪷 Bring to Du Ren',
  },
  id: {
    // ── shared chrome ─────────────────────────────────────────────────────────
    'duren.title': '🪷 Membimbing umat',
    'duren.loading': 'Memuat…',
    'duren.cancel': 'Batal',
    'duren.delete': 'Hapus',
    'duren.close': 'Tutup',
    'duren.view': 'Lihat',
    'duren.date': 'Tanggal',
    'duren.anonymous': 'Teman anonim',

    // ── workbench header ──────────────────────────────────────────────────────
    'duren.subtitle': 'Daftar jodoh baik · hanya mencatat pertumbuhan mereka',
    'duren.addGoodAffinity': '＋ Tambah jodoh baik',
    'duren.stat.newThisMonth': 'Jodoh baru bulan ini',
    'duren.stat.chantingThisMonth': 'Mulai membaca paritta bulan ini',
    'duren.stat.total': 'Total dalam daftar',
    'duren.stat.stale': 'Tidak ada aktivitas lebih dari 30 hari',

    // ── filters / sort ────────────────────────────────────────────────────────
    'duren.filter.allSources': 'Semua sumber',
    'duren.filter.allStages': 'Semua tahap',
    'duren.filter.allCentres': 'Semua pusat',
    'duren.searchPlaceholder': 'Cari nama / telepon…',
    'duren.sort.stale': 'Paling lama tanpa tindak lanjut',
    'duren.sort.recent': 'Aktivitas terbaru',

    // ── queue table ───────────────────────────────────────────────────────────
    'duren.emptyList': 'Belum ada jodoh baik yang cocok dengan filter ini.',
    'duren.col.name': 'Nama',
    'duren.col.phone': 'Telepon',
    'duren.col.source': 'Sumber',
    'duren.col.stage': 'Tahap saat ini',
    'duren.col.centre': 'Pusat',
    'duren.col.lastActivity': 'Aktivitas terakhir',
    'duren.prevPage': 'Sebelumnya',
    'duren.nextPage': 'Berikutnya',
    'duren.pageInfo': '{page} / {totalPages} · {total} total',

    // ── create modal ──────────────────────────────────────────────────────────
    'duren.create.nameRequired': 'Mohon isi nama',
    'duren.alreadyOnList': 'Sudah ada dalam daftar',
    'duren.create.createFailed': 'Gagal membuat',
    'duren.create.openExistingCard': 'Buka kartu bimbingan yang ada',
    'duren.field.name': 'Nama (wajib)',
    'duren.field.phone': 'Telepon',
    'duren.field.source': 'Sumber',
    'duren.opt.unfilled': '(belum diisi)',
    'duren.field.centre': 'Pusat',
    'duren.opt.unspecified': '(tidak ditentukan)',
    'duren.field.sourceEvent': 'Acara sumber',
    'duren.opt.none': '(tidak ada)',
    'duren.field.sourceNoteOptional': 'Catatan sumber (opsional)',
    'duren.field.firstContactDate': 'Tanggal kontak pertama',
    'duren.create.creating': 'Membuat…',
    'duren.create.join': 'Tambah ke daftar',

    // ── 渡人卡 drawer ─────────────────────────────────────────────────────────
    'duren.saveFailed': 'Gagal menyimpan',
    'duren.recordFailed': 'Gagal mencatat',
    'duren.confirmDeleteRecord': 'Hapus catatan ini?',
    'duren.deleteFailed': 'Gagal menghapus',
    'duren.sourcePrefix': 'Sumber: {source}',
    'duren.legacyStageTitle': 'Bidang tahap lama dari modul perawatan',
    'duren.legacyChip': 'Catatan lama · {stage}',
    'duren.viewConversation': 'Lihat percakapan →',
    'duren.growthFootprints': '🌱 Jejak pertumbuhan',
    'duren.recordNextStep': 'Catat langkah berikutnya',
    'duren.recordMilestoneBtn': 'Catat "{label}"',
    'duren.eventOptional': 'Acara (opsional)',
    'duren.noteOptional': 'Catatan (opsional)',
    'duren.profile': 'Data',
    'duren.field.phonePlaceholder': 'Nomor yang bisa dihubungi / WhatsApp',
    'duren.field.sourceNote': 'Catatan sumber',
    'duren.saveProfile': 'Simpan data',
    'duren.memberProfile': 'Profil anggota',
    'duren.linkedPrefix': 'Tertaut: ',
    'duren.unlink': 'Putuskan tautan',
    'duren.memberSearchPlaceholder': 'Cari nama anggota / telepon…',

    // ── inbox quick panel ─────────────────────────────────────────────────────
    'duren.alreadyRecorded': 'Sudah dicatat',
    'duren.recordedFlash': 'Tercatat "{label}" 🙏',
    'duren.openCard': 'Buka kartu bimbingan →',
    'duren.currentPrefix': 'Saat ini: ',

    // ── bring-to-outreach button ──────────────────────────────────────────────
    'duren.addedToList': 'Ditambahkan ke daftar bimbingan 🪷',
    'duren.bringTitle': 'Tambahkan ke daftar bimbingan untuk tindak lanjut',
    'duren.bring': '🪷 Bawa ke bimbingan',
  },
};
