import SectionEyebrow from "@/components/SectionEyebrow";

const paths = [
  {
    title: "我是初学者",
    description:
      "从未接触过佛法？没关系。我们会从最基本的开始，一步一步带您了解什么是心灵法门、为什么念经有用、以及如何开始您的第一次功课。",
    button: "从这里开始",
    urgent: false,
  },
  {
    title: "我想系统学习",
    description:
      "已经有一些了解，想要更深入？这里有完整的修行体系：从每日功课到小房子，从许愿到放生，系统化地帮您建立修行的基础。",
    button: "系统学习",
    urgent: false,
  },
  {
    title: "我现在很烦恼",
    description:
      "感情不顺？身体不好？事业受阻？心里过不去一个坎？没关系，很多人和您一样，后来都找到了出路。让我们帮您找到适合您的方法。",
    button: "寻找帮助",
    urgent: true,
  },
];

export default function ThreePaths() {
  return (
    <section className="bg-surface border-y border-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="text-center mb-12">
          <SectionEyebrow>选择您的入口</SectionEyebrow>
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-ink mt-6 tracking-wide">
            不知道从哪里开始？
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {paths.map(path => (
            <div
              key={path.title}
              className={`flex flex-col bg-bg border border-border p-6 sm:p-8 rounded-sm border-t-2 ${
                path.urgent ? "border-t-seal" : "border-t-gold-border"
              }`}
            >
              <h3
                className={`font-serif text-xl font-semibold mb-4 ${
                  path.urgent ? "text-seal" : "text-ink"
                }`}
              >
                {path.title}
              </h3>
              <p className="text-ink-body text-sm leading-loose mb-6 flex-1">
                {path.description}
              </p>
              <a
                href={path.urgent ? "#guidance" : "#practice"}
                className={`group inline-flex items-center gap-2 font-medium text-sm ${
                  path.urgent
                    ? "text-seal hover:text-seal-deep"
                    : "text-accent-strong hover:text-accent-deep"
                }`}
              >
                {path.button}
                <span
                  aria-hidden
                  className="transition-transform group-hover:translate-x-1 motion-reduce:transform-none"
                >
                  →
                </span>
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
