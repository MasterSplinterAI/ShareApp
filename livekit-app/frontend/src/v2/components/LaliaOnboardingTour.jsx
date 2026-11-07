import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Globe,
  HelpCircle,
  Phone,
  QrCode,
  Smartphone,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

export const LALIA_TOUR_FLAG = 'lalia:run-onboarding-tour';
const TOUR_COMPLETED_KEY_PREFIX = 'lalia_onboarding_completed_v1';
const TOUR_DISMISSED_AT_PREFIX = 'lalia_onboarding_dismissed_at_v1';

function completedStorageKey(userId) {
  return userId ? `${TOUR_COMPLETED_KEY_PREFIX}:${userId}` : TOUR_COMPLETED_KEY_PREFIX;
}

function dismissedStorageKey(userId) {
  return userId ? `${TOUR_DISMISSED_AT_PREFIX}:${userId}` : TOUR_DISMISSED_AT_PREFIX;
}

export function startLaliaOnboardingTour(navigate) {
  try {
    sessionStorage.setItem(LALIA_TOUR_FLAG, '1');
  } catch {
    /* ignore */
  }
  if (typeof navigate === 'function' && window.location.pathname !== '/v2/app') {
    navigate('/v2/app');
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lalia:start-onboarding-tour'));
  }
}

