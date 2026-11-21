import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { useAdmin } from '../../context/AdminContext';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { fmtDateTime } from './formatters';

function StatusBadge({ ok, label, warn = false }) {
  return (
    <Badge
      variant={ok ? 'default' : warn ? 'destructive' : 'secondary'}
      className={ok ? 'bg-emerald-600 hover:bg-emerald-600' : ''}
    >
      {label}
    </Badge>
  );
}

export function AgentFailoverAlertsSection() {
  const { reloadAgentAlerts } = useAdmin();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [failoverEnabled, setFailoverEnabled] = useState(true);
  const [joinTimeoutSec, setJoinTimeoutSec] = useState(10);
  const [circuitCooldownSec, setCircuitCooldownSec] = useState(120);
  const [alertCooldownMinutes, setAlertCooldownMinutes] = useState(15);
  const [bannerEnabled, setBannerEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [emailRecipients, setEmailRecipients] = useState('');
  const [clearEmailRecipients, setClearEmailRecipients] = useState(false);
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [clearTelegramBotToken, setClearTelegramBotToken] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [clearTelegramChatId, setClearTelegramChatId] = useState(false);
  const [notifyOnRecovery, setNotifyOnRecovery] = useState(true);
  const [auditReason, setAuditReason] = useState('');

  const applyPayload = useCallback((payload) => {
    setData(payload);
    const s = payload?.settings || {};
    setFailoverEnabled(s.failoverEnabled ?? true);
    setJoinTimeoutSec(s.joinTimeoutSec ?? 10);
    setCircuitCooldownSec(s.circuitCooldownSec ?? 120);
    setAlertCooldownMinutes(s.alertCooldownMinutes ?? 15);
    setBannerEnabled(s.bannerEnabled ?? true);
    setEmailEnabled(s.emailEnabled ?? true);
    setEmailRecipients(s.emailRecipients || '');
    setClearEmailRecipients(false);
    setTelegramEnabled(s.telegramEnabled ?? true);
    setTelegramBotToken('');
    setClearTelegramBotToken(false);
    setTelegramChatId(s.telegramChatId || '');
    setClearTelegramChatId(false);
    setNotifyOnRecovery(s.notifyOnRecovery ?? true);
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    return v2Admin
      .agentAlertsConfig()
      .then((res) => {
        applyPayload(res);
      })
      .catch(() => toast.error('Failed to load agent failover settings'))
      .finally(() => setLoading(false));
  }, [applyPayload]);

  useEffect(() => {
    reload();
  }, [reload]);

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
        failoverEnabled,
        joinTimeoutSec: Number(joinTimeoutSec),
        circuitCooldownSec: Number(circuitCooldownSec),
        alertCooldownMinutes: Number(alertCooldownMinutes),
        bannerEnabled,
        emailEnabled,
        telegramEnabled,
        notifyOnRecovery,
      };
      if (clearEmailRecipients) body.clearEmailRecipients = true;
      else body.emailRecipients = emailRecipients.trim();
      if (clearTelegramBotToken) body.clearTelegramBotToken = true;
      else if (telegramBotToken.trim()) body.telegramBotToken = telegramBotToken.trim();
      if (clearTelegramChatId) body.clearTelegramChatId = true;
      else if (telegramChatId.trim()) body.telegramChatId = telegramChatId.trim();

      const res = await v2Admin.patchAgentAlertsConfig(body);
      applyPayload(res);
      setAuditReason('');
      await reloadAgentAlerts();
      toast.success('Failover and notification settings saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save failover settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await v2Admin.testAgentAlerts();
      applyPayload(res);
      await reloadAgentAlerts();
      const emailSent = res?.delivery?.emailResult?.sent;
      const tgSent = res?.delivery?.telegramResult?.sent;
      toast.success(
        `Test logged — Email: ${emailSent ? 'sent' : 'skipped/disabled'}, Telegram: ${tgSent ? 'sent' : 'skipped/disabled'}`
      );
    } catch (err) {
      toast.error(err.response?.data?.error || 'Test alert failed');
    } finally {
      setTesting(false);
    }
  };

  const handleAcknowledgeAll = async () => {
    try {
      const res = await v2Admin.acknowledgeAgentAlerts();
      applyPayload(res);
      await reloadAgentAlerts();
      toast.success('Alerts acknowledged');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to acknowledge alerts');
    }
  };

  const handleResetCircuit = async () => {
    try {
      const res = await v2Admin.resetAgentCircuit({ reason: 'admin_comms_reset' });
      applyPayload(res);
      await reloadAgentAlerts();
      toast.success('Circuit reset to EC2 primary');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reset circuit');
    }
  };

  if (loading && !data) {
    return (
      <Card className="app-card border-border/60">
        <CardContent className="py-8">
          <p className="text-sm text-muted-foreground">Loading agent failover &amp; alert configuration…</p>
        </CardContent>
      </Card>
    );
  }

  const settings = data?.settings || {};
  const runtime = data?.runtime || {};
  const recentEvents = data?.recentEvents || [];
  const unackedCount = (data?.unacknowledged || []).length;

  return (
    <Card className="app-card border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg">Worker Failover &amp; Incident Notifications</CardTitle>
            <CardDescription>
              Automatically fails over rooms from self-hosted EC2 (<code>translation-selfhosted-xai</code>) to LiveKit Cloud backup (
              <code>translation-cloud-deepgram-codeswitch</code>) if no worker joins on time, and notifies admins via Overview banner, email, and Telegram.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {runtime.circuitOpen && (
              <Button type="button" size="sm" variant="outline" onClick={handleResetCircuit}>
                Reset circuit
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" disabled={testing} onClick={handleTest}>
              {testing ? 'Sending test…' : 'Send test alert'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            ok={!runtime.circuitOpen}
            warn={runtime.circuitOpen}
            label={runtime.circuitOpen ? 'Circuit OPEN (Cloud backup active)' : 'Circuit closed (EC2 primary)'}
          />
          <StatusBadge ok={settings.failoverEnabled} label={settings.failoverEnabled ? 'Auto-failover ON' : 'Auto-failover OFF'} />
          <StatusBadge ok={settings.bannerEnabled} label={settings.bannerEnabled ? 'Admin banner ON' : 'Admin banner OFF'} />
          <StatusBadge
            ok={settings.emailEnabled && (settings.effectiveEmails || []).length > 0}
            label={`Email alerts (${(settings.effectiveEmails || []).length} recipient${(settings.effectiveEmails || []).length === 1 ? '' : 's'})`}
          />
          <StatusBadge
            ok={settings.telegramEnabled && settings.hasTelegramBotToken && settings.hasTelegramChatId}
            label={
              settings.telegramEnabled && settings.hasTelegramBotToken && settings.hasTelegramChatId
                ? 'Telegram ON'
                : 'Telegram off/unconfigured'
            }
          />
          {settings.source && <Badge variant="outline">Config: {settings.source}</Badge>}
        </div>

        <form className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4" onSubmit={handleSave}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={failoverEnabled}
                onChange={(e) => setFailoverEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <span>
                <span className="font-medium">Enable automatic Cloud backup failover</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  If the EC2 worker does not join before timeout, switch the room to Cloud standby.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={notifyOnRecovery}
                onChange={(e) => setNotifyOnRecovery(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <span>
                <span className="font-medium">Send recovery (&ldquo;All Clear&rdquo;) notification</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Notify when EC2 self-hosted workers begin accepting rooms again.
                </span>
              </span>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor="failover-join-timeout" className="text-xs font-medium text-muted-foreground">
                Join timeout (5–45 sec)
              </label>
              <Input
                id="failover-join-timeout"
                type="number"
                min={5}
                max={45}
                value={joinTimeoutSec}
                onChange={(e) => setJoinTimeoutSec(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="failover-circuit-cooldown" className="text-xs font-medium text-muted-foreground">
                Circuit cooldown (30–1800 sec)
              </label>
              <Input
                id="failover-circuit-cooldown"
                type="number"
                min={30}
                max={1800}
                value={circuitCooldownSec}
                onChange={(e) => setCircuitCooldownSec(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="failover-alert-cooldown" className="text-xs font-medium text-muted-foreground">
                Alert rate limit (1–240 min)
              </label>
              <Input
                id="failover-alert-cooldown"
                type="number"
                min={1}
                max={240}
                value={alertCooldownMinutes}
                onChange={(e) => setAlertCooldownMinutes(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-border/60 pt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={bannerEnabled}
                onChange={(e) => setBannerEnabled(e.target.checked)}
                className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <span className="font-medium">Show unacknowledged failover banner on Admin Dashboard</span>
            </label>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={emailEnabled}
                  onChange={(e) => setEmailEnabled(e.target.checked)}
                  className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                />
                <span className="font-medium">Email alerts (via Resend)</span>
              </label>
              <Input
                id="failover-email-recipients"
                value={emailRecipients}
                onChange={(e) => {
                  setEmailRecipients(e.target.value);
                  setClearEmailRecipients(false);
                }}
                placeholder={
                  (settings.envEmails || []).length
                    ? `Inheriting V2_SUPERADMIN_EMAILS (${settings.envEmails.join(', ')})`
                    : 'ops@example.com, admin@example.com'
                }
              />
              {!settings.usingEnvEmailRecipients && settings.emailRecipients && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearEmailRecipients}
                    onChange={(e) => setClearEmailRecipients(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
                  Reset recipients to server default (V2_SUPERADMIN_EMAILS)
                </label>
              )}
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={telegramEnabled}
                  onChange={(e) => setTelegramEnabled(e.target.checked)}
                  className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                />
                <span className="font-medium">Telegram push alerts</span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="failover-tg-token" className="text-xs font-medium text-muted-foreground">
                    Telegram Bot Token (optional override)
                  </label>
                  <Input
                    id="failover-tg-token"
                    type="password"
                    autoComplete="off"
                    value={telegramBotToken}
                    onChange={(e) => {
                      setTelegramBotToken(e.target.value);
                      setClearTelegramBotToken(false);
                    }}
                    placeholder={
                      settings.hasTelegramBotToken
                        ? `Configured (${settings.telegramBotTokenMasked || '••••••••'})`
                        : '123456789:ABC...'
                    }
                  />
                  {!settings.usingEnvTelegramToken && settings.hasTelegramBotToken && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={clearTelegramBotToken}
                        onChange={(e) => setClearTelegramBotToken(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-border accent-primary"
                      />
                      Clear DB token &amp; inherit env
                    </label>
                  )}
                </div>

                <div className="space-y-1">
                  <label htmlFor="failover-tg-chat-id" className="text-xs font-medium text-muted-foreground">
                    Telegram Chat ID (optional override)
                  </label>
                  <Input
                    id="failover-tg-chat-id"
                    value={telegramChatId}
                    onChange={(e) => {
                      setTelegramChatId(e.target.value);
                      setClearTelegramChatId(false);
                    }}
                    placeholder={
                      settings.effectiveTelegramChatIdMasked
                        ? `Inheriting env (${settings.effectiveTelegramChatIdMasked})`
                        : '-100... or user chat ID'
                    }
                  />
                  {!settings.usingEnvTelegramChatId && settings.hasTelegramChatId && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={clearTelegramChatId}
                        onChange={(e) => setClearTelegramChatId(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-border accent-primary"
                      />
                      Clear DB chat ID &amp; inherit env
                    </label>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 border-t border-border/60 pt-3">
            <div className="min-w-[14rem] flex-1 space-y-1">
              <label htmlFor="failover-audit-reason" className="text-xs font-medium text-muted-foreground">
                Audit reason (required)
              </label>
              <Input
                id="failover-audit-reason"
                value={auditReason}
                onChange={(e) => setAuditReason(e.target.value)}
                placeholder="e.g. Adjust failover timeout to 12s or update alert recipients"
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save notification settings'}
            </Button>
          </div>
        </form>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent failover &amp; alert events ({recentEvents.length})
            </p>
            {unackedCount > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={handleAcknowledgeAll}>
                Acknowledge all ({unackedCount})
              </Button>
            )}
          </div>
          {recentEvents.length === 0 ? (
            <p className="rounded-lg border border-border/60 px-3 py-4 text-xs text-muted-foreground">
              No failover or alert events recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Event</th>
                    <th className="px-3 py-2 font-medium">Room</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.slice(0, 10).map((ev) => (
                    <tr key={ev.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 text-muted-foreground">{fmtDateTime(ev.createdAt)}</td>
                      <td className="px-3 py-2 font-medium">{ev.eventKind}</td>
                      <td className="px-3 py-2 font-mono">{ev.roomName}</td>
                      <td className="px-3 py-2">{ev.reason}</td>
                      <td className="px-3 py-2">
                        {ev.acknowledgedAt ? (
                          <Badge variant="secondary">Acked ({ev.acknowledgedBy || 'admin'})</Badge>
                        ) : (
                          <Badge variant="destructive">Unacknowledged</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default AgentFailoverAlertsSection;
