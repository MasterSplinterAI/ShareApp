import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { fmtDateTime } from './formatters';

function StatusBadge({ ok, label }) {
  return (
    <Badge variant={ok ? 'default' : 'secondary'} className={ok ? 'bg-emerald-600 hover:bg-emerald-600' : ''}>
      {label}
    </Badge>
  );
}

function EmailSettingsSection() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [mailFrom, setMailFrom] = useState('');
  const [resendApiKey, setResendApiKey] = useState('');
  const [auditReason, setAuditReason] = useState('');

  const reload = () => {
    setLoading(true);
    return v2Admin
      .emailConfig()
      .then((data) => {
        setConfig(data);
        setEmailEnabled(Boolean(data.settings?.emailEnabledPreference ?? data.emailEnabled));
        setMailFrom(data.settings?.mailFrom || '');
        setResendApiKey('');
      })
      .catch(() => toast.error('Failed to load email config'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, []);

  const saveSettings = async () => {
    if (auditReason.trim().length < 4) {
      toast.error('Audit reason required (4+ characters).');
      return;
    }
    setSaving(true);
    try {
      const body = {
        reason: auditReason.trim(),
        emailEnabled,
      };
      if (resendApiKey.trim()) body.resendApiKey = resendApiKey.trim();
      if (mailFrom.trim()) body.mailFrom = mailFrom.trim();
      await v2Admin.patchEmailConfig(body);
      toast.success(emailEnabled ? 'Email delivery enabled' : 'Email settings saved');
      setAuditReason('');
      await reload();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save email settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !config) {
    return (
      <Card className="app-card border-border/60">
        <CardContent className="py-8">
          <p className="text-sm text-muted-foreground">Loading email configuration…</p>
        </CardContent>
      </Card>
    );
  }

  const settings = config?.settings || {};

  return (
    <Card className="app-card border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Email delivery (Resend)</CardTitle>
        <CardDescription>
          Configure transactional email for password resets, meeting invites, reminders, transcript reports, and
          support replies. Secrets can be stored here (superadmin only) or in server <code>.env</code> as fallback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge ok={config?.emailEnabled} label={config?.emailEnabled ? 'Email enabled' : 'Email disabled'} />
          {settings.source && <Badge variant="secondary">Config source: {settings.source}</Badge>}
          {settings.usingEnvKey && <Badge variant="outline">Using env API key</Badge>}
        </div>

        <form
          className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveSettings();
          }}
        >
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={emailEnabled}
              onChange={(e) => setEmailEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
            />
            <span>
              <span className="font-medium">Enable email delivery</span>
              <span className="mt-1 block text-muted-foreground">
                Requires a valid Resend API key. When disabled, emails are logged but not sent.
              </span>
            </span>
          </label>

          <div className="space-y-1">
            <label htmlFor="resend-api-key" className="text-xs font-medium text-muted-foreground">
              Resend API key
            </label>
            <Input
              id="resend-api-key"
              type="password"
              autoComplete="off"
              value={resendApiKey}
              onChange={(e) => setResendApiKey(e.target.value)}
              placeholder={settings.hasResendApiKey ? `Configured (${settings.resendApiKeyMasked})` : 're_...'}
            />
            <p className="text-xs text-muted-foreground">Leave blank to keep the current key. Get one at resend.com.</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="mail-from" className="text-xs font-medium text-muted-foreground">
              From address
            </label>
            <Input
              id="mail-from"
              value={mailFrom}
              onChange={(e) => setMailFrom(e.target.value)}
              placeholder="Parley <no-reply@yourdomain.com>"
            />
            <p className="text-xs text-muted-foreground">Must use a domain verified in your Resend account.</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="email-audit-reason" className="text-xs font-medium text-muted-foreground">
              Audit reason
            </label>
            <Input
              id="email-audit-reason"
              value={auditReason}
              onChange={(e) => setAuditReason(e.target.value)}
              placeholder="Rotating Resend key for launch"
            />
          </div>

          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save email settings'}
          </Button>
        </form>

        {config?.envChecklist?.length > 0 && (
          <div className="rounded-lg border border-border/60 p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Environment checklist</p>
            <ul className="space-y-1 text-sm">
              {config.envChecklist.map((item) => (
                <li key={item.key} className="flex items-center justify-between gap-3">
                  <span>{item.key}</span>
                  <Badge variant={item.ok ? 'success' : 'muted'}>{item.ok ? 'set' : 'missing'}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {settings.updatedAt && (
          <p className="text-xs text-muted-foreground">
            Last updated {fmtDateTime(settings.updatedAt)}
            {settings.updatedBy ? ` by ${settings.updatedBy}` : ''}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const ANNOUNCEMENT_LEVELS = ['info', 'warning', 'critical'];

function levelVariant(level) {
  if (level === 'critical') return 'destructive';
  if (level === 'warning') return 'warning';
  return 'info';
}

function AnnouncementsSection() {
  const [announcements, setAnnouncements] = useState([]);
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState('info');
  const [endsAt, setEndsAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reload = () =>
    v2Admin
      .announcements()
      .then((r) => setAnnouncements(r.announcements || []))
      .catch(() => toast.error('Failed to load announcements'));

  useEffect(() => {
    reload();
  }, []);

  const create = async () => {
    if (message.trim().length < 4) {
      toast.error('Message must be at least 4 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const body = { message: message.trim(), level };
      if (endsAt) body.ends_at = new Date(endsAt).toISOString();
      await v2Admin.createAnnouncement(body);
      toast.success('Announcement created');
      setMessage('');
      setEndsAt('');
      setLevel('info');
      await reload();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to create announcement');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleDisabled = async (a) => {
    const disabled = !a.disabled_at;
    try {
      await v2Admin.patchAnnouncement(a.id, { disabled });
      toast.success(disabled ? 'Announcement disabled' : 'Announcement re-enabled');
      await reload();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to update announcement');
    }
  };

  return (
    <Card className="app-card overflow-hidden border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Announcements</CardTitle>
        <CardDescription>
          Banner messages shown to all signed-in users. Disable to retire one without deleting its history.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 lg:grid-cols-[1fr_auto_auto_auto]">
          <div className="space-y-1">
            <label htmlFor="announcement-message" className="text-xs font-medium text-muted-foreground">
              Message
            </label>
            <Input
              id="announcement-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Scheduled maintenance tonight 10pm–11pm PT…"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="announcement-level" className="text-xs font-medium text-muted-foreground">
              Level
            </label>
            <select
              id="announcement-level"
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              {ANNOUNCEMENT_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="announcement-ends" className="text-xs font-medium text-muted-foreground">
              Ends at (optional)
            </label>
            <Input
              id="announcement-ends"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button type="button" onClick={create} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Level</th>
                <th className="px-4 py-3 font-medium">Message</th>
                <th className="px-4 py-3 font-medium">Starts</th>
                <th className="px-4 py-3 font-medium">Ends</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {announcements.map((a) => (
                <tr key={a.id} className="border-b border-border/60 last:border-0 align-top">
                  <td className="px-4 py-3">
                    <Badge variant={levelVariant(a.level)}>{a.level}</Badge>
                  </td>
                  <td className="px-4 py-3 max-w-md">{a.message}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDateTime(a.starts_at)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {a.ends_at ? fmtDateTime(a.ends_at) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {a.disabled_at ? (
                      <Badge variant="muted">disabled</Badge>
                    ) : (
                      <Badge variant="success">active</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Button type="button" size="sm" variant="outline" onClick={() => toggleDisabled(a)}>
                      {a.disabled_at ? 'Enable' : 'Disable'}
                    </Button>
                  </td>
                </tr>
              ))}
              {announcements.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                    No announcements yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function EmailOrgSection({ selectedOrgId }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!selectedOrgId) {
      toast.error('Select an organization first (Organizations tab).');
      return;
    }
    if (!subject.trim() || !body.trim()) {
      toast.error('Subject and body are required.');
      return;
    }
    if (reason.trim().length < 4) {
      toast.error('Audit reason must be at least 4 characters.');
      return;
    }
    setSending(true);
    try {
      const r = await v2Admin.emailOrg(selectedOrgId, {
        subject: subject.trim(),
        body: body.trim(),
        reason: reason.trim(),
      });
      toast.success(`Sent to ${r.recipients?.length || 0} owner(s)`);
      setSubject('');
      setBody('');
      setReason('');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="app-card border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Email organization owners</CardTitle>
        <CardDescription>
          Sends to the owner(s) of the selected organization.{' '}
          {selectedOrgId ? (
            <span>
              Target org: <code>{selectedOrgId}</code>
            </span>
          ) : (
            <span className="text-destructive">No org selected — pick one in the Organizations tab.</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Email subject" />
        <textarea
          aria-label="Email body"
          className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message body…"
        />
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Audit reason (4+ chars)"
          aria-label="Audit reason"
        />
        <Button type="button" onClick={send} disabled={sending || !selectedOrgId}>
          {sending ? 'Sending…' : 'Send email'}
        </Button>
      </CardContent>
    </Card>
  );
}

function BroadcastSection() {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error('Subject and body are required.');
      return;
    }
    if (reason.trim().length < 4) {
      toast.error('Audit reason must be at least 4 characters.');
      return;
    }
    if (confirm !== 'SEND_ALL') {
      toast.error('Type SEND_ALL to confirm a broadcast to every org owner.');
      return;
    }
    setSending(true);
    try {
      const r = await v2Admin.broadcastEmail({
        subject: subject.trim(),
        body: body.trim(),
        reason: reason.trim(),
        confirm: 'SEND_ALL',
      });
      toast.success(`Broadcast sent to ${r.sentCount}/${r.recipientCount} owners`);
      setSubject('');
      setBody('');
      setReason('');
      setConfirm('');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to send broadcast');
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="app-card border-destructive/40">
      <CardHeader>
        <CardTitle className="text-lg">Broadcast to all org owners</CardTitle>
        <CardDescription>
          High-blast-radius action. Emails every organization owner. Type <code>SEND_ALL</code> to confirm.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Broadcast subject" />
        <textarea
          aria-label="Broadcast body"
          className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message body…"
        />
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Audit reason (4+ chars)"
          aria-label="Broadcast audit reason"
        />
        <Input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Type SEND_ALL to confirm"
          aria-label="Broadcast confirmation"
        />
        <Button
          type="button"
          variant="destructive"
          onClick={send}
          disabled={sending || confirm !== 'SEND_ALL'}
        >
          {sending ? 'Sending…' : 'Send broadcast'}
        </Button>
      </CardContent>
    </Card>
  );
}

function MarketingConsentSection() {
  const [filter, setFilter] = useState('opted_in');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const limit = 50;

  const reload = (nextOffset = offset) => {
    setLoading(true);
    return v2Admin
      .marketingConsent({ filter, q: q.trim() || undefined, limit, offset: nextOffset })
      .then((r) => {
        setRows(r.users || []);
        setSummary(r.summary || null);
        setTotal(r.pagination?.total || 0);
        setOffset(nextOffset);
      })
      .catch(() => toast.error('Failed to load marketing consent data'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const exportCsv = () => {
    if (!rows.length) {
      toast.error('Nothing to export on this page.');
      return;
    }
    const header = ['email', 'display_name', 'marketing_opt_in', 'prefs_updated_at', 'last_opt_in_at', 'created_at'];
    const lines = [
      header.join(','),
      ...rows.map((u) =>
        [
          u.email,
          (u.displayName || '').replace(/"/g, '""'),
          u.marketingEmail ? 'yes' : 'no',
          u.prefsUpdatedAt || '',
          u.lastOptInAt || '',
          u.createdAt || '',
        ]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marketing-consent-${filter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="app-card overflow-hidden border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Marketing email opt-ins</CardTitle>
        <CardDescription>
          Users who agreed to product updates and announcements. Source: account signup checkbox and Settings → Account
          preferences. Consent changes are also stored in the audit trail.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary && (
          <div className="flex flex-wrap gap-3 text-sm">
            <Badge variant="outline">{summary.optedIn?.toLocaleString()} opted in</Badge>
            <Badge variant="secondary">{summary.optedOut?.toLocaleString()} opted out</Badge>
            <Badge variant="secondary">{summary.total?.toLocaleString()} total users</Badge>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'opted_in', label: 'Opted in' },
            { id: 'opted_out', label: 'Opted out' },
            { id: 'all', label: 'All users' },
          ].map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={filter === opt.id ? 'default' : 'outline'}
              onClick={() => setFilter(opt.id)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search email or name…"
            aria-label="Search marketing consent users"
            className="max-w-xs"
          />
          <Button type="button" size="sm" variant="outline" onClick={() => reload(0)}>
            Search
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
            Export page CSV
          </Button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Last opt-in</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    No users match this filter.
                  </td>
                </tr>
              ) : (
                rows.map((u) => (
                  <tr key={u.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2 text-muted-foreground">{u.displayName || '—'}</td>
                    <td className="px-3 py-2">
                      {u.marketingEmail ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Opted in</Badge>
                      ) : (
                        <Badge variant="secondary">Opted out</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDateTime(u.prefsUpdatedAt)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDateTime(u.lastOptInAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > limit && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={offset <= 0 || loading} onClick={() => reload(Math.max(0, offset - limit))}>
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={offset + limit >= total || loading}
                onClick={() => reload(offset + limit)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CommsTab({ selectedOrgId }) {
  return (
    <div className="space-y-4">
      <EmailSettingsSection />
      <MarketingConsentSection />
      <AnnouncementsSection />
      <div className="grid gap-4 lg:grid-cols-2">
        <EmailOrgSection selectedOrgId={selectedOrgId} />
        <BroadcastSection />
      </div>
    </div>
  );
}

export default CommsTab;
