const topics = [
  "因果与人生",
  "烦恼与放下",
  "修心与改变",
  "家庭关系",
  "情绪与智慧",
];

export default function BaihuaFofa() {
  return (
    <section id="wisdom" className="bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Left */}
          <div>
            <span className="text-amber text-sm tracking-wider">
              白话佛法 · BUDDHISM IN PLAIN TERMS
            </span>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-brown mt-3 mb-6 leading-tight">
              用听得懂的话，
              <br />
              明白受用一生的道理
            </h2>

            <p className="text-brown/70 leading-relaxed mb-6">
              白话佛法是卢台长用最通俗易懂的方式讲解深奥佛理的系列著作，涵盖人生的方方面面。不需要佛学基础，每一篇都能让您有所感悟。
            </p>

            <div className="flex flex-wrap gap-2 mb-8">
              {topics.map(topic => (
                <span
                  key={topic}
                  className="px-4 py-2 bg-gold-light/70 text-amber rounded-full text-sm font-medium hover:bg-gold-light transition-colors cursor-pointer"
                >
                  {topic}
                </span>
              ))}
            </div>

            <a
              href="#"
              className="inline-flex items-center justify-center px-7 py-3.5 bg-gradient-to-r from-gold-banner to-amber text-white font-semibold rounded-xl shadow-lg shadow-gold-banner/20 hover:shadow-xl transition-all hover:-translate-y-0.5"
            >
              开始阅读白话佛法
              <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </div>

          {/* Right card */}
          <div className="bg-gradient-to-br from-gold-light/80 to-cream rounded-2xl border border-card-border p-6 sm:p-8">
            <div className="bg-white rounded-xl p-5 sm:p-6 shadow-sm border border-card-border mb-6">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-gold-banner" />
                <span className="text-xs text-amber tracking-wider">
                  精选开示
                </span>
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-brown mb-3">
                不是学道理，是学会看清自己
              </h3>
              <p className="text-brown/70 text-sm leading-relaxed">
                很多人学佛学了很久，道理讲得头头是道，但生活中还是烦恼不断。因为学佛不是学道理，而是学会用佛法的智慧来看清自己的内心，改变自己的习气。
              </p>
            </div>

            <div className="bg-white/70 rounded-xl p-5 border border-gold-banner/15">
              <svg
                viewBox="0 0 24 24"
                className="w-6 h-6 text-gold-banner/50 mb-2"
                fill="currentColor"
              >
                <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />
              </svg>
              <blockquote className="text-brown font-medium italic leading-relaxed">
                想得通就是开悟，没有烦恼就是有智慧。
              </blockquote>
              <div className="mt-2 text-xs text-amber">—— 卢军宏台长</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
