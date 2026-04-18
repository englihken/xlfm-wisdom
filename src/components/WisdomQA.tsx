import Link from "next/link";

const exampleQuestions = [
  "我最近失眠很严重，念什么经好？",
  "和老公吵架，怎么化解冤结？",
  "孩子不听话，我该怎么办？",
  "工作不顺利，是不是有业障？",
  "怎么开始念小房子？",
];

export default function WisdomQA() {
  return (
    <section id="qa" className="bg-gradient-to-b from-white to-gold-light/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Left content */}
          <div>
            <span className="text-amber text-sm tracking-wider">
              智慧问答 · AI WISDOM Q&A
            </span>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-brown mt-3 mb-6 leading-tight">
              说出您的烦恼，
              <br />
              这里会帮您找到方向
            </h2>

            <p className="text-brown/70 leading-relaxed mb-4">
              我们的智慧问答系统基于卢台长41部著作、约500万字的开示内容，用AI技术帮您从浩瀚的佛法智慧中找到最适合您情况的指引。
            </p>

            <p className="text-brown/60 text-sm leading-relaxed mb-6">
              不用翻书、不用搜索，只要说出您的烦恼，系统会自动匹配最相关的开示内容，帮您找到方向。
            </p>

            {/* Chat bubbles */}
            <div className="space-y-3 mb-8">
              {exampleQuestions.map((q, i) => (
                <div
                  key={i}
                  className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm ${
                      i % 2 === 0
                        ? "bg-gold-light border border-card-border text-brown/80 rounded-tl-sm"
                        : "bg-white border border-card-border text-brown/70 rounded-tr-sm"
                    }`}
                  >
                    {q}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 text-sm text-brown/50 mb-6">
              <svg viewBox="0 0 20 20" className="w-4 h-4 text-green-600" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
              </svg>
              一切完全免费，无需注册
            </div>

            <Link
              href="/qa"
              className="inline-flex items-center justify-center px-8 py-3.5 bg-gradient-to-r from-gold-banner to-amber text-white font-bold rounded-xl shadow-lg shadow-gold-banner/20 hover:shadow-xl transition-all hover:-translate-y-0.5"
            >
              进入智慧问答
              <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </Link>
          </div>

          {/* Right card */}
          <div className="bg-white rounded-2xl border border-card-border shadow-sm p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-gold-banner to-amber rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-brown">如何使用智慧问答？</h3>
                <p className="text-xs text-brown/50">简单三步</p>
              </div>
            </div>

            <div className="space-y-5">
              <div className="flex gap-4">
                <div className="w-8 h-8 bg-gold-light rounded-full flex items-center justify-center text-amber font-bold text-sm shrink-0">
                  1
                </div>
                <div>
                  <h4 className="font-semibold text-brown text-sm">
                    说出您的烦恼
                  </h4>
                  <p className="text-brown/60 text-sm mt-1">
                    用您自己的话描述您遇到的问题，不需要用佛学术语。
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-8 h-8 bg-gold-light rounded-full flex items-center justify-center text-amber font-bold text-sm shrink-0">
                  2
                </div>
                <div>
                  <h4 className="font-semibold text-brown text-sm">
                    AI智能匹配
                  </h4>
                  <p className="text-brown/60 text-sm mt-1">
                    系统会从500万字的开示中，找到与您最相关的内容。
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-8 h-8 bg-gold-light rounded-full flex items-center justify-center text-amber font-bold text-sm shrink-0">
                  3
                </div>
                <div>
                  <h4 className="font-semibold text-brown text-sm">
                    获得方向指引
                  </h4>
                  <p className="text-brown/60 text-sm mt-1">
                    得到具体的佛法指引和修行建议，开始改变。
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 bg-gold-light/50 rounded-xl">
              <p className="text-xs text-brown/60 leading-relaxed">
                💡 所有回答均基于卢台长的原始开示内容，我们不添加、不修改、不曲解任何内容。AI只负责帮您找到最相关的开示。
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
