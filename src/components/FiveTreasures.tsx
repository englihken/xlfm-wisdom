const treasures = [
  {
    icon: (
      <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none">
        <circle cx="24" cy="24" r="20" fill="white" opacity="0.2" />
        <path d="M24 8C20 14 14 16 12 20c-2 4-1 8 3 10s8 1 9-2c1 3 5 4 9 2s5-6 3-10C34 16 28 14 24 8z" fill="white" opacity="0.9" />
      </svg>
    ),
    title: "念经",
    subtitle: "Reciting Sutras",
    description: "每天诵读经文，与菩萨沟通，获得加持力量，消除业障，化解冤结。",
  },
  {
    icon: (
      <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none">
        <circle cx="24" cy="24" r="20" fill="white" opacity="0.2" />
        <path d="M24 10l-2 6H15l6 4-2 7 5-4 5 4-2-7 6-4h-7z" fill="white" opacity="0.9" />
      </svg>
    ),
    title: "许愿",
    subtitle: "Making Vows",
    description: "向菩萨许下善愿，发心改变，用愿力推动自己走向更好的人生方向。",
  },
  {
    icon: (
      <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none">
        <circle cx="24" cy="24" r="20" fill="white" opacity="0.2" />
        <path d="M14 28c0-6 4-10 10-14 6 4 10 8 10 14 0 4-4 8-10 8s-10-4-10-8z" fill="white" opacity="0.9" />
        <circle cx="20" cy="26" r="1.5" fill="#FCBD60" />
        <circle cx="28" cy="26" r="1.5" fill="#FCBD60" />
      </svg>
    ),
    title: "放生",
    subtitle: "Life Release",
    description: "慈悲放生，救护生命，以此功德回向，消灾延寿，积累福报。",
  },
  {
    icon: (
      <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none">
        <circle cx="24" cy="24" r="20" fill="white" opacity="0.2" />
        <path d="M24 12a12 12 0 100 24 12 12 0 000-24zm0 4a8 8 0 110 16 8 8 0 010-16z" fill="white" opacity="0.9" />
        <path d="M24 18v8l5 3" stroke="#FCBD60" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    title: "大忏悔",
    subtitle: "Great Repentance",
    description: "真诚忏悔过去的过错和业障，放下执念，让心灵获得真正的清净与解脱。",
  },
  {
    icon: (
      <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none">
        <circle cx="24" cy="24" r="20" fill="white" opacity="0.2" />
        <rect x="14" y="12" width="20" height="24" rx="2" fill="white" opacity="0.9" />
        <line x1="18" y1="18" x2="30" y2="18" stroke="#FCBD60" strokeWidth="1.5" />
        <line x1="18" y1="22" x2="28" y2="22" stroke="#FCBD60" strokeWidth="1.5" />
        <line x1="18" y1="26" x2="26" y2="26" stroke="#FCBD60" strokeWidth="1.5" />
        <line x1="18" y1="30" x2="24" y2="30" stroke="#FCBD60" strokeWidth="1.5" />
      </svg>
    ),
    title: "白话佛法",
    subtitle: "Buddhism in Plain Terms",
    description: "用最通俗易懂的语言讲解佛法智慧，让您在日常生活中也能修心修行。",
  },
];

export default function FiveTreasures() {
  return (
    <section id="practice" className="bg-gold-banner relative overflow-hidden">
      {/* Pattern overlay */}
      <div className="absolute inset-0 opacity-10">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="text-center mb-14">
          <span className="text-white/80 text-sm tracking-wider">
            THE FIVE DHARMA TREASURES
          </span>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mt-2 drop-shadow-sm">
            五大法宝——改变命运的根本方法
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-5">
          {treasures.map((t, i) => (
            <div
              key={t.title}
              className="group bg-white/15 backdrop-blur-sm rounded-2xl p-5 border border-white/20 hover:bg-white/25 transition-all hover:-translate-y-1 text-center"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="flex justify-center mb-4">{t.icon}</div>
              <h3 className="text-xl font-bold text-white mb-1">{t.title}</h3>
              <p className="text-white/60 text-xs tracking-wider mb-3">
                {t.subtitle}
              </p>
              <p className="text-white/85 text-sm leading-relaxed">
                {t.description}
              </p>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <a
            href="#"
            className="inline-flex items-center justify-center px-8 py-3.5 bg-white text-gold-banner font-bold rounded-xl shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
          >
            了解五大法宝
          </a>
        </div>
      </div>
    </section>
  );
}
