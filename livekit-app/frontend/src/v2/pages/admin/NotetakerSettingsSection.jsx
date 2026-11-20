import { useCallback, useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { fmtDateTime } from './formatters';

function StatusBadge({ ok, label }) {
  return (
    <Badge
      variant={ok ? 'default' : 'secondary'}
      className={ok ? 'bg-emerald-600 hover:bg-emerald-600' : ''}
    >
      {label}
    </Badge>
  );
}

const REGION_OPTIONS = [
  { value: 'us-east-1', label: 'us-east-1 (US East — N. Virginia)' },
  { value: 'us-west-2', label: 'us-west-2 (US West — Oregon)' },
  { value: 'eu-central-1', label: 'eu-central-1 (EU Central — Frankfurt)' },
  { value: 'ap-northeast-1', label: 'ap-northeast-1 (Asia Pacific — Tokyo)' },
];

export function NotetakerSettingsSection() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedCalRedirect, setCopiedCalRedirect] = useState(false);

  const [driverMode, setDriverMode] = useState('auto');
  const [recallRegion, setRecallRegion] = useState('us-west-2');
  const [recallApiKey, setRecallApiKey] = useState('');
  const [clearRecallApiKey, setClearRecallApiKey] = useState(false);
  const [recallWebhookSecret, setRecallWebhookSecret] = useState('');
  const [clearRecallWebhookSecret, setClearRecallWebhookSecret] = useState(false);
  const [transcriptMode, setTranscriptMode] = useState('recallai_async');
  const [chatNoticeEnabled, setChatNoticeEnabled] = useState(true);
  const [xaiFallbackEnabled, setXaiFallbackEnabled] = useState(false);
  const [deleteRecallMediaAfterIngest, setDeleteRecallMediaAfterIngest] = useState(true);
  const [waitingRoomTimeoutSec, setWaitingRoomTimeoutSec] = useState(600);
  const [everyoneLeftTimeoutSec, setEveryoneLeftTimeoutSec] = useState(30);
  const [auditReason, setAuditReason] = useState('');

  const applySettings = useCallback((s) => {
    setSettings(s || {});
    setDriverMode(s?.driverMode || 'auto');
    setRecallRegion(s?.recallRegion || 'us-west-2');
    setRecallApiKey('');
    setClearRecallApiKey(false);
    setRecallWebhookSecret('');
    setClearRecallWebhookSecret(false);
    setTranscriptMode(s?.transcriptMode || 'recallai_async');
    setChatNoticeEnabled(s?.chatNoticeEnabled ?? true);
    setXaiFallbackEnabled(s?.xaiFallbackEnabled ?? false);
    setDeleteRecallMediaAfterIngest(s?.deleteRecallMediaAfterIngest ?? true);
    setWaitingRoomTimeoutSec(s?.waitingRoomTimeoutSec ?? 600);
    setEveryoneLeftTimeoutSec(s?.everyoneLeftTimeoutSec ?? 30);
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    return v2Admin
      .notetakerConfig()
      .then((res) => applySettings(res?.settings))
      .catch(() => toast.error('Failed to load notetaker configuration'))
      .finally(() => setLoading(false));
  }, [applySettings]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const payload = { recallRegion };
      if (recallApiKey.trim()) payload.recallApiKey = recallApiKey.trim();
      const res = await v2Admin.verifyNotetakerConfig(payload);
      if (res?.region && res.region !== recallRegion) {
        setRecallRegion(res.region);
      }
      if (res?.regionAutoDetected) {
        toast.success(`Connected to Recall.ai! Auto-detected region ${res.region}.`);
      } else {
        toast.success(`Connected to Recall.ai (${res?.region || recallRegion})`);
      }
      if (!recallApiKey.trim() && res?.regionAutoDetected) {
        await reload();
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not verify Recall.ai API key');
    } finally {
      setVerifying(false);
    }
  };

  const handleCopyWebhook = async () => {
    if (!settings?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(settings.webhookUrl);
      setCopiedWebhook(true);
      toast.success('Webhook URL copied');
      setTimeout(() => setCopiedWebhook(false), 2000);
    } catch {
      toast.error('Could not copy webhook URL');
    }
  };

  const handleCopyCalRedirect = async () => {
    const uri = settings?.calendarConnectedRedirectUri;
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      setCopiedCalRedirect(true);
      toast.success('Calendar Connected Redirect URI copied');
      setTimeout(() => setCopiedCalRedirect(false), 2000);
    } catch {
      toast.error('Could not copy Calendar Redirect URI');
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (auditReason.trim().length < 4) {
      toast.error('Audit reason required (4+ characters).');
      return;
    }
    setSaving(true);
    try {
      const body = {
        reason: auditReason.trim(),
        driverMode,
        recallRegion,
        transcriptMode,
        chatNoticeEnabled,
        xaiFallbackEnabled,
        deleteRecallMediaAfterIngest,
        waitingRoomTimeoutSec: Number(waitingRoomTimeoutSec),
        everyoneLeftTimeoutSec: Number(everyoneLeftTimeoutSec),
      };
      if (clearRecallApiKey) body.clearRecallApiKey = true;
      else if (recallApiKey.trim()) body.recallApiKey = recallApiKey.trim();
      if (clearRecallWebhookSecret) body.clearRecallWebhookSecret = true;
      else if (recallWebhookSecret.trim()) body.recallWebhookSecret = recallWebhookSecret.trim();

      const res = await v2Admin.patchNotetakerConfig(body);
      applySettings(res?.settings);
      setAuditReason('');
      toast.success('External Notetaker settings saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save Notetaker settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !settings) {
    return (
      <Card className="app-card border-border/60">
        <CardContent className="py-8">
          <p className="text-sm text-muted-foreground">Loading External Notetaker configuration…</p>
        </CardContent>
      </Card>
    );
  }

  const recallActive = settings?.effectiveDriver === 'recall' && Boolean(settings?.hasRecallApiKey);

  return (
    <Card className="app-card border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg">External Meeting Notetaker (Recall.ai)</CardTitle>
            <CardDescription>
              Connect Recall.ai to send white-labeled bots into Google Meet, Microsoft Teams, Zoom, and Webex calls,
              archive MP3 recordings in S3, and run Lalia AI summaries &amp; recaps.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            ok={recallActive}
            label={recallActive ? 'Recall.ai active' : 'Awaiting Recall API key (worker fallback)'}
          />
          <Badge variant="outline">Region: {settings?.recallRegion || recallRegion}</Badge>
          <StatusBadge
            ok={Boolean(settings?.hasRecallWebhookSecret)}
            label={settings?.hasRecallWebhookSecret ? 'Webhooks verified' : 'Webhook secret missing'}
          />
          {settings?.source && <Badge variant="secondary">Source: {settings.source}</Badge>}
        </div>

        <form onSubmit={handleSave} className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Bot Driver Mode</label>
              <Select value={driverMode} onValueChange={setDriverMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (Recall.ai when configured)</SelectItem>
                  <SelectItem value="recall">Recall.ai</SelectItem>
                  <SelectItem value="worker">Self-hosted Worker</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Recall Region</label>
              <Select value={recallRegion} onValueChange={setRecallRegion}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REGION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="recall-api-key" className="text-xs font-medium text-muted-foreground">
              Recall.ai API Key
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="recall-api-key"
                type="password"
                autoComplete="off"
                value={recallApiKey}
                onChange={(e) => {
                  setRecallApiKey(e.target.value);
                  setClearRecallApiKey(false);
                }}
                placeholder={
                  settings?.hasRecallApiKey
                    ? `Saved: ${settings.recallApiKeyMasked} — paste new key to replace`
                    : 'Paste your Recall.ai API key'
                }
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                disabled={verifying}
                onClick={handleVerify}
                className="shrink-0"
              >
                {verifying ? 'Verifying…' : 'Verify Connection'}
              </Button>
            </div>
            {settings?.hasRecallApiKey && !settings?.usingEnvApiKey && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={clearRecallApiKey}
                  onChange={(e) => setClearRecallApiKey(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-primary"
                />
                Clear saved API key
              </label>
            )}
          </div>

          <div className="space-y-1.5 rounded-lg border border-border/60 bg-background/60 p-3">
            <label className="text-xs font-medium text-muted-foreground">
              Recall Webhook Endpoint URL (for instant status &amp; completion push)
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-muted px-2.5 py-1.5 text-xs text-foreground">
                {settings?.webhookUrl || 'https://lalia.cloud/api/v2/webhooks/recall'}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleCopyWebhook}
                className="shrink-0 gap-1.5"
              >
                {copiedWebhook ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedWebhook ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Required webhook endpoint for Recall.ai v1.11 bot, recording, async transcript, and Calendar V2 push
              events (Svix / Standard Webhooks verified).
            </p>
          </div>

          <div className="space-y-1.5 rounded-lg border border-border/60 bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                Calendar V2 Connected Redirect URI (Google OAuth)
              </label>
              <Badge variant={settings?.hasCalendarRegionalCallbackUri ? 'default' : 'outline'} className="text-[11px]">
                {settings?.hasCalendarRegionalCallbackUri ? 'Regional callback set' : 'Using default Recall callback'}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-muted px-2.5 py-1.5 text-xs text-foreground">
                {settings?.calendarConnectedRedirectUri ||
                  'https://lalia.cloud/api/v2/notetaker/calendar/oauth/callback'}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleCopyCalRedirect}
                className="shrink-0 gap-1.5"
              >
                {copiedCalRedirect ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedCalRedirect ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Add this exact URL as an Authorized Redirect URI in Google Cloud OAuth; Lalia forwards OAuth callbacks &amp;
              setup probes directly to Recall.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="recall-webhook-secret" className="text-xs font-medium text-muted-foreground">
                Webhook Signing Secret (whsec_...)
              </label>
              <Input
                id="recall-webhook-secret"
                type="password"
                autoComplete="off"
                value={recallWebhookSecret}
                onChange={(e) => {
                  setRecallWebhookSecret(e.target.value);
                  setClearRecallWebhookSecret(false);
                }}
                placeholder={
                  settings?.hasRecallWebhookSecret
                    ? `Saved: ${settings.recallWebhookSecretMasked}`
                    : 'whsec_...'
                }
              />
              {settings?.hasRecallWebhookSecret && !settings?.usingEnvWebhookSecret && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearRecallWebhookSecret}
                    onChange={(e) => setClearRecallWebhookSecret(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
                  Clear saved webhook secret
                </label>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Transcription Source</label>
              <Select value={transcriptMode} onValueChange={setTranscriptMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recallai_async">
                    Recall.ai Post-Meeting Async Transcription (Recommended)
                  </SelectItem>
                  <SelectItem value="meeting_captions">
                    Native Meeting Captions ($0/hr extra on Meet/Teams/Zoom)
                  </SelectItem>
                  <SelectItem value="recallai_streaming">Recall.ai Streaming Transcription</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={chatNoticeEnabled}
                onChange={(e) => setChatNoticeEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <span>
                <span className="font-medium">Send chat notice when joining</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Posts Lalia&apos;s recording notice to chat on Zoom, Google Meet, and MS Teams (omitted on Webex).
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={xaiFallbackEnabled}
                onChange={(e) => setXaiFallbackEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <span>
                <span className="font-medium">xAI Grok STT fallback</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Automatically transcribe MP3 via xAI Grok STT if Recall/captions transcript is empty.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={deleteRecallMediaAfterIngest}
                onChange={(e) => setDeleteRecallMediaAfterIngest(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <span>
                <span className="font-medium">Delete Recall media after S3 archive</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Remove media from Recall servers once saved permanently to Lalia S3.
                </span>
              </span>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="recall-waiting-timeout" className="text-xs font-medium text-muted-foreground">
                Waiting room timeout (60–1800 sec)
              </label>
              <Input
                id="recall-waiting-timeout"
                type="number"
                min={60}
                max={1800}
                value={waitingRoomTimeoutSec}
                onChange={(e) => setWaitingRoomTimeoutSec(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="recall-alone-timeout" className="text-xs font-medium text-muted-foreground">
                Everyone-left timeout (5–600 sec)
              </label>
              <Input
                id="recall-alone-timeout"
                type="number"
                min={5}
                max={600}
                value={everyoneLeftTimeoutSec}
                onChange={(e) => setEveryoneLeftTimeoutSec(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 border-t border-border/60 pt-3">
            <div className="min-w-[14rem] flex-1 space-y-1">
              <label htmlFor="notetaker-audit-reason" className="text-xs font-medium text-muted-foreground">
                Audit reason (required)
              </label>
              <Input
                id="notetaker-audit-reason"
                value={auditReason}
                onChange={(e) => setAuditReason(e.target.value)}
                placeholder="e.g. Connect Recall.ai API key for launch"
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save Notetaker Settings'}
            </Button>
          </div>
        </form>

        {settings?.updatedAt && (
          <p className="text-xs text-muted-foreground">
            Last updated {fmtDateTime(settings.updatedAt)}
            {settings.updatedBy ? ` by ${settings.updatedBy}` : ''}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default NotetakerSettingsSection;
