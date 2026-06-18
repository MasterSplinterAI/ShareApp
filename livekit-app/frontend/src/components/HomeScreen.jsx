import { MarketingNav } from './marketing/MarketingNav';
import { Hero } from './marketing/Hero';
import { TrustStrip } from './marketing/TrustStrip';
import { FeatureGrid } from './marketing/FeatureGrid';
import AiReports from './marketing/AiReports';
import { HowItWorks } from './marketing/HowItWorks';
import { PricingTable } from './marketing/PricingTable';
import { FAQ } from './marketing/FAQ';
import { MarketingFooter } from './marketing/MarketingFooter';

export default function HomeScreen() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />
      <main>
        <Hero />
        <TrustStrip />
        <FeatureGrid />
        <AiReports />
        <HowItWorks />
        <PricingTable />
        <FAQ />
      </main>
      <MarketingFooter />
    </div>
  );
}
