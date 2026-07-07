import type { Metadata } from "next";
import { Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";
import "./globals.css";

// Base body font (2b theme). Serif is reserved for titles/dividers/quotes.
const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const notoSerifSC = Noto_Serif_SC({
  variable: "--font-noto-serif-sc",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "心灵法门马来西亚 · Xin Ling Fa Men Malaysia",
  description:
    "心灵法门以念经、许愿、放生三大法宝，帮助无数人走出困境。一切免费结缘。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${notoSansSC.variable} ${notoSerifSC.variable} antialiased`}>
      <body className="min-h-screen bg-bg text-ink-body font-sans">
        {children}
      </body>
    </html>
  );
}
