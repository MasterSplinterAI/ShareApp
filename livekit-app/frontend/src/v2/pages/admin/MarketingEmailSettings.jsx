import { useEffect, useState } from 'react';
import { Check, Copy, Loader2, Megaphone, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { v2Admin } from '../../../services/apiV2';

const SECRET_SOURCE_LABEL = {
  db: 'Saved in Admin (overrides .env)',
  env: 'From server .env (MARKETING_RESEND_WEBHOOK_SECRET)',
  none: 'Not configured',
};

const FROM_SOURCE_LABEL = {
  marketing_db: 'Saved in Admin',
  marketing_env: 'From server .env (MARKETING_EMAIL_FROM)',
  transactional: 'Falls back to the transactional From address (Comms)',
};

export default function MarketingEmailSettings() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState('');
  const [marketingFrom, setMarketingFrom] = useState('');
  const [copied, setCopied] = useState(false);

  const reload = () =>
    v2Admin
      .marketingEmailConfig()
      .then((r) => {
        setData(r.settings);
        setMarketingFrom(r.settings?.marketingEmailFrom || '');
      })
      .catch(() => toast.error('Failed to load marketing email settings'))
      .finally(() => setLoading(false));

  useEffect(() => {
    reload();
  }, []);

  const webhookUrl = data?.marketingWebhookUrl || 'https://lalia.cloud/marketing/webhooks/resend';
  const secretConfigured = Boolean(data?.marketingResendWebhookSecretConfigured);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(`Copy failed — URL is ${webhookUrl}`);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = { marketingEmailFrom: marketingFrom };
      if (webhookSecret.trim()) body.marketingResendWebhookSecret = webhookSecret.trim();
      const r = await v2Admin.patchMarketingEmailConfig(body);
      setData(r.settings);
      setMarketingFrom(r.settings?.marketingEmailFrom || '');
      setWebhookSecret('');
      toast.success('Marketing email settings saved');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const handleClearSecret = async () => {
    setSaving(true);
    try {
      const r = await v2Admin.patchMarketingEmailConfig({ clearMarketingResendWebhookSecret: true });
      setData(r.settings);
      toast.success('Saved webhook secret cleared');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not clear secret');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !data) {
    return (
      <Card className="mb-4 border-border/80">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">Loading marketing email settings…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-4 border-border/80" data-testid="card-marketing-email-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Megaphone className="h-5 w-5" />
          Marketing email settings
        </CardTitle>
        <CardDescription>
          Resend delivery for campaigns and drips. The webhook signing secret is encrypted at rest,
          shown masked after saving, and overrides the server .env value.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Resend webhook URL</label>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={webhookUrl}
              className="font-mono text-xs"
              data-testid="input-marketing-webhook-url"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyUrl}
              data-testid="button-copy-marketing-webhook-url"
            >
              {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            In Resend → Webhooks, add this endpoint for email.delivered, opened, clicked, bounced and
            complained events, then paste its signing secret below.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium">Webhook signing secret</label>
            <Badge variant={secretConfigured ? 'default' : 'secondary'} data-testid="badge-marketing-webhook-secret">
              {secretConfigured
                ? `Configured (${data.marketingResendWebhookSecretMasked})`
                : 'Not configured'}
            </Badge>
            {secretConfigured && (
              <span className="text-xs text-muted-foreground" data-testid="text-marketing-webhook-secret-source">
                {SECRET_SOURCE_LABEL[data.marketingResendWebhookSecretSource] || ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="password"
              autoComplete="off"
              placeholder={
                secretConfigured
                  ? 'Paste a new whsec_… value to replace — leave blank to keep'
                  : 'whsec_…'
              }
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              data-testid="input-marketing-webhook-secret"
            />
            {data.marketingResendWebhookSecretSource === 'db' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClearSecret}
                disabled={saving}
                data-testid="button-clear-marketing-webhook-secret"
              >
                Clear saved
              </Button>
            )}
          </div>
          {!secretConfigured && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Until a secret is saved, Resend events are rejected and opens, clicks and bounces are not
              tracked.
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Marketing From address</label>
            <Input
              placeholder={data.effectiveMarketingEmailFrom || 'Lalia <hello@lalia.cloud>'}
              value={marketingFrom}
              onChange={(e) => setMarketingFrom(e.target.value)}
              data-testid="input-marketing-email-from"
            />
            <p className="text-xs text-muted-foreground">
              Effective:{' '}
              <span className="font-medium text-foreground" data-testid="text-effective-marketing-from">
                {data.effectiveMarketingEmailFrom || '—'}
              </span>
              {' · '}
              {FROM_SOURCE_LABEL[data.effectiveMarketingEmailFromSource] || ''}
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Resend API key</label>
            <div className="flex flex-wrap items-center gap-2 pt-1.5">
              <Badge
                variant={data.resendApiKeyConfigured ? 'default' : 'secondary'}
                data-testid="badge-marketing-resend-key"
              >
                {data.resendApiKeyConfigured
                  ? `Configured (${data.resendApiKeyMasked})`
                  : data.effectiveEmailSource === 'environment'
                    ? 'Configured via .env'
                    : 'Not configured'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Shared with transactional email — manage it on the Comms tab.
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} data-testid="button-save-marketing-email">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save marketing settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
