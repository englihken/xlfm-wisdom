// i18n part: care console (智慧问答)
const zh = {
  // ── channels ────────────────────────────────────────────────────────────────
  'care.channelWeb': '网页',

  // ── handling status pills ─────────────────────────────────────────────────────
  'care.status.aiHandling': 'AI处理中',
  'care.status.needsHuman': '需人工',
  'care.status.volunteerHandling': '义工处理中',
  'care.status.resolved': '已完成',
  'care.status.closed': '已关闭',
  'care.aiHandlingPill': 'AI 处理中',

  // ── day-group headers ─────────────────────────────────────────────────────────
  'care.today': '今天',
  'care.yesterday': '昨天',

  // ── takeover / handback actions + notices ─────────────────────────────────────
  'care.takeover': '接手对话',
  'care.handback': '交回 AI',
  'care.takenBy': '此对话已被 {name} 接手',
  'care.anotherVolunteer': '另一位义工',
  'care.actionFailed': '操作失败，请重试',
  'care.me': '我',
  'care.volunteerLabel': '义工',

  // ── chrome: loaders, header, empty states ─────────────────────────────────────
  'care.loading': '加载中…',
  'care.moduleTitle': '人文关怀 · Care',
  'care.searchPlaceholder': '搜索姓名 / 号码 / 内容…',
  'care.filterAll': '全部',
  'care.filterMine': '我接手的',
  'care.emptyMine': '暂无接手的对话',
  'care.emptySearch': '未找到相关对话',
  'care.emptyAll': '暂无对话',
  'care.unread': '未读',
  'care.noMessage': '（无消息）',
  'care.selectConversation': '选择一个对话查看',
  'care.loadFailed': '无法加载对话',
  'care.threadEmpty': '此对话暂无消息',
  'care.contactSidebar': '联系人资料',

  // ── reply composer ────────────────────────────────────────────────────────────
  'care.replyPlaceholder': '以义工身份回复…（Enter 发送，Shift+Enter 换行）',
  'care.windowExpired': '对方已超过24小时未回复，暂时无法发送普通消息',
  'care.sendFailed': '发送失败，请重试',
  'care.sending': '发送中…',
  'care.send': '发送',

  // ── conversation gist ─────────────────────────────────────────────────────────
  'care.gistTitle': '本次对话',
  'care.gistPending': '本次对话摘要将在义工接手时或今夜自动生成',

  // ── contact profile panel ─────────────────────────────────────────────────────
  'care.anonymousVisitor': '匿名访客',
  'care.webVisitor': '网页访客',
  'care.unidentifiedVisitor': '未识别访客',
  'care.orphanNote': '此访客的浏览器未提供身份，无法建立档案。',
  'care.contactMethod': '联系方式',
  'care.practiceStage': '修行阶段',
  'care.contactProfile': '有缘人档案',
  'care.profileUpdated': '档案更新于 {time}',
  'care.volunteerNotes': '义工备注',
  'care.notesPlaceholder': '为这位联系人添加备注…',
  'care.firstContact': '首次联系：{time}',
  'care.lastActive': '最近活跃：{time}',
  'care.crisis': '危机',

  // ── shared save/status chrome ─────────────────────────────────────────────────
  'care.saved': '已保存 ✓',
  'care.none': '暂无',
  'care.saving': '保存中…',
  'care.save': '保存',
  'care.saveFailed': '保存失败，请重试',

  // ── assistant reply (shared with /qa) ─────────────────────────────────────────
  'care.sourcesTitle': '参考开示：',
  'care.masterTeaching': '师父开示',
  'care.pageSingle': '第 {page} 页',
  'care.pageRange': '第 {start}-{end} 页',
  'care.segmentCount': '({n}段)',
};

