import SealMark from "@/components/SealMark";

const doors = [
  {
    label: "我想了解心灵法门",
    note: "从零开始认识这个法门",
    href: "#about",
    urgent: false,
  },
  {
    label: "开始学习修行",
    note: "三大法宝与每日功课",
    href: "#practice",
    urgent: false,
  },
  {
    label: "我现在需要帮助",
    note: "带着烦恼来，就从这里进",
    href: "#guidance",
    urgent: true,
  },
];

export default function Hero() {
  return (
    <section className="bg-bg border-b border-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20 lg:py-28">
        <div className="flex flex-col items-center gap-12 lg:flex-row-reverse lg:items-center lg:justify-between lg:gap-20">
          {/* Hanging-scroll headline — vertical, right-to-left, sealed at the
              foot of the last column as calligraphy is. */}
          <div className="flex items-end gap-4 animate-fade-in-up">
            <SealMark size={34} className="mb-1" />
            <h1 className="v-text h-[7.5em] font-serif font-semibold text-ink text-[2rem] sm:text-[2.5rem] lg:text-[3rem] tracking-[0.18em] leading-[1.6]">
              <span className="block">心有方向</span>
              <span className="block">人生就有出路</span>
            </h1>
          </div>

          {/* Copy + the three doors */}
          <div className="max-w-xl">
            <p className="font-serif text-sm tracking-[0.3em] text-label mb-6">
              观世音菩萨心灵法门 · 马来西亚
            </p>

            <p className="text-base sm:text-lg text-ink-body leading-loose mb-4">
              无论您正在经历怎样的烦恼与困境，这里都有方向。心灵法门以念经、许愿、放生三大法宝，帮助无数人走出疾病、婚姻、事业与心灵的困境——不花您一分钱。
            </p>
            <p className="text-sm text-ink-muted leading-loose mb-10">
              您不需要有任何佛学基础。很多人第一次来到这里时，只是带着一个解不开的烦恼。这就够了——有这份心，菩萨就会帮您。
            </p>

            <nav aria-label="入口" className="border-y border-border-strong divide-y divide-border">
              {doors.map(door => (
                <a
                  key={door.label}
                  href={door.href}
                  className="group flex items-baseline justify-between gap-4 py-4 px-1 transition-colors hover:bg-surface-soft"
                >
                  <span
                    className={`font-serif text-lg font-semibold ${
                      door.urgent ? "text-seal" : "text-ink"
                    }`}
                  >
                    {door.label}
                  </span>
                  <span className="flex items-baseline gap-3 text-sm text-ink-faint">
                    <span className="hidden sm:inline">{door.note}</span>
                    <span
                      aria-hidden
                      className={`transition-transform group-hover:translate-x-1 motion-reduce:transform-none ${
                        door.urgent ? "text-seal" : "text-accent-strong"
                      }`}
                    >
                      →
                    </span>
                  </span>
                </a>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </section>
  );
}
