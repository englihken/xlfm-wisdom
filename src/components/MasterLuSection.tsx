import SectionEyebrow from "@/components/SectionEyebrow";

export default function MasterLuSection() {
  return (
    <section id="about" className="bg-bg">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
        <SectionEyebrow>认识心灵法门</SectionEyebrow>

        <h2 className="font-serif text-2xl sm:text-3xl lg:text-[2.4rem] font-semibold text-ink mt-6 mb-8 leading-snug tracking-wide">
          一生无偿弘法度众，
          <br className="hidden sm:block" />
          只愿天下人离苦得乐
        </h2>

        <div className="space-y-5 text-ink-body text-base sm:text-lg leading-loose text-left sm:text-center">
          <p>
            卢军宏台长是心灵法门的创始人。他一生致力于弘扬佛法，以观世音菩萨的慈悲精神，无偿帮助全球数百万信众解决生活中的困难和烦恼。
          </p>
          <p>
            他将深奥的佛法用通俗易懂的语言讲解出来，让每个人都能听得懂、用得上、改得了命运。
          </p>
        </div>

        {/* The quote, set like a piece of calligraphy: serif, corner brackets,
            hairline attribution. */}
        <figure className="mt-14 mb-12">
          <blockquote className="font-serif text-xl sm:text-2xl text-quote-ink leading-loose">
            「台长非常非常地爱你们，
            <br className="sm:hidden" />
            希望你们每个人都要想通。」
          </blockquote>
          <figcaption className="mt-5 flex items-center justify-center gap-3 text-sm text-label">
            <span className="block w-8 h-px bg-gold-border" aria-hidden />
            卢军宏台长
            <span className="block w-8 h-px bg-gold-border" aria-hidden />
          </figcaption>
        </figure>

        <p className="text-accent-deep font-serif font-semibold text-base sm:text-lg tracking-wide">
          一切书籍及资料，全部免费结缘。
        </p>
      </div>
    </section>
  );
}
