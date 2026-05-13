import { MarketingNav } from './marketing/MarketingNav';
import { Hero } from './marketing/Hero';
import { FeatureGrid } from './marketing/FeatureGrid';
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
        <FeatureGrid />
        <HowItWorks />
        <PricingTable />
        <FAQ />
      </main>
      <MarketingFooter />
    </div>
  );
}
