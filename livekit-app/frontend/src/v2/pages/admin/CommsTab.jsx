import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { fmtDateTime } from './formatters';

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

export function CommsTab({ selectedOrgId }) {
  return (
    <div className="space-y-4">
      <AnnouncementsSection />
      <div className="grid gap-4 lg:grid-cols-2">
        <EmailOrgSection selectedOrgId={selectedOrgId} />
        <BroadcastSection />
      </div>
    </div>
  );
}

export default CommsTab;
