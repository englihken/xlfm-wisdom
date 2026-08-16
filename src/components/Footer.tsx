import SealMark from "@/components/SealMark";

// Every entry needs a real destination — 佛学词汇 had none and was removed
// rather than shipped as a dead "#" (08-16 audit §2.2).
const footerLinks = [
  {
    title: "修学入门",
    links: [
      { label: "认识心灵法门", href: "/#about" },
      { label: "三大法宝", href: "/#practice" },
      { label: "每日功课", href: "https://xlfm.my/jingwen" },
      { label: "初学者指南", href: "https://xlfm.my/jingwen" },
    ],
  },
  {
    title: "智慧学习",
    links: [
      { label: "白话佛法", href: "https://xlfm.my/read" },
      { label: "经典开示", href: "https://xlfm.my/read" },
      { label: "修行问答", href: "/qa" },
    ],
  },
  {
    title: "人生指引",
    links: [
      { label: "感情婚姻", href: "/qa" },
      { label: "健康平安", href: "/qa" },
      { label: "学业事业", href: "/qa" },
      { label: "因果命运", href: "/qa" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="bg-ink text-white/80">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <SealMark size={36} />
              <div>
                <div className="font-serif text-sm font-bold text-white leading-tight tracking-wide">
                  心灵法门马来西亚
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  XIN LING FA MEN MALAYSIA
                </div>
              </div>
            </div>
            <p className="text-white/50 text-sm leading-relaxed">
              马来西亚卢台长心灵法门共修总会
            </p>
            <p className="text-white/40 text-xs mt-3 leading-relaxed">
              Malaysia Lu Tai Zhang
              <br />
              Xin Ling Fa Men Gong Xiu Association
            </p>
          </div>

          {/* Link columns */}
          {footerLinks.map(group => (
            <div key={group.title}>
              <h3 className="font-serif text-sm font-bold text-white mb-4 tracking-wide">
                {group.title}
              </h3>
              <ul className="space-y-2.5">
                {group.links.map(link => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(link.href.startsWith("https://")
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="text-sm text-white/50 hover:text-white transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom */}
        <div className="mt-12 pt-8 border-t border-white/10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-white/40 text-center sm:text-left">
              一切免费结缘 · For Free Distribution Only · Not For Sale
            </p>
            <p className="text-xs text-white/30">
              &copy; {new Date().getFullYear()} 心灵法门马来西亚
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
