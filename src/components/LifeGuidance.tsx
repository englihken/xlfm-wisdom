import SectionEyebrow from "@/components/SectionEyebrow";

const categories = [
  {
    char: "情",
    title: "感情与家庭",
    description: "婚姻不顺、夫妻矛盾、孩子叛逆、家庭不和……很多人通过念经化解了这些问题。",
  },
  {
    char: "业",
    title: "学业与事业",
    description: "考试压力、职场困境、生意不顺……佛法中有应对这些挑战的智慧和方法。",
  },
  {
    char: "安",
    title: "健康与平安",
    description: "身体不好、久治不愈、担心家人健康……念经、放生帮助许多人重获健康。",
  },
  {
    char: "心",
    title: "情绪与内心",
    description: "焦虑、抑郁、失眠、想不通……修心念经可以帮助您平复情绪，找回内心的平静。",
  },
  {
    char: "命",
    title: "因果与命运",
    description: "为什么我这么倒霉？前世今生到底怎么回事？了解因果，才能从根本上改变命运。",
  },
];

export default function LifeGuidance() {
  return (
    <section id="guidance" className="bg-surface border-y border-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="text-center mb-12">
          <SectionEyebrow>人生指引</SectionEyebrow>
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-ink mt-6 mb-4 leading-snug tracking-wide">
            您遇到的问题，很多人都经历过，
            <br className="hidden sm:block" />
            也都走出来了
          </h2>
          <p className="text-ink-muted max-w-2xl mx-auto leading-loose">
            选择您正在面对的困境，我们会为您提供对应的佛法指引和真实案例。
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {categories.map(cat => (
            <a
              key={cat.title}
              href="#qa"
              className="group flex flex-col bg-bg border border-border rounded-sm p-6 transition-colors hover:border-gold-border"
            >
              <span
                aria-hidden
                className="w-11 h-11 flex items-center justify-center bg-surface border border-gold-border rounded-[2px] font-serif text-xl font-semibold text-accent-deep mb-4"
              >
                {cat.char}
              </span>
              <h3 className="font-serif text-lg font-semibold text-ink mb-2">
                {cat.title}
              </h3>
              <p className="text-ink-body text-sm leading-loose mb-4 flex-1">
                {cat.description}
              </p>
              <span className="text-sm text-accent-strong group-hover:text-accent-deep">
                查看指引{" "}
                <span
                  aria-hidden
                  className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transform-none"
                >
                  →
                </span>
              </span>
            </a>
          ))}

          {/* The door for those who can't name their trouble */}
          <a
            href="#qa"
            className="flex flex-col items-center justify-center text-center bg-bg border border-border border-t-2 border-t-seal rounded-sm p-6 transition-colors hover:border-gold-border hover:border-t-seal"
          >
            <span
              aria-hidden
              className="seal w-11 h-11 text-xl mb-4"
            >
              问
            </span>
            <h3 className="font-serif text-lg font-semibold text-ink mb-2">
              不确定属于哪种？
            </h3>
            <p className="text-ink-muted text-sm leading-loose mb-4">
              没关系，直接告诉我们您的烦恼。
            </p>
            <span className="text-sm font-medium text-seal">进入智慧问答 →</span>
          </a>
        </div>
      </div>
    </section>
  );
}