export const carePart: {
  zh: typeof zh;
  en: Record<keyof typeof zh, string>;
  id: Record<keyof typeof zh, string>;
} = {
  zh,
  en: {
    'care.channelWeb': 'Web',

    'care.status.aiHandling': 'AI handling',
    'care.status.needsHuman': 'Needs human',
    'care.status.volunteerHandling': 'Volunteer handling',
    'care.status.resolved': 'Resolved',
    'care.status.closed': 'Closed',
    'care.aiHandlingPill': 'AI handling',

    'care.today': 'Today',
    'care.yesterday': 'Yesterday',

    'care.takeover': 'Take over',
    'care.handback': 'Hand back to AI',
    'care.takenBy': 'This conversation has already been taken over by {name}',
    'care.anotherVolunteer': 'another volunteer',
    'care.actionFailed': 'Action failed. Please try again.',
    'care.me': 'Me',
    'care.volunteerLabel': 'Volunteer',

    'care.loading': 'Loading…',
    'care.moduleTitle': 'Pastoral Care · Care',
    'care.searchPlaceholder': 'Search name / number / content…',
    'care.filterAll': 'All',
    'care.filterMine': 'Mine',
    'care.emptyMine': 'No conversations you have taken over yet',
    'care.emptySearch': 'No matching conversations found',
    'care.emptyAll': 'No conversations yet',
    'care.unread': 'Unread',
    'care.noMessage': '(No messages)',
    'care.selectConversation': 'Select a conversation to view',
    'care.loadFailed': 'Unable to load conversation',
    'care.threadEmpty': 'No messages in this conversation yet',
    'care.contactSidebar': 'Contact details',

    'care.replyPlaceholder': 'Reply as a volunteer… (Enter to send, Shift+Enter for a new line)',
    'care.windowExpired':
      'The recipient has not replied in over 24 hours, so standard messages cannot be sent for now',
    'care.sendFailed': 'Failed to send. Please try again.',
    'care.sending': 'Sending…',
    'care.send': 'Send',

    'care.gistTitle': 'This conversation',
    'care.gistPending':
      'A summary of this conversation will be generated when a volunteer takes over, or tonight',

    'care.anonymousVisitor': 'Anonymous visitor',
    'care.webVisitor': 'Web visitor',
    'care.unidentifiedVisitor': 'Unidentified visitor',
    'care.orphanNote':
      'This visitor did not share an identity from their browser, so no profile can be created.',
    'care.contactMethod': 'Contact',
    'care.practiceStage': 'Practice stage',
    'care.contactProfile': 'Contact profile',
    'care.profileUpdated': 'Profile updated {time}',
    'care.volunteerNotes': 'Volunteer notes',
    'care.notesPlaceholder': 'Add a note for this contact…',
    'care.firstContact': 'First contact: {time}',
    'care.lastActive': 'Last active: {time}',
    'care.crisis': 'Crisis',

    'care.saved': 'Saved ✓',
    'care.none': 'None',
    'care.saving': 'Saving…',
    'care.save': 'Save',
    'care.saveFailed': 'Failed to save. Please try again.',

    'care.sourcesTitle': 'Reference teachings:',
    'care.masterTeaching': "Master's teaching",
    'care.pageSingle': 'p. {page}',
    'care.pageRange': 'pp. {start}-{end}',
    'care.segmentCount': '({n} excerpts)',
  },
  id: {
    'care.channelWeb': 'Web',

    'care.status.aiHandling': 'Ditangani AI',
    'care.status.needsHuman': 'Perlu bantuan manusia',
    'care.status.volunteerHandling': 'Ditangani relawan',
    'care.status.resolved': 'Selesai',
    'care.status.closed': 'Ditutup',
    'care.aiHandlingPill': 'Ditangani AI',

    'care.today': 'Hari ini',
    'care.yesterday': 'Kemarin',

    'care.takeover': 'Ambil alih',
    'care.handback': 'Kembalikan ke AI',
    'care.takenBy': 'Percakapan ini sudah diambil alih oleh {name}',
    'care.anotherVolunteer': 'relawan lain',
    'care.actionFailed': 'Tindakan gagal. Silakan coba lagi.',
    'care.me': 'Saya',
    'care.volunteerLabel': 'Relawan',

    'care.loading': 'Memuat…',
    'care.moduleTitle': 'Pendampingan Umat · Care',
    'care.searchPlaceholder': 'Cari nama / nomor / konten…',
    'care.filterAll': 'Semua',
    'care.filterMine': 'Milik saya',
    'care.emptyMine': 'Belum ada percakapan yang Anda ambil alih',
    'care.emptySearch': 'Tidak ada percakapan yang cocok',
    'care.emptyAll': 'Belum ada percakapan',
    'care.unread': 'Belum dibaca',
    'care.noMessage': '(Tidak ada pesan)',
    'care.selectConversation': 'Pilih percakapan untuk dilihat',
    'care.loadFailed': 'Tidak dapat memuat percakapan',
    'care.threadEmpty': 'Belum ada pesan dalam percakapan ini',
    'care.contactSidebar': 'Data kontak',

    'care.replyPlaceholder':
      'Balas sebagai relawan… (Enter untuk mengirim, Shift+Enter untuk baris baru)',
    'care.windowExpired':
      'Penerima belum membalas lebih dari 24 jam, sehingga pesan biasa belum dapat dikirim untuk saat ini',
    'care.sendFailed': 'Gagal mengirim. Silakan coba lagi.',
    'care.sending': 'Mengirim…',
    'care.send': 'Kirim',

    'care.gistTitle': 'Percakapan ini',
    'care.gistPending':
      'Ringkasan percakapan ini akan dibuat saat relawan mengambil alih, atau malam ini',

    'care.anonymousVisitor': 'Pengunjung anonim',
    'care.webVisitor': 'Pengunjung web',
    'care.unidentifiedVisitor': 'Pengunjung tak dikenal',
    'care.orphanNote':
      'Pengunjung ini tidak membagikan identitas dari perambannya, sehingga profil tidak dapat dibuat.',
    'care.contactMethod': 'Kontak',
    'care.practiceStage': 'Tahap latihan',
    'care.contactProfile': 'Profil umat',
    'care.profileUpdated': 'Profil diperbarui {time}',
    'care.volunteerNotes': 'Catatan relawan',
    'care.notesPlaceholder': 'Tambahkan catatan untuk kontak ini…',
    'care.firstContact': 'Kontak pertama: {time}',
    'care.lastActive': 'Terakhir aktif: {time}',
    'care.crisis': 'Krisis',

    'care.saved': 'Tersimpan ✓',
    'care.none': 'Belum ada',
    'care.saving': 'Menyimpan…',
    'care.save': 'Simpan',
    'care.saveFailed': 'Gagal menyimpan. Silakan coba lagi.',

    'care.sourcesTitle': 'Rujukan ceramah:',
    'care.masterTeaching': 'Ceramah Guru',
    'care.pageSingle': 'hlm. {page}',
    'care.pageRange': 'hlm. {start}-{end}',
    'care.segmentCount': '({n} kutipan)',
  },
};
