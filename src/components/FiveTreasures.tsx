const treasures = [
  {
    numeral: "一",
    title: "念经",
    subtitle: "Reciting Sutras",
    description: "每天诵读经文，与菩萨沟通，获得加持力量，消除业障，化解冤结。",
  },
  {
    numeral: "二",
    title: "许愿",
    subtitle: "Making Vows",
    description: "向菩萨许下善愿，发心改变，用愿力推动自己走向更好的人生方向。",
  },
  {
    numeral: "三",
    title: "放生",
    subtitle: "Life Release",
    description: "慈悲放生，救护生命，以此功德回向，消灾延寿，积累福报。",
  },
  {
    numeral: "四",
    title: "大忏悔",
    subtitle: "Great Repentance",
    description: "真诚忏悔过去的过错和业障，放下执念，让心灵获得真正的清净与解脱。",
  },
  {
    numeral: "五",
    title: "白话佛法",
    subtitle: "Buddhism in Plain Terms",
    description: "用最通俗易懂的语言讲解佛法智慧，让您在日常生活中也能修心修行。",
  },
];

export default function FiveTreasures() {
  return (
    <section id="practice" className="bg-quote-bg border-y border-gold-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="text-center mb-14">
          <p className="u-label mb-3">The Five Dharma Treasures</p>
          <h2 className="font-serif text-2xl sm:text-3xl lg:text-[2.4rem] font-semibold text-quote-ink tracking-wide">
            五大法宝——改变命运的根本方法
          </h2>
        </div>

        {/* Five columns of a scroll: numeral, vertical name, plain description. */}
        <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-12">
          {treasures.map(t => (
            <li key={t.title} className="flex flex-col items-center text-center">
              <span className="font-serif text-sm text-accent-strong mb-3" aria-hidden>
                {t.numeral}
              </span>
              <span className="block w-px h-4 bg-gold-border mb-4" aria-hidden />
              <h3 className="v-text h-[5.6em] font-serif text-2xl font-semibold text-quote-ink tracking-[0.25em]">
                {t.title}
              </h3>
              <p className="u-label mt-4 mb-3 normal-case tracking-[0.14em]">
                {t.subtitle}
              </p>
              <p className="text-sm text-ink-body leading-loose max-w-[16rem]">
                {t.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
