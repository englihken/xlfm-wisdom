import Image from "next/image";
import SectionEyebrow from "@/components/SectionEyebrow";

export default function MasterLuSection() {
  return (
    <section id="about" className="bg-bg">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          {/* Master's photo sits left — his gaze leads the reader into the
              text. The warm gold field of the photo matches the official
              site's sun-gold tone. */}
          <div className="order-2 lg:order-1">
            <Image
              src="/master-lu.png"
              alt="卢军宏台长"
              width={768}
              height={518}
              className="w-full h-auto rounded-sm border border-gold-border shadow-sm"
            />
          </div>

          <div className="order-1 lg:order-2">
            <SectionEyebrow>认识心灵法门</SectionEyebrow>

            <h2 className="font-serif text-2xl sm:text-3xl lg:text-[2.2rem] font-semibold text-ink mt-6 mb-6 leading-snug tracking-wide">
              一生无偿弘法度众，
              <br className="hidden sm:block" />
              只愿天下人离苦得乐
            </h2>

            <div className="space-y-5 text-ink-body text-base leading-loose">
              <p>
                卢军宏台长是心灵法门的创始人。他一生致力于弘扬佛法，以观世音菩萨的慈悲精神，无偿帮助全球数百万信众解决生活中的困难和烦恼。
              </p>
              <p>
                他将深奥的佛法用通俗易懂的语言讲解出来，让每个人都能听得懂、用得上、改得了命运。
              </p>
            </div>

            <p className="mt-6 text-accent-deep font-serif font-semibold tracking-wide">
              一切书籍及资料，全部免费结缘。
            </p>
          </div>
        </div>

        {/* The quote, set like a piece of calligraphy: serif, corner brackets,
            hairline attribution. */}
        <figure className="mt-14 text-center">
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
      </div>
    </section>
  );
}
