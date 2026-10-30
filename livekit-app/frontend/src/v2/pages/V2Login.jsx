import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Auth } from '../../services/apiV2';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useTranslation } from '../../lib/i18n/I18nProvider';

export default function V2Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('v2_token')) {
      navigate('/v2/app', { replace: true });
    }
  }, [navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await v2Auth.login({ email, password });
      localStorage.setItem('v2_token', data.token);
      toast.success(t('auth.login.success'));
      navigate('/v2/app', { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || t('auth.login.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <Card className="border-border/80 shadow-lg">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">{t('auth.login.title')}</CardTitle>
          <CardDescription>{t('auth.login.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t('auth.password')}</Label>
                <Link to="/v2/reset-password" className="text-xs font-medium text-primary hover:underline">
                  {t('auth.forgotPassword')}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.login.submitting') : t('auth.login.submit')}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t('auth.login.noAccount')}{' '}
            <Link to="/v2/signup" className="font-medium text-primary hover:underline">
              {t('auth.login.createAccount')}
            </Link>
          </p>
          <p className="mt-4 text-center">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
              {t('auth.backHome')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
