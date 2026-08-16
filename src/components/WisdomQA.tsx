import Link from "next/link";
import SectionEyebrow from "@/components/SectionEyebrow";

const exampleQuestions = [
  "我最近失眠很严重，念什么经好？",
  "和老公吵架，怎么化解冤结？",
  "工作不顺利，是不是有业障？",
];

const steps = [
  { numeral: "一", text: "用您自己的话说出烦恼，不需要佛学术语。" },
  { numeral: "二", text: "系统从500万字开示中找到最相关的内容。" },
  { numeral: "三", text: "获得具体的佛法指引和修行建议。" },
];

export default function WisdomQA() {
  return (
    <section id="qa" className="bg-bg">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left copy */}
          <div>
            <SectionEyebrow>智慧问答</SectionEyebrow>
            <h2 className="font-serif text-2xl sm:text-3xl lg:text-[2.4rem] font-semibold text-ink mt-6 mb-6 leading-snug tracking-wide">
              说出您的烦恼，
              <br />
              这里会帮您找到方向
            </h2>

            <p className="text-ink-body leading-loose mb-4">
              智慧问答基于卢台长41部著作、约500万字的开示内容。不用翻书、不用搜索，说出您的烦恼，系统会自动找到最相关的开示，帮您找到方向。
            </p>

            <ul className="space-y-3 my-8">
              {exampleQuestions.map(q => (
                <li key={q} className="flex items-center gap-3">
                  <span aria-hidden className="seal w-6 h-6 text-xs">
                    问
                  </span>
                  <span className="text-sm text-ink-body">{q}</span>
                </li>
              ))}
            </ul>

            <p className="text-sm text-ink-muted mb-8">
              一切完全免费，无需注册。
            </p>

            <Link
              href="/qa"
              className="btn-primary px-8 py-3 font-semibold"
            >
              进入智慧问答
            </Link>
          </div>

          {/* Right — one real exchange on paper */}
          <div className="bg-surface border border-border rounded-sm p-6 sm:p-8">
            <div className="flex items-start gap-3 mb-6">
              <span aria-hidden className="seal w-7 h-7 text-sm shrink-0 mt-0.5">
                问
              </span>
              <p className="text-ink font-medium leading-loose">
                为什么我求菩萨好像没有感应？
              </p>
            </div>

            <div className="quote-card p-5 mb-8">
              <p className="quote-card-label mb-2">师父开示</p>
              <p className="quote-card-body text-sm">
                一个人如果心静不下来，什么事情都求不到的。求菩萨的时候要完全心静，菩萨才能听到你的声音。……先好好静下心来，人放得随和一点……
              </p>
              <p className="text-xs text-label mt-3">
                来源：《玄艺综述》2015年5月23日 · 师父原话，未经修改
              </p>
            </div>

            <ol className="space-y-3 border-t border-border pt-6">
              {steps.map(step => (
                <li key={step.numeral} className="flex items-baseline gap-3">
                  <span className="font-serif text-sm text-accent-strong" aria-hidden>
                    {step.numeral}
                  </span>
                  <span className="text-sm text-ink-body leading-loose">
                    {step.text}
                  </span>
                </li>
              ))}
            </ol>

            <p className="text-xs text-ink-muted leading-loose mt-6 pt-5 border-t border-border">
              所有回答均基于卢台长的原始开示内容，我们不添加、不修改、不曲解任何内容。AI只负责帮您找到最相关的开示。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
