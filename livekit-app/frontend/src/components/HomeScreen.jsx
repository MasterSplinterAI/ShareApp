import { MarketingNav } from './marketing/MarketingNav';
import { Hero } from './marketing/Hero';
import { TrustStrip } from './marketing/TrustStrip';
import { PlatformPillars } from './marketing/PlatformPillars';
import AiReports from './marketing/AiReports';
import { WhoItsFor } from './marketing/WhoItsFor';
import { HowItWorks } from './marketing/HowItWorks';
import { FeatureGrid } from './marketing/FeatureGrid';
import { PricingTable } from './marketing/PricingTable';
import { FAQ } from './marketing/FAQ';
import { MarketingCta } from './marketing/MarketingCta';
import { MarketingFooter } from './marketing/MarketingFooter';
import LaliaSupportLauncher from '../v2/components/LaliaSupportLauncher';

export default function HomeScreen() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />
      <main>
        <Hero />
        <TrustStrip />
        <PlatformPillars />
        <AiReports />
        <WhoItsFor />
        <HowItWorks />
        <FeatureGrid />
        <PricingTable />
        <FAQ />
        <MarketingCta />
      </main>
      <MarketingFooter />
      <LaliaSupportLauncher audience="public" />
    </div>
  );
}
