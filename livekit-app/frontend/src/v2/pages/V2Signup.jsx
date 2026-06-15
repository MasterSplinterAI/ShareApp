import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Auth } from '../../services/apiV2';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useTranslation } from '../../lib/i18n/I18nProvider';

const PAID_PLANS = new Set(['starter', 'pro']);

export default function V2Signup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const planParam = (searchParams.get('plan') || '').toLowerCase();
  const planName = PAID_PLANS.has(planParam) ? t(`pricing.tiers.${planParam}.name`) : null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accountType, setAccountType] = useState('individual');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [marketingEmail, setMarketingEmail] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('v2_token')) {
      navigate('/v2/app', { replace: true });
    }
  }, [navigate]);

  const submit = async (e) => {
    e.preventDefault();
    if (!agreedToTerms) {
      toast.error(t('auth.signup.termsRequired'));
      return;
    }
    if (accountType === 'company' && !companyName.trim()) {
      toast.error(t('auth.signup.companyRequired'));
      return;
    }
    setLoading(true);
    try {
      const data = await v2Auth.signup({
        email,
        password,
        displayName: displayName.trim() || undefined,
        accountType,
        orgName: accountType === 'company' ? companyName.trim() : undefined,
        marketingEmail: marketingEmail || undefined,
      });
      localStorage.setItem('v2_token', data.token);
      toast.success(t('auth.signup.success'));
      if (planName) {
        navigate(`/v2/app/settings?checkout=${planParam}`, { replace: true });
      } else {
        navigate('/v2/app', { replace: true });
      }
    } catch (err) {
      toast.error(err.response?.data?.error || t('auth.signup.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <Card className="border-border/80 shadow-lg">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">{t('auth.signup.title')}</CardTitle>
          <CardDescription>{t('auth.signup.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {planName && (
            <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
              {t('auth.signup.planBanner', { plan: planName })}
            </div>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>{t('auth.signup.accountType')}</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAccountType('individual')}
                  className={cn(
                    'rounded-md border px-3 py-2.5 text-left text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    accountType === 'individual'
                      ? 'border-primary bg-primary/5 font-medium text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  <span className="block font-medium">{t('auth.signup.individual')}</span>
                  <span className="mt-0.5 block text-xs opacity-80">{t('auth.signup.individualHint')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAccountType('company')}
                  className={cn(
                    'rounded-md border px-3 py-2.5 text-left text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    accountType === 'company'
                      ? 'border-primary bg-primary/5 font-medium text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  <span className="block font-medium">{t('auth.signup.company')}</span>
                  <span className="mt-0.5 block text-xs opacity-80">{t('auth.signup.companyHint')}</span>
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="display">{t('auth.signup.yourName')}</Label>
              <Input
                id="display"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Jane Doe"
                autoComplete="name"
              />
            </div>
            {accountType === 'company' && (
              <div className="space-y-2">
                <Label htmlFor="company">{t('auth.signup.companyName')}</Label>
                <Input
                  id="company"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Inc"
                  required
                  autoComplete="organization"
                />
                <p className="text-xs text-muted-foreground">{t('auth.signup.companyHintLong')}</p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.passwordMin')}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="flex items-start gap-2">
              <input
                id="terms"
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <Label htmlFor="terms" className="cursor-pointer text-sm font-normal leading-snug text-muted-foreground">
                {t('auth.signup.termsPrefix')}{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                  {t('auth.signup.terms')}
                </a>{' '}
                {t('auth.signup.termsAnd')}{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                  {t('auth.signup.privacy')}
                </a>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <input
                id="marketing-email"
                type="checkbox"
                checked={marketingEmail}
                onChange={(e) => setMarketingEmail(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <Label htmlFor="marketing-email" className="cursor-pointer text-sm font-normal leading-snug text-muted-foreground">
                {t('auth.signup.marketing')}
              </Label>
            </div>
            <Button type="submit" className="w-full" disabled={loading || !agreedToTerms}>
              {loading ? t('auth.signup.submitting') : t('auth.signup.submit')}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t('auth.signup.hasAccount')}{' '}
            <Link to="/v2/login" className="font-medium text-primary hover:underline">
              {t('nav.signIn')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
