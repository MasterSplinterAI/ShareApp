import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useTranslation } from '../../lib/i18n/I18nProvider';

const isNgrok =
  window.location.hostname.includes('ngrok.app') ||
  window.location.hostname.includes('ngrok-free.app') ||
  window.location.hostname.includes('ngrok.io');
const isNetworkAccess = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
const isHTTPS = window.location.protocol === 'https:';

let base = import.meta.env.VITE_API_URL || '/api';
if (isNgrok || (isNetworkAccess && isHTTPS)) {
  base = '/api';
} else if (isNetworkAccess) {
  base = `http://${window.location.hostname}:3001/api`;
}
const API_V2_BASE = `${base.replace(/\/$/, '')}/v2`;

export default function V2ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  return (
    <div className="mx-auto max-w-md">
      {token ? <NewPasswordForm token={token} /> : <RequestResetForm />}
    </div>
  );
}

function RequestResetForm() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post(`${API_V2_BASE}/auth/forgot-password`, { email });
      setSent(true);
    } catch {
      toast.error(t('auth.reset.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-border/80 shadow-lg">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">{t('auth.reset.title')}</CardTitle>
        <CardDescription>{t('auth.reset.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <p className="rounded-md border border-border/80 bg-muted/50 p-4 text-sm text-foreground">{t('auth.reset.sent')}</p>
        ) : (
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
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.reset.submitting') : t('auth.reset.submit')}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('auth.reset.remembered')}{' '}
          <Link to="/v2/login" className="font-medium text-primary hover:underline">
            {t('nav.signIn')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

function NewPasswordForm({ token }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error(t('auth.reset.mismatch'));
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API_V2_BASE}/auth/reset-password`, { token, password });
      setDone(true);
      toast.success(t('auth.reset.success'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('auth.reset.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-border/80 shadow-lg">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">{t('auth.reset.newTitle')}</CardTitle>
        <CardDescription>{t('auth.reset.newDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {done ? (
          <div className="space-y-4">
            <p className="rounded-md border border-border/80 bg-muted/50 p-4 text-sm text-foreground">
              {t('auth.reset.updated')}
            </p>
            <Button className="w-full" asChild>
              <Link to="/v2/login">{t('nav.signIn')}</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.newPassword')}</Label>
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
            <div className="space-y-2">
              <Label htmlFor="confirm">{t('auth.confirmPassword')}</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.reset.updating') : t('auth.reset.setPassword')}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link to="/v2/login" className="font-medium text-primary hover:underline">
            {t('auth.backSignIn')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
