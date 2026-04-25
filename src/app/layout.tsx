import type { Metadata } from "next";
import { Noto_Serif_SC } from "next/font/google";
import "./globals.css";

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
    <html lang="zh-CN" className={`${notoSerifSC.variable} antialiased`}>
      <body className="min-h-screen bg-cream text-brown">
        {children}
      </body>
    </html>
  );
}
