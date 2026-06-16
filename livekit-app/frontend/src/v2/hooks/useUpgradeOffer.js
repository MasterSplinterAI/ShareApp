import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Billing, v2Orgs } from '../../services/apiV2';
import { getRecommendedUpgrade } from '../lib/upgradeOffers';

export function useUpgradeOffer(me) {
  const [subscription, setSubscription] = useState(null);
  const [plans, setPlans] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(null);

  useEffect(() => {
    if (!me?.org?.id) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    Promise.all([
      v2Billing.subscription().catch(() => null),
      v2Billing.plans().catch(() => ({ plans: [] })),
      v2Orgs.me().catch(() => null),
    ])
      .then(([sub, plansRes, org]) => {
        if (cancelled) return;
        setSubscription(sub);
        setPlans(plansRes?.plans || []);
        setUsage(org?.usageThisMonth || null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [me?.org?.id]);

  const offer = useMemo(
    () => getRecommendedUpgrade({ subscription, plans, usage, role: me?.role }),
    [subscription, plans, usage, me?.role],
  );

  const startCheckout = useCallback(async (planId) => {
    const id = planId || offer.primaryPlan?.id;
    if (!id) return false;
    setCheckoutLoading(id);
    try {
      const { url } = await v2Billing.checkout(id);
      if (url) {
        window.location.href = url;
        return true;
      }
      toast.error('Checkout unavailable');
      return false;
    } catch (e) {
      toast.error(e.response?.data?.error || e.response?.data?.message || 'Checkout unavailable');
      return false;
    } finally {
      setCheckoutLoading(null);
    }
  }, [offer.primaryPlan?.id]);

  return { offer, loading, checkoutLoading, startCheckout, subscription, plans, usage };
}
