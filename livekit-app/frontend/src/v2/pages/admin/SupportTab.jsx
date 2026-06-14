import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Support } from '../../../services/apiV2';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Badge } from '../../../components/ui/badge';
import { cn } from '../../../lib/utils';
import { fmtDateTime } from './formatters';

const STATUS_OPTIONS = ['open', 'waiting_user', 'escalated', 'resolved', 'closed'];

function categoryLabel(category) {
  if (category === 'bug_report') return 'Bug';
  if (category === 'feature_request') return 'Feature';
  return 'Support';
}

export function SupportTab({ initialTicketNumber }) {
  const [tickets, setTickets] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const reloadList = () =>
    v2Support
      .adminListTickets(filterStatus ? { status: filterStatus } : {})
      .then((r) => setTickets(r.tickets || []))
      .catch(() => toast.error('Failed to load tickets'));

  useEffect(() => {
    reloadList();
  }, [filterStatus]);

  useEffect(() => {
    if (!initialTicketNumber || tickets.length === 0) return;
    const match = tickets.find((t) => t.publicNumber === Number(initialTicketNumber));
    if (match) setSelectedId(match.id);
  }, [initialTicketNumber, tickets]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetail(null);
    v2Support
      .adminTicketDetail(selectedId)
      .then(setDetail)
      .catch(() => toast.error('Failed to load ticket'));
  }, [selectedId]);

  const sendReply = async (e) => {
    e.preventDefault();
    if (!reply.trim() || !selectedId) return;
    setBusy(true);
    try {
      await v2Support.adminReply(selectedId, { body: reply.trim() });
      toast.success('Reply sent');
      setReply('');
      const fresh = await v2Support.adminTicketDetail(selectedId);
      setDetail(fresh);
      reloadList();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reply failed');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await v2Support.adminPatchStatus(selectedId, { status });
      toast.success(`Status → ${status}`);
      const fresh = await v2Support.adminTicketDetail(selectedId);
      setDetail(fresh);
      reloadList();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="app-card border-border/60 lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg">Support inbox</CardTitle>
          <CardDescription>New tickets from Help widget. Telegram alerts fire on create.</CardDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              type="button"
              size="sm"
              variant={filterStatus === '' ? 'default' : 'outline'}
              onClick={() => setFilterStatus('')}
            >
              All
            </Button>
            {STATUS_OPTIONS.map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={filterStatus === s ? 'default' : 'outline'}
                onClick={() => setFilterStatus(s)}
              >
                {s.replace('_', ' ')}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="max-h-[32rem] space-y-2 overflow-y-auto border-t border-border/60 pt-4">
          {tickets.length === 0 && <p className="text-sm text-muted-foreground">No tickets yet.</p>}
          {tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                selectedId === t.id
                  ? 'border-primary/50 bg-primary/5'
                  : 'border-border/60 hover:bg-muted/40'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">#{t.publicNumber}</span>
                <Badge variant="secondary" className="text-[10px] capitalize">
                  {t.status.replace('_', ' ')}
                </Badge>
              </div>
              <p className="mt-1 line-clamp-1 text-foreground">{t.subject || '—'}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {categoryLabel(t.category)} · {fmtDateTime(t.createdAt)}
              </p>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card className="app-card border-border/60 lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-lg">
            {detail?.ticket ? `Ticket #${detail.ticket.publicNumber}` : 'Select a ticket'}
          </CardTitle>
          {detail?.ticket && (
            <CardDescription>
              {categoryLabel(detail.ticket.category)}
              {detail.submitterEmail ? ` · ${detail.submitterEmail}` : ''}
              {detail.ticket.severity ? ` · severity ${detail.ticket.severity}` : ''}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4 border-t border-border/60 pt-4">
          {!detail?.ticket && (
            <p className="text-sm text-muted-foreground">Choose a ticket from the inbox to view the thread.</p>
          )}
          {detail?.ticket && (
            <>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.filter((s) => s !== detail.ticket.status).map((s) => (
                  <Button key={s} type="button" size="sm" variant="outline" disabled={busy} onClick={() => setStatus(s)}>
                    Mark {s.replace('_', ' ')}
                  </Button>
                ))}
              </div>
              {detail.ticket.context && (
                <pre className="max-h-32 overflow-auto rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                  {JSON.stringify(detail.ticket.context, null, 2)}
                </pre>
              )}
              <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-border/60 p-3">
                {(detail.messages || []).map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      'rounded-md px-3 py-2 text-sm',
                      m.authorType === 'staff' ? 'bg-primary/10' : 'bg-muted/50'
                    )}
                  >
                    <p className="text-xs font-medium capitalize text-muted-foreground">
                      {m.authorType}
                      {m.authorId ? ` · ${m.authorId}` : ''} · {fmtDateTime(m.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-foreground">{m.body}</p>
                  </div>
                ))}
              </div>
              <form onSubmit={sendReply} className="space-y-2">
                <Label htmlFor="support-reply">Reply to user</Label>
                <textarea
                  id="support-reply"
                  className="flex min-h-[100px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Your reply (emailed to the user)…"
                />
                <Button type="submit" disabled={busy || !reply.trim()}>
                  {busy ? 'Sending…' : 'Send reply'}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
