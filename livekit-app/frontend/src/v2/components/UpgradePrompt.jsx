import { Link } from 'react-router-dom';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { formatPlanPrice } from '../lib/upgradeOffers';

function CheckoutButton({ offer, planId, checkoutLoading, onCheckout, className, size = 'sm' }) {
  if (offer.canCheckout) {
    return (
      <Button
        type="button"
        size={size}
        className={className}
        disabled={checkoutLoading === planId}
        onClick={() => onCheckout(planId)}
      >
        {checkoutLoading === planId ? 'Loading…' : 'Upgrade now'}
      </Button>
    );
  }
  return (
    <Button type="button" size={size} variant="outline" className={className} asChild>
      <Link to="/v2/app/settings?section=billing">View plans</Link>
    </Button>
  );
}

/** Compact card for app sidebar — always visible on upgradable plans. */
export function UpgradeSidebarCard({ offer, checkoutLoading, onCheckout, className }) {
  if (!offer?.show) return null;
  const plan = offer.primaryPlan;
  return (
    <div
      className={cn(
        'mx-2 mb-2 rounded-lg border border-primary/25 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-3',
        className,
      )}
      data-no-translate="true"
    >
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-semibold leading-snug text-foreground">{offer.headline}</p>
          <p className="text-[11px] leading-snug text-muted-foreground">{offer.detail}</p>
          {plan && (
            <p className="text-[10px] text-muted-foreground">
              {plan.name} · {formatPlanPrice(plan.monthly_price_cents)}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5">
        <CheckoutButton
          offer={offer}
          planId={plan?.id}
          checkoutLoading={checkoutLoading}
          onCheckout={onCheckout}
          className="w-full"
        />
        {!offer.canCheckout && (
          <p className="text-[10px] text-muted-foreground">Ask an owner or admin to upgrade this workspace.</p>
        )}
      </div>
    </div>
  );
}

/** Home dashboard usage + upgrade card. */
export function UpgradeUsageCard({ offer, checkoutLoading, onCheckout, usage, currentPlan, className }) {
  if (!offer?.show && !currentPlan) return null;
  const pressure = offer?.pressure;
  const showBar = pressure && pressure.included > 0;

  return (
    <div
      className={cn('rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.07] to-transparent p-4', className)}
      data-no-translate="true"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {currentPlan?.name || 'Free'} plan
            {pressure ? (
              <span className="font-normal text-muted-foreground">
                {' '}
                · {pressure.used.toLocaleString()} / {pressure.included.toLocaleString()} min used
              </span>
            ) : null}
          </p>
          {offer?.show ? (
            <p className="text-sm text-muted-foreground">{offer.detail}</p>
          ) : (
            <p className="text-sm text-muted-foreground">You&apos;re on our top self-serve plan.</p>
          )}
        </div>
        {offer?.show && (
          <CheckoutButton
            offer={offer}
            planId={offer.primaryPlan?.id}
            checkoutLoading={checkoutLoading}
            onCheckout={onCheckout}
            size="default"
            className="shrink-0 gap-1.5"
          />
        )}
      </div>
      {showBar && (
        <div className="mt-3 space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                pressure.level === 'over' || pressure.level === 'high' ? 'bg-amber-500' : 'bg-primary',
              )}
              style={{ width: `${Math.min(100, pressure.percent)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {pressure.percent}% of included participant-minutes this month
            {pressure.level === 'over' ? ' — limit reached' : ''}
          </p>
        </div>
      )}
      {offer?.show && (
        <Link
          to="/v2/app/settings?section=billing"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Compare all plans
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

/** Quota-blocked dialog actions — direct checkout when possible. */
export function UpgradeQuotaActions({ offer, checkoutLoading, onCheckout, onDismiss }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end" data-no-translate="true">
      <Button type="button" variant="outline" onClick={onDismiss}>
        Close
      </Button>
      {offer?.canCheckout && offer.primaryPlan ? (
        <Button type="button" disabled={checkoutLoading === offer.primaryPlan.id} onClick={() => onCheckout(offer.primaryPlan.id)}>
          {checkoutLoading === offer.primaryPlan.id ? 'Loading…' : `Upgrade to ${offer.primaryPlan.name}`}
        </Button>
      ) : (
        <Button type="button" asChild>
          <Link to="/v2/app/settings?section=billing">View upgrade options</Link>
        </Button>
      )}
    </div>
  );
}
