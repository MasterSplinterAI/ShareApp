import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';
import { Loader2, Mail, ChevronDown, ChevronUp } from 'lucide-react';
import { v2Meetings } from '../../services/apiV2';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  offsetsFromToggles,
  reminderOffsetLabel,
  rsvpStatusMeta,
  summarizeGuestRsvps,
  togglesFromOffsets,
} from '../lib/guestInvitePrefsUi';

function parseInviteDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  const raw = String(value).trim();
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = isValid(parseISO(normalized)) ? parseISO(normalized) : new Date(raw);
  return isValid(d) ? d : null;
}

function formatInviteWhen(value) {
  const d = parseInviteDate(value);
  if (!d) return null;
  try {
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return format(d, 'MMM d, yyyy');
  }
}

function formatInviteExact(value) {
  const d = parseInviteDate(value);
  if (!d) return null;
  try {
    return format(d, 'MMM d, yyyy · h:mm a');
  } catch {
    return null;
  }
}

/**
 * Invite guests by email + clear RSVP roster for the meeting.
 */
export default function MeetingEmailInvites({ meetingId }) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [resendingQueued, setResendingQueued] = useState(false);
  const [guests, setGuests] = useState([]);
  const [settings, setSettings] = useState(null);
  const [useAccountDefaults, setUseAccountDefaults] = useState(true);
  const [reminderDayBefore, setReminderDayBefore] = useState(true);
  const [reminder15Min, setReminder15Min] = useState(true);
  const [savingReminders, setSavingReminders] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showReminders, setShowReminders] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    return v2Meetings
      .listEmailInvites(meetingId)
      .then((r) => {
        setGuests(r.guests || []);
        const s = r.settings || null;
        setSettings(s);
        if (s) {
          setUseAccountDefaults(Boolean(s.usingAccountDefaults));
          const toggles = togglesFromOffsets(s.reminderOffsets || []);
          setReminderDayBefore(toggles.dayBefore);
          setReminder15Min(toggles.fifteenMin);
        }
      })
      .catch(() => {
        setLoadError('Could not load guest invites.');
      })
      .finally(() => setLoading(false));
  }, [meetingId]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => summarizeGuestRsvps(guests), [guests]);

  const sortedGuests = useMemo(() => {
    const rank = { declined: 0, pending: 1, needs_action: 1, tentative: 2, accepted: 3 };
    return [...guests].sort((a, b) => {
      const ra = rank[rsvpStatusMeta(a.rsvp_status).key] ?? 1;
      const rb = rank[rsvpStatusMeta(b.rsvp_status).key] ?? 1;
      if (ra !== rb) return ra - rb;
      return String(a.email || '').localeCompare(String(b.email || ''));
    });
  }, [guests]);

  const send = async () => {
    const emails = value
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (!emails.length) {
      toast.error('Enter at least one email address');
      return;
    }
    setSending(true);
    try {
      const res = await v2Meetings.sendEmailInvites(meetingId, emails);
      if (res.message) {
        const failed = (res.results || []).filter((r) => !r.sent);
        toast(res.message, {
          icon: failed.length ? '⚠️' : 'ℹ️',
          duration: 8000,
        });
      } else {
        const sent = (res.results || []).filter((r) => r.sent).length;
        toast.success(`Invite sent to ${sent} guest${sent === 1 ? '' : 's'}`);
      }
      setValue('');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to send invites');
    } finally {
      setSending(false);
    }
  };

  const resendQueued = async () => {
    setResendingQueued(true);
    try {
      const res = await v2Meetings.resendQueuedEmailInvites(meetingId);
      if (res.message) {
        const failed = (res.results || []).filter((r) => !r.sent && !r.skipped);
        toast(res.message, {
          icon: failed.length ? '⚠️' : 'ℹ️',
          duration: 8000,
        });
      } else {
        const sent = (res.results || []).filter((r) => r.sent).length;
        toast.success(`Sent ${sent} queued invite${sent === 1 ? '' : 's'}`);
      }
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to resend queued invites');
    } finally {
      setResendingQueued(false);
    }
  };

  const saveReminderSettings = async () => {
    setSavingReminders(true);
    try {
      const body = useAccountDefaults
        ? { useAccountDefaults: true }
        : { reminderOffsets: offsetsFromToggles({ dayBefore: reminderDayBefore, fifteenMin: reminder15Min }) };
      if (!useAccountDefaults && !body.reminderOffsets.length) {
        toast.error('Select at least one reminder');
        return;
      }
      const res = await v2Meetings.updateEmailInviteReminderSettings(meetingId, body);
      setSettings(res.settings || null);
      toast.success('Reminder schedule saved');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save reminder settings');
    } finally {
      setSavingReminders(false);
    }
  };

  const activeOffsets = settings?.reminderOffsets || [];
  const reminderSummary = activeOffsets.map(reminderOffsetLabel).join(' and ');

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={`guest-emails-${meetingId}`}
            aria-label="Guest email addresses"
            inputMode="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="guest@company.com, another@company.com"
            className="h-9 min-w-0 flex-1"
            onKeyDown={(e) => e.key === 'Enter' && !sending && send()}
          />
          <Button type="button" size="sm" className="gap-1.5" disabled={sending} onClick={send}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Send invites
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Guests get the join link by email
          {settings?.timezone ? ` (times in ${settings.timezone})` : ''}. No account needed.{' '}
          <Link to="/v2/app/settings" className="text-primary hover:underline">
            Account settings
          </Link>
        </p>
      </div>

      <div>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setShowReminders((v) => !v)}
          aria-expanded={showReminders}
        >
          <span>
            Reminder schedule
            {reminderSummary ? `: ${reminderSummary}` : ''}
          </span>
          {showReminders ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {showReminders && (
          <div className="mt-2 space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="flex items-start gap-2">
              <input
                id={`use-account-reminders-${meetingId}`}
                type="checkbox"
                checked={useAccountDefaults}
                onChange={(e) => setUseAccountDefaults(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <Label htmlFor={`use-account-reminders-${meetingId}`} className="cursor-pointer text-xs font-normal leading-snug">
                Use my account defaults
                {settings?.accountDefaults?.length
                  ? ` (${settings.accountDefaults.map(reminderOffsetLabel).join(', ')})`
                  : ''}
              </Label>
            </div>
            {!useAccountDefaults && (
              <div className="space-y-2 pl-1">
                <div className="flex items-start gap-2">
                  <input
                    id={`reminder-day-${meetingId}`}
                    type="checkbox"
                    checked={reminderDayBefore}
                    onChange={(e) => setReminderDayBefore(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                  />
                  <Label htmlFor={`reminder-day-${meetingId}`} className="cursor-pointer text-xs font-normal">
                    1 day before
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <input
                    id={`reminder-15m-${meetingId}`}
                    type="checkbox"
                    checked={reminder15Min}
                    onChange={(e) => setReminder15Min(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                  />
                  <Label htmlFor={`reminder-15m-${meetingId}`} className="cursor-pointer text-xs font-normal">
                    15 minutes before
                  </Label>
                </div>
              </div>
            )}
            <Button type="button" size="sm" variant="secondary" disabled={savingReminders} onClick={saveReminderSettings}>
              {savingReminders ? 'Saving…' : 'Save reminder schedule'}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-border/60 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Guest list</h3>
            <p className="text-xs text-muted-foreground">Who was invited and how they replied.</p>
          </div>
          {summary.total > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{summary.total} invited</Badge>
              {summary.accepted > 0 && <Badge variant="success">{summary.accepted} accepted</Badge>}
              {summary.declined > 0 && <Badge variant="destructive">{summary.declined} declined</Badge>}
              {summary.maybe > 0 && <Badge variant="warning">{summary.maybe} maybe</Badge>}
              {summary.pending > 0 && <Badge variant="muted">{summary.pending} pending</Badge>}
              {summary.queued > 0 && <Badge variant="warning">{summary.queued} queued</Badge>}
            </div>
          )}
        </div>

        {summary.queued > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <span className="text-xs text-amber-800 dark:text-amber-200">
              {summary.queued} invite{summary.queued === 1 ? '' : 's'} queued — email not sent yet
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 gap-1.5 text-xs"
              disabled={resendingQueued || sending}
              onClick={resendQueued}
            >
              {resendingQueued ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
              Send queued
            </Button>
          </div>
        )}

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading guests…
          </p>
        )}
        {!loading && loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {!loading && !loadError && guests.length === 0 && (
          <p className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
            No guests invited yet. Add emails above to send join links.
          </p>
        )}

        {!loading && sortedGuests.length > 0 && (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-background/60">
            {sortedGuests.map((g) => {
              const rsvp = rsvpStatusMeta(g.rsvp_status);
              const invitedWhen = formatInviteWhen(g.sent_at || g.created_at);
              const invitedExact = formatInviteExact(g.sent_at || g.created_at);
              const rsvpWhen = formatInviteWhen(g.rsvp_updated_at);
              const rsvpExact = formatInviteExact(g.rsvp_updated_at);
              const sentReminders = g.reminders_sent ? Object.keys(g.reminders_sent) : [];
              return (
                <li key={g.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium text-foreground">{g.email}</p>
                    <p className="text-xs text-muted-foreground" title={invitedExact || undefined}>
                      {g.sent_at ? 'Invited' : 'Queued'}
                      {invitedWhen ? ` ${invitedWhen}` : ''}
                      {rsvp.key !== 'pending' && rsvpWhen ? ` · replied ${rsvpWhen}` : ''}
                    </p>
                    {sentReminders.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Reminders sent:{' '}
                        {sentReminders.map((offset) => reminderOffsetLabel(Number(offset))).join(', ')}
                      </p>
                    )}
                    {rsvpExact && rsvp.key !== 'pending' && (
                      <p className="sr-only">RSVP updated {rsvpExact}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Badge variant={rsvp.variant}>{rsvp.label}</Badge>
                    {!g.sent_at && <Badge variant="warning">Email queued</Badge>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
