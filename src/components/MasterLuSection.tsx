export default function MasterLuSection() {
  return (
    <section id="about" className="bg-gradient-to-b from-gold-light to-gold-light/60">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
        {/* Decorative top */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="h-px w-12 bg-amber/30" />
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-amber/60" fill="currentColor">
            <path d="M12 2L9 9H2l6 4.5L5.5 21 12 16l6.5 5L16 13.5 22 9h-7z" />
          </svg>
          <div className="h-px w-12 bg-amber/30" />
        </div>

        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-brown mb-8 leading-tight">
          一生无偿弘法度众，
          <br className="hidden sm:block" />
          只愿天下人离苦得乐
        </h2>

        <div className="space-y-5 text-brown/80 text-base sm:text-lg leading-relaxed max-w-3xl mx-auto">
          <p>
            卢军宏台长是心灵法门的创始人。他一生致力于弘扬佛法，以观世音菩萨的慈悲精神，无偿帮助全球数百万信众解决生活中的困难和烦恼。
          </p>
          <p>
            他将深奥的佛法用通俗易懂的语言讲解出来，让每个人都能听得懂、用得上、改得了命运。
          </p>
        </div>

        {/* Quote */}
        <div className="mt-10 bg-white/60 backdrop-blur-sm rounded-2xl p-6 sm:p-8 max-w-2xl mx-auto border border-gold-banner/20">
          <svg
            viewBox="0 0 24 24"
            className="w-8 h-8 text-gold-banner/40 mx-auto mb-3"
            fill="currentColor"
          >
            <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />
          </svg>
          <blockquote className="text-lg sm:text-xl text-brown font-medium italic leading-relaxed">
            台长非常非常地爱你们，希望你们每个人都要想通。
          </blockquote>
          <div className="mt-3 text-sm text-amber">—— 卢军宏台长</div>
        </div>

        <p className="mt-8 text-amber font-semibold text-base sm:text-lg">
          一切书籍及资料，全部免费结缘。
        </p>

        <a
          href="#about"
          className="inline-flex items-center justify-center mt-6 px-8 py-3.5 bg-gradient-to-r from-gold-banner to-amber text-white font-semibold rounded-xl shadow-lg shadow-gold-banner/20 hover:shadow-xl transition-all hover:-translate-y-0.5"
        >
          了解心灵法门
        </a>
      </div>
    </section>
  );
}
