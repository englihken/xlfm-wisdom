export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-cream via-gold-light/40 to-cream">
      {/* Decorative elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-10 left-10 w-64 h-64 bg-gold-banner/5 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-10 w-80 h-80 bg-amber/5 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20 lg:py-24">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Left content */}
          <div className="relative z-10">
            <span className="inline-block text-amber text-sm sm:text-base tracking-widest mb-4 opacity-90">
              观世音菩萨心灵法门
            </span>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-brown leading-tight mb-6">
              心有方向，
              <br />
              <span className="text-amber">人生就有出路。</span>
            </h1>

            <p className="text-base sm:text-lg text-brown/80 leading-relaxed mb-8 max-w-xl">
              无论您正在经历怎样的烦恼与困境，这里都有方向。心灵法门以念经、许愿、放生三大法宝，帮助无数人走出疾病、婚姻、事业与心灵的困境——不花您一分钱。
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <a
                href="#about"
                className="inline-flex items-center justify-center px-6 py-3.5 bg-gradient-to-r from-gold-banner to-amber text-white font-semibold rounded-xl shadow-lg shadow-gold-banner/25 hover:shadow-xl hover:shadow-gold-banner/30 transition-all hover:-translate-y-0.5"
              >
                我想了解心灵法门
              </a>
              <a
                href="#practice"
                className="inline-flex items-center justify-center px-6 py-3.5 bg-white text-amber font-semibold rounded-xl border-2 border-gold-banner/30 hover:border-gold-banner/60 transition-all hover:-translate-y-0.5"
              >
                开始学习修行
              </a>
              <a
                href="#guidance"
                className="inline-flex items-center justify-center px-6 py-3.5 bg-red-50 text-red-700 font-semibold rounded-xl border-2 border-red-200 hover:bg-red-100 transition-all hover:-translate-y-0.5"
              >
                我现在需要帮助
              </a>
            </div>

            <p className="text-sm text-brown/60 leading-relaxed max-w-lg border-l-2 border-gold-banner/30 pl-4">
              您不需要有任何佛学基础。很多人第一次来到这里时，只是带着一个解不开的烦恼。这就够了——有这份心，菩萨就会帮您。
            </p>
          </div>

          {/* Right illustration - Lotus SVG */}
          <div className="hidden lg:flex items-center justify-center">
            <div className="relative animate-float">
              <svg
                viewBox="0 0 400 400"
                className="w-80 h-80 xl:w-96 xl:h-96"
                fill="none"
              >
                {/* Glow */}
                <circle cx="200" cy="200" r="150" fill="#FCBD60" opacity="0.06" />
                <circle cx="200" cy="200" r="100" fill="#FCBD60" opacity="0.08" />

                {/* Water */}
                <ellipse cx="200" cy="310" rx="120" ry="15" fill="#D89938" opacity="0.1" />

                {/* Stem */}
                <path
                  d="M200 310 Q195 260 200 200"
                  stroke="#6B8E23"
                  strokeWidth="3"
                  fill="none"
                  opacity="0.6"
                />

                {/* Leaves */}
                <ellipse
                  cx="170"
                  cy="290"
                  rx="50"
                  ry="12"
                  fill="#6B8E23"
                  opacity="0.25"
                  transform="rotate(-10 170 290)"
                />
                <ellipse
                  cx="235"
                  cy="295"
                  rx="45"
                  ry="10"
                  fill="#6B8E23"
                  opacity="0.2"
                  transform="rotate(8 235 295)"
                />

                {/* Outer petals */}
                <path
                  d="M200 200 Q160 160 140 180 Q120 200 160 210 Q180 215 200 200Z"
                  fill="#FCBD60"
                  opacity="0.3"
                />
                <path
                  d="M200 200 Q240 160 260 180 Q280 200 240 210 Q220 215 200 200Z"
                  fill="#FCBD60"
                  opacity="0.3"
                />
                <path
                  d="M200 200 Q170 140 200 120 Q230 140 200 200Z"
                  fill="#FCBD60"
                  opacity="0.35"
                />
                <path
                  d="M200 200 Q140 180 130 200 Q140 220 200 200Z"
                  fill="#D89938"
                  opacity="0.2"
                />
                <path
                  d="M200 200 Q260 180 270 200 Q260 220 200 200Z"
                  fill="#D89938"
                  opacity="0.2"
                />

                {/* Inner petals */}
                <path
                  d="M200 200 Q175 165 185 150 Q200 140 215 150 Q225 165 200 200Z"
                  fill="#FCBD60"
                  opacity="0.5"
                />
                <path
                  d="M200 200 Q165 185 165 175 Q170 160 200 200Z"
                  fill="#D89938"
                  opacity="0.3"
                />
                <path
                  d="M200 200 Q235 185 235 175 Q230 160 200 200Z"
                  fill="#D89938"
                  opacity="0.3"
                />

                {/* Center */}
                <circle cx="200" cy="195" r="12" fill="#FCBD60" opacity="0.6" />
                <circle cx="200" cy="195" r="6" fill="#D89938" opacity="0.5" />

                {/* Light rays */}
                <line x1="200" y1="80" x2="200" y2="100" stroke="#FCBD60" strokeWidth="1" opacity="0.3" />
                <line x1="140" y1="100" x2="155" y2="115" stroke="#FCBD60" strokeWidth="1" opacity="0.2" />
                <line x1="260" y1="100" x2="245" y2="115" stroke="#FCBD60" strokeWidth="1" opacity="0.2" />
                <line x1="120" y1="140" x2="138" y2="148" stroke="#FCBD60" strokeWidth="1" opacity="0.15" />
                <line x1="280" y1="140" x2="262" y2="148" stroke="#FCBD60" strokeWidth="1" opacity="0.15" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
