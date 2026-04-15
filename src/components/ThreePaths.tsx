const paths = [
  {
    emoji: "🙏",
    title: "我是初学者",
    description:
      "从未接触过佛法？没关系。我们会从最基本的开始，一步一步带您了解什么是心灵法门、为什么念经有用、以及如何开始您的第一次功课。",
    button: "从这里开始",
    accent: "from-amber/10 to-gold-light",
    border: "border-amber/20",
    btnStyle: "bg-amber text-white hover:bg-amber/90",
  },
  {
    emoji: "📿",
    title: "我想系统学习",
    description:
      "已经有一些了解，想要更深入？这里有完整的修行体系：从每日功课到小房子，从许愿到放生，系统化地帮您建立修行的基础。",
    button: "系统学习",
    accent: "from-gold-banner/10 to-gold-light/50",
    border: "border-gold-banner/20",
    btnStyle: "bg-gold-banner text-white hover:bg-gold-banner/90",
  },
  {
    emoji: "💛",
    title: "我现在很烦恼",
    description:
      "感情不顺？身体不好？事业受阻？心里过不去一个坎？没关系，很多人和您一样，后来都找到了出路。让我们帮您找到适合您的方法。",
    button: "寻找帮助",
    accent: "from-red-50 to-orange-50",
    border: "border-red-200/50",
    btnStyle: "bg-red-600 text-white hover:bg-red-700",
  },
];

export default function ThreePaths() {
  return (
    <section className="bg-cream">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="text-center mb-12">
          <span className="text-amber text-sm tracking-wider">
            不知道从哪里开始？
          </span>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-brown mt-2">
            选择一个适合您的入口
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {paths.map(path => (
            <div
              key={path.title}
              className={`group relative bg-gradient-to-b ${path.accent} rounded-2xl border ${path.border} p-6 sm:p-8 flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300`}
            >
              <div className="text-4xl mb-4">{path.emoji}</div>
              <h3 className="text-xl font-bold text-brown mb-3">
                {path.title}
              </h3>
              <p className="text-brown/70 leading-relaxed mb-6 flex-1">
                {path.description}
              </p>
              <a
                href="#"
                className={`inline-flex items-center justify-center px-5 py-3 ${path.btnStyle} font-semibold rounded-xl transition-all`}
              >
                {path.button}
                <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
