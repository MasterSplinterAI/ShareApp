import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, Globe2, LogIn, Sparkles, Video } from 'lucide-react';
import toast from 'react-hot-toast';
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
import { Button } from './ui/button';
import { Input } from './ui/input';
import { isNativeApp, isStandalonePwa, parseJoinTarget } from '../lib/nativePlatform';

function NativeMobileWelcome() {
  const navigate = useNavigate();
  const [joinInput, setJoinInput] = useState('');
  const hasToken =
    typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('v2_token'));

  if (hasToken) {
    return <Navigate to="/v2/app" replace />;
  }

  const handleJoinSubmit = (e) => {
    e.preventDefault();
    const target = parseJoinTarget(joinInput);
    if (!target) {
      toast.error('Paste a meeting invite link or enter a room code');
      return;
    }
    navigate(target);
  };

  return (
    <div className="flex min-h-[100dvh] flex-col justify-between bg-background px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] text-foreground">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Globe2 className="h-5 w-5" />
          </div>
          <div>
            <span className="text-lg font-semibold tracking-tight">Lalia</span>
            <p className="text-xs text-muted-foreground">Live multilingual meetings</p>
          </div>
        </div>

        <h1 className="mt-7 text-2xl font-semibold tracking-tight sm:text-3xl">
          Meet across any language in real time
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Join a meeting from an invite link, try live AI voice translation, or sign in to host meetings.
        </p>

        <form
          onSubmit={handleJoinSubmit}
          className="mt-6 rounded-2xl border border-border/80 bg-card p-4 shadow-sm"
        >
          <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Join a meeting
          </label>
          <div className="mt-2 flex gap-2">
            <Input
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              placeholder="Invite link or room code"
              autoCapitalize="none"
              autoCorrect="off"
            />
            <Button type="submit" className="shrink-0 gap-1.5">
              <Video className="h-4 w-4" />
              Join
            </Button>
          </div>
        </form>

        <div className="mt-4 space-y-2.5">
          <Button asChild size="lg" className="w-full gap-2">
            <Link to="/v2/login">
              <LogIn className="h-4 w-4" />
              Sign in to workspace
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full gap-2">
            <Link to="/demo">
              <Sparkles className="h-4 w-4 text-primary" />
              Try live translation demo
              <ArrowRight className="ml-auto h-4 w-4 opacity-70" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="ghost" className="w-full">
            <Link to="/v2/signup">Create free account</Link>
          </Button>
        </div>
      </div>

      <div className="mx-auto mt-8 flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <Link to="/terms" className="hover:underline">
          Terms
        </Link>
        <span>·</span>
        <Link to="/privacy" className="hover:underline">
          Privacy
        </Link>
      </div>
    </div>
  );
}

export default function HomeScreen() {
  const isAppMode =
    isNativeApp() ||
    isStandalonePwa() ||
    (typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('app') === '1');

  if (isAppMode) {
    return <NativeMobileWelcome />;
  }

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
