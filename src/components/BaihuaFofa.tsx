import SectionEyebrow from "@/components/SectionEyebrow";

const topics = [
  "因果与人生",
  "烦恼与放下",
  "修心与改变",
  "家庭关系",
  "情绪与智慧",
];

export default function BaihuaFofa() {
  return (
    <section id="wisdom" className="bg-bg">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left copy */}
          <div>
            <SectionEyebrow>白话佛法</SectionEyebrow>
            <h2 className="font-serif text-2xl sm:text-3xl lg:text-[2.4rem] font-semibold text-ink mt-6 mb-6 leading-snug tracking-wide">
              用听得懂的话，
              <br />
              明白受用一生的道理
            </h2>

            <p className="text-ink-body leading-loose mb-8">
              白话佛法是卢台长用最通俗易懂的方式讲解深奥佛理的系列著作，涵盖人生的方方面面。不需要佛学基础，每一篇都能让您有所感悟。
            </p>

            <div className="flex flex-wrap gap-2 mb-10">
              {topics.map(topic => (
                <span
                  key={topic}
                  className="pill-gold px-4 py-1.5 rounded-full text-sm"
                >
                  {topic}
                </span>
              ))}
            </div>

            <a
              href="https://xlfm.my/read"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-sun px-7 py-3 font-semibold text-sm"
            >
              开始阅读白话佛法
            </a>
          </div>

          {/* Right — a thread-bound book cover (线装书) with its vertical
              title slip (题签), and a featured passage laid on the cover. */}
          <div className="flex justify-center lg:justify-end">
            <div className="relative w-full max-w-sm aspect-[3/4] bg-gradient-to-br from-butter to-[#F5D96E] border border-sun-deep/40 rounded-sm shadow-sm">
              {/* stitched spine holes along the right edge */}
              <div
                className="absolute right-3 top-6 bottom-6 w-px border-r border-dashed border-sun-deep/50"
                aria-hidden
              />
              {/* title slip, top-left as on a classical cover */}
              <div className="absolute top-5 left-5 bg-surface border border-sun-deep/40 rounded-[2px] px-2.5 py-4 shadow-sm">
                <span className="v-text font-serif text-xl font-semibold text-ink tracking-[0.3em]">
                  白话佛法
                </span>
              </div>

              {/* featured passage */}
              <div className="absolute left-5 right-8 bottom-6">
                <p className="quote-card-label mb-2">精选开示</p>
                <h3 className="font-serif text-lg font-semibold text-quote-ink mb-3 leading-snug">
                  不是学道理，是学会看清自己
                </h3>
                <p className="text-sm text-ink-body leading-loose mb-4">
                  学佛不是学道理，而是学会用佛法的智慧来看清自己的内心，改变自己的习气。
                </p>
                <p className="font-serif text-quote-ink leading-loose">
                  「想得通就是开悟，没有烦恼就是有智慧。」
                </p>
                <p className="text-xs text-label mt-2">—— 卢军宏台长</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
