import Header from "@/components/Header";
import Hero from "@/components/Hero";
import MasterLuSection from "@/components/MasterLuSection";
import ThreePaths from "@/components/ThreePaths";
import FiveTreasures from "@/components/FiveTreasures";
import BaihuaFofa from "@/components/BaihuaFofa";
import LifeGuidance from "@/components/LifeGuidance";
import WisdomQA from "@/components/WisdomQA";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <MasterLuSection />
        <ThreePaths />
        <FiveTreasures />
        <BaihuaFofa />
        <LifeGuidance />
        <WisdomQA />
      </main>
      <Footer />
    </>
  );
}
