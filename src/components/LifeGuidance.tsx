const categories = [
  {
    emoji: "❤️",
    title: "感情与家庭",
    description: "婚姻不顺、夫妻矛盾、孩子叛逆、家庭不和……很多人通过念经化解了这些问题。",
    bg: "bg-gradient-to-br from-pink-50 to-rose-50",
    border: "border-pink-200/60",
    iconBg: "bg-pink-100",
    tag: "text-pink-700 bg-pink-100",
  },
  {
    emoji: "📚",
    title: "学业与事业",
    description: "考试压力、职场困境、生意不顺……佛法中有应对这些挑战的智慧和方法。",
    bg: "bg-gradient-to-br from-emerald-50 to-green-50",
    border: "border-emerald-200/60",
    iconBg: "bg-emerald-100",
    tag: "text-emerald-700 bg-emerald-100",
  },
  {
    emoji: "🏥",
    title: "健康与平安",
    description: "身体不好、久治不愈、担心家人健康……念经、放生帮助许多人重获健康。",
    bg: "bg-gradient-to-br from-amber-50 to-yellow-50",
    border: "border-amber-200/60",
    iconBg: "bg-amber-100",
    tag: "text-amber-700 bg-amber-100",
  },
  {
    emoji: "🌊",
    title: "情绪与内心",
    description: "焦虑、抑郁、失眠、想不通……修心念经可以帮助您平复情绪，找回内心的平静。",
    bg: "bg-gradient-to-br from-sky-50 to-blue-50",
    border: "border-sky-200/60",
    iconBg: "bg-sky-100",
    tag: "text-sky-700 bg-sky-100",
  },
  {
    emoji: "🔮",
    title: "因果与命运",
    description: "为什么我这么倒霉？前世今生到底怎么回事？了解因果，才能从根本上改变命运。",
    bg: "bg-gradient-to-br from-violet-50 to-purple-50",
    border: "border-violet-200/60",
    iconBg: "bg-violet-100",
    tag: "text-violet-700 bg-violet-100",
  },
];

export default function LifeGuidance() {
  return (
    <section id="guidance" className="bg-cream">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="text-center mb-12">
          <span className="text-amber text-sm tracking-wider">
            人生指引 · LIFE GUIDANCE
          </span>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-brown mt-2 mb-3">
            您遇到的问题，很多人都经历过，
            <br className="hidden sm:block" />
            也都走出来了
          </h2>
          <p className="text-brown/60 max-w-2xl mx-auto">
            选择您正在面对的困境，我们会为您提供对应的佛法指引和真实案例。
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {categories.map(cat => (
            <div
              key={cat.title}
              className={`group ${cat.bg} rounded-2xl border ${cat.border} p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer`}
            >
              <div className={`w-12 h-12 ${cat.iconBg} rounded-xl flex items-center justify-center text-2xl mb-4`}>
                {cat.emoji}
              </div>
              <h3 className="text-lg font-bold text-brown mb-2">{cat.title}</h3>
              <p className="text-brown/65 text-sm leading-relaxed mb-4">
                {cat.description}
              </p>
              <span className={`inline-flex items-center text-xs font-medium px-3 py-1 rounded-full ${cat.tag}`}>
                查看指引 →
              </span>
            </div>
          ))}

          {/* CTA card */}
          <div className="group bg-gradient-to-br from-gold-light to-gold-light/60 rounded-2xl border border-gold-banner/20 p-6 flex flex-col items-center justify-center text-center hover:shadow-lg transition-all">
            <div className="w-14 h-14 bg-gold-banner/15 rounded-full flex items-center justify-center text-3xl mb-4">
              🙏
            </div>
            <h3 className="text-lg font-bold text-brown mb-2">
              不确定属于哪种？
            </h3>
            <p className="text-brown/60 text-sm mb-4">
              没关系，直接告诉我们您的烦恼
            </p>
            <a
              href="#qa"
              className="inline-flex items-center px-5 py-2.5 bg-gradient-to-r from-gold-banner to-amber text-white text-sm font-semibold rounded-xl hover:shadow-md transition-all"
            >
              进入人生指引
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
