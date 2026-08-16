import Link from "next/link";
import SealMark from "@/components/SealMark";

// Branded 404 in the landing style (08-16 audit §2.6) — previously the raw
// Next.js default page.
export default function NotFound() {
  return (
    <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 py-24 text-center">
      <SealMark size={48} />
      <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-ink mt-8 mb-4 tracking-wide">
        找不到这个页面
      </h1>
      <p className="text-ink-muted leading-loose max-w-md mb-10">
        您要找的页面不存在，或已经移动了位置。没关系——从下面任何一个入口继续就可以。
      </p>
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <Link href="/" className="btn-sun px-8 py-3 font-semibold text-sm">
          回到首页
        </Link>
        <Link
          href="/qa"
          className="text-sm font-medium text-accent-strong hover:text-accent-deep"
        >
          进入智慧问答 →
        </Link>
      </div>
    </main>
  );
}