const TOUR_STEPS = [
  {
    id: 'language',
    badge: 'Step 1 of 4',
    title: 'Set your spoken language once',
    Icon: Globe,
    targets: [
      '[data-tour="language-switcher-mobile"]',
      '[data-tour="language-switcher-desktop"]',
    ],
    body: (
      <div className="space-y-2.5">
        <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
          Choose your native language once. In every call or meeting, Lalia automatically translates what others say into your language—and translates your voice for them in real time.
        </p>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
          <span className="text-xs font-medium text-foreground">Your language:</span>
          <LanguageSwitcher />
        </div>
      </div>
    ),
  },
  {
    id: 'call-vs-meeting',
    badge: 'Step 2 of 4',
    title: 'Direct Call vs. Meeting Room',
    Icon: Phone,
    targets: [
      '[data-tour="quick-actions"]',
      '[data-tour="direct-call-card"]',
      '[data-tour="nav-calls-mobile"]',
      '[data-tour="nav-calls-desktop"]',
    ],
    body: (
      <div className="space-y-2.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-foreground">
          <Phone className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="text-xs font-semibold">Direct Call (Calls &amp; Contacts)</p>
            <p className="text-[11px] text-muted-foreground">
              Save someone by email and ring their phone or browser in 1 tap—just like WhatsApp or FaceTime.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2.5 rounded-lg border border-primary/25 bg-primary/10 p-2.5 text-foreground">
          <Video className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-xs font-semibold">Instant or Scheduled Meeting</p>
            <p className="text-[11px] text-muted-foreground">
              Create a room with a shareable guest link, scannable QR code, or calendar invite for 2+ people.
            </p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'browser-or-app',
    badge: 'Step 3 of 4',
    title: 'Anyone can join — web browser or app',
    Icon: Smartphone,
    targets: [
      '[data-tour="direct-call-card"]',
      '[data-tour="join-by-code"]',
      '[data-tour="nav-meetings-mobile"]',
      '[data-tour="nav-meetings-desktop"]',
    ],
    body: (
      <div className="space-y-2.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
        <p>
          People you call or invite <strong className="text-foreground">do not need to install the app first</strong>:
        </p>
        <ul className="space-y-1.5 text-xs">
          <li className="flex items-start gap-2">
            <QrCode className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              <strong className="text-foreground">Join in any browser:</strong> Guests can tap your link or scan your room&apos;s QR code on desktop or mobile Safari/Chrome.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              <strong className="text-foreground">Or get the mobile app:</strong> Installing the Lalia iOS/Android app enables native lock-screen call ringing and 1-tap add-back contacts.
            </span>
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: 'replay-and-help',
    badge: 'Step 4 of 4',
    title: 'Replay anytime & get help',
    Icon: HelpCircle,
    targets: [
      '[data-tour="tour-replay-mobile"]',
      '[data-tour="help-trigger-mobile"]',
      '[data-tour="user-menu-desktop"]',
    ],
    body: (
      <div className="space-y-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
        <p>
          You&apos;re ready to go! You can replay this <strong className="text-foreground">Quick Tour</strong> anytime from the top bar, your account menu, or <strong className="text-foreground">Settings</strong>, or tap <strong className="text-foreground">Help</strong> to ask Lalia Assistant a question.
        </p>
      </div>
    ),
  },
];

function findVisibleTarget(selectors = []) {
  if (typeof document === 'undefined') return null;
  for (const sel of selectors) {
    const nodes = document.querySelectorAll(sel);
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (
        rect.width > 8 &&
        rect.height > 8 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      ) {
        return el;
      }
    }
  }
  return null;
}

export default function LaliaOnboardingTour({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState(null);

  const userId = user?.id || '';
  const inLiveRoom = location.pathname.startsWith('/room/');

  // Check if tour should auto-run on signup or first visit
  useEffect(() => {
    if (!userId || inLiveRoom) return undefined;

    const checkShouldStart = () => {
      // Never auto-open over an active incoming call
      if (document.querySelector('[role="alertdialog"][aria-label="Incoming call"]')) {
        return;
      }
      const forced = sessionStorage.getItem(LALIA_TOUR_FLAG) === '1';
      if (forced) {
        sessionStorage.removeItem(LALIA_TOUR_FLAG);
        setStepIndex(0);
        setOpen(true);
        return;
      }

      const completed =
        localStorage.getItem(completedStorageKey(userId)) === '1' ||
        localStorage.getItem(TOUR_COMPLETED_KEY_PREFIX) === '1';
      if (completed) return;

      const dismissedAt = Number(localStorage.getItem(dismissedStorageKey(userId)) || 0);
      if (dismissedAt && Date.now() - dismissedAt < 24 * 60 * 60 * 1000) {
        return;
      }

      // Only auto-start on the main workspace home or calls page
      if (location.pathname === '/v2/app' || location.pathname === '/v2/app/calls') {
        setStepIndex(0);
        setOpen(true);
      }
    };

    const timer = setTimeout(checkShouldStart, 650);
    return () => clearTimeout(timer);
  }, [userId, inLiveRoom, location.pathname]);

  // Listen for manual "Quick Tour" replay event
  useEffect(() => {
    const onManualStart = () => {
      try {
        sessionStorage.removeItem(LALIA_TOUR_FLAG);
      } catch {
        /* ignore */
      }
      setStepIndex(0);
      setOpen(true);
    };
    window.addEventListener('lalia:start-onboarding-tour', onManualStart);
    return () => window.removeEventListener('lalia:start-onboarding-tour', onManualStart);
  }, []);

  const currentStep = TOUR_STEPS[stepIndex] || TOUR_STEPS[0];

  const updateSpotlight = useCallback(() => {
    if (!open) return;
    const el = findVisibleTarget(currentStep?.targets);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || 800;
    if (r.top < 56 || r.bottom > vh - 72) {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        /* ignore */
      }
    }
    const fresh = el.getBoundingClientRect();
    setTargetRect({
      top: fresh.top,
      left: fresh.left,
      width: fresh.width,
      height: fresh.height,
      bottom: fresh.bottom,
      right: fresh.right,
    });
  }, [open, currentStep]);

  useEffect(() => {
    if (!open) return undefined;
    updateSpotlight();
    const t = setTimeout(updateSpotlight, 280);
    window.addEventListener('resize', updateSpotlight);
    window.addEventListener('scroll', updateSpotlight, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', updateSpotlight);
      window.removeEventListener('scroll', updateSpotlight, true);
    };
  }, [open, stepIndex, location.pathname, updateSpotlight]);

  if (!open || inLiveRoom) return null;

  const markFinished = () => {
    try {
      localStorage.setItem(completedStorageKey(userId), '1');
      localStorage.setItem(TOUR_COMPLETED_KEY_PREFIX, '1');
      sessionStorage.removeItem(LALIA_TOUR_FLAG);
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  const markDismissed = () => {
    try {
      localStorage.setItem(dismissedStorageKey(userId), String(Date.now()));
      localStorage.setItem(completedStorageKey(userId), '1');
      sessionStorage.removeItem(LALIA_TOUR_FLAG);
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  const handleNext = () => {
    if (stepIndex < TOUR_STEPS.length - 1) {
      if (stepIndex === 0 && location.pathname !== '/v2/app') {
        navigate('/v2/app');
      }
      setStepIndex((i) => i + 1);
    } else {
      markFinished();
    }
  };

  const handleBack = () => {
    if (stepIndex > 0) {
      setStepIndex((i) => i - 1);
    }
  };

  const StepIcon = currentStep.Icon || Sparkles;
  const isLastStep = stepIndex === TOUR_STEPS.length - 1;

  // Compute safe popover position relative to spotlight target (or centered fallback)
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cardMaxWidth = Math.min(380, vw - 24);

  let cardStyle = {
    left: `${Math.max(12, Math.round((vw - cardMaxWidth) / 2))}px`,
    top: `${Math.max(76, Math.round(vh * 0.24))}px`,
    width: `${cardMaxWidth}px`,
  };

  if (targetRect) {
    const pad = 12;
    const spaceBelow = vh - targetRect.bottom - 88;
    const spaceAbove = targetRect.top - 72;
    const preferBelow = spaceBelow >= 250 || spaceBelow >= spaceAbove;

    const rawLeft = targetRect.left + targetRect.width / 2 - cardMaxWidth / 2;
    const clampedLeft = Math.max(12, Math.min(vw - cardMaxWidth - 12, Math.round(rawLeft)));

    if (preferBelow) {
      const top = Math.min(vh - 300, Math.max(68, Math.round(targetRect.bottom + pad)));
      cardStyle = {
        left: `${clampedLeft}px`,
        top: `${top}px`,
        width: `${cardMaxWidth}px`,
      };
    } else {
      const bottomOffset = Math.max(
        84,
        Math.min(vh - 80, Math.round(vh - targetRect.top + pad))
      );
      cardStyle = {
        left: `${clampedLeft}px`,
        bottom: `${bottomOffset}px`,
        width: `${cardMaxWidth}px`,
      };
    }
  }

  return (
    <div
      className="fixed inset-0 z-[95]"
      role="dialog"
      aria-modal="true"
      aria-label="Lalia quick tour"
      data-no-translate="true"
    >
      {/* Backdrop / Spotlight cutout */}
      {targetRect ? (
        <>
          <div
            className="fixed inset-0"
            onClick={markDismissed}
            aria-hidden="true"
          />
          <div
            className="pointer-events-none fixed rounded-xl ring-2 ring-primary transition-all duration-200"
            style={{
              top: `${Math.max(4, targetRect.top - 6)}px`,
              left: `${Math.max(4, targetRect.left - 6)}px`,
              width: `${Math.min(vw - 8, targetRect.width + 12)}px`,
              height: `${targetRect.height + 12}px`,
              boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.68)',
            }}
          />
        </>
      ) : (
        <div
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-[2px]"
          onClick={markDismissed}
          aria-hidden="true"
        />
      )}

      {/* Tooltip Card */}
      <div
        style={cardStyle}
        className="fixed z-[96] rounded-2xl border border-primary/35 bg-card p-4 text-card-foreground shadow-2xl ring-1 ring-black/10 transition-all duration-200 sm:p-5"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <StepIcon className="h-4 w-4" />
            </span>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                {currentStep.badge}
              </span>
              <h3 className="text-sm font-semibold leading-snug text-foreground sm:text-base">
                {currentStep.title}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={markDismissed}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close tour"
            title="Skip tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step progress dots */}
        <div className="mt-3 flex gap-1.5">
          {TOUR_STEPS.map((s, idx) => (
            <div
              key={s.id}
              className={`h-1 flex-1 rounded-full transition-colors ${
                idx <= stepIndex ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>

        <div className="mt-3.5">{currentStep.body}</div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
          <button
            type="button"
            onClick={markDismissed}
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Skip tour
          </button>

          <div className="flex items-center gap-1.5">
            {stepIndex > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2.5 text-xs"
                onClick={handleBack}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs font-medium"
              onClick={handleNext}
            >
              {isLastStep ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Got it
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
