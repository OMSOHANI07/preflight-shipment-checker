import { AppSection } from "@/components/AppSection";
import { Hero } from "@/components/Hero";
import { SiteNav } from "@/components/SiteNav";
import { CarriersCompare, Footer, HowItWorks, RulesGrid } from "@/components/StaticSections";
import { loadCarriers, loadRules } from "@/lib/db";

// Carriers and rules come from Neon (seeded from calculations.ts) with the constants as fallback.
export const revalidate = 3600;

export default async function Home() {
  const [{ carriers }, rules] = await Promise.all([loadCarriers(), loadRules()]);
  return (
    <>
      <SiteNav />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <AppSection />
        <RulesGrid rules={rules} />
        <CarriersCompare carriers={carriers} />
      </main>
      <Footer />
    </>
  );
}
