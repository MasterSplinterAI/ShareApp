import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Auth } from '../../services/apiV2';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

const PAID_PLANS = { starter: 'Starter', pro: 'Pro' };

export default function V2Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const planParam = (searchParams.get('plan') || '').toLowerCase();
  const planName = PAID_PLANS[planParam] || null;
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
      toast.error('Please agree to the Terms of Service and Privacy Policy');
      return;
    }
    if (accountType === 'company' && !companyName.trim()) {
      toast.error('Company name is required for company accounts');
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
      toast.success('Account created');
      if (planName) {
        navigate(`/v2/app/settings?checkout=${planParam}`, { replace: true });
      } else {
        navigate('/v2/app', { replace: true });
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <Card className="border-border/80 shadow-lg">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">Create account</CardTitle>
          <CardDescription>
            Start free as an individual, or sign up with your company. You can upgrade to a business plan later to invite
            colleagues—even if you&apos;re already on a paid personal plan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {planName && (
            <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
              You&apos;re signing up for the <span className="font-medium">{planName}</span> plan — you&apos;ll confirm
              billing after creating your account.
            </div>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>Account type</Label>
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
                  <span className="block font-medium">Individual</span>
                  <span className="mt-0.5 block text-xs opacity-80">Personal use — just your name</span>
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
                  <span className="block font-medium">Company</span>
                  <span className="mt-0.5 block text-xs opacity-80">Shared workspace name</span>
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="display">Your name</Label>
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
                <Label htmlFor="company">Company name</Label>
                <Input
                  id="company"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Inc"
                  required
                  autoComplete="organization"
                />
                <p className="text-xs text-muted-foreground">
                  Shown to your team in meetings and settings. Upgrade to Pro later to invite colleagues with their own
                  logins.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password (min 8 characters)</Label>
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
                I agree to the{' '}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  Terms of Service
                </a>{' '}
                and{' '}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  Privacy Policy
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
              <Label
                htmlFor="marketing-email"
                className="cursor-pointer text-sm font-normal leading-snug text-muted-foreground"
              >
                Email me product updates and tips (optional)
              </Label>
            </div>
            <Button type="submit" className="w-full" disabled={loading || !agreedToTerms}>
              {loading ? 'Creating…' : 'Create account'}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/v2/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
