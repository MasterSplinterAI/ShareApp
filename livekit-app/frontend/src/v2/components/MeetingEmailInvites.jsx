import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Mail, Check, Clock } from 'lucide-react';
import { v2Meetings } from '../../services/apiV2';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  offsetsFromToggles,
  reminderOffsetLabel,
  togglesFromOffsets,
} from '../lib/guestInvitePrefsUi';

/**
 * Invite guests by email: sends each address the meeting join link immediately
 * (CC'ing the host when enabled), plus scheduled reminders before start.
 */
export default function MeetingEmailInvites({ meetingId }) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [guests, setGuests] = useState([]);
  const [settings, setSettings] = useState(null);
  const [useAccountDefaults, setUseAccountDefaults] = useState(true);
  const [reminderDayBefore, setReminderDayBefore] = useState(true);
  const [reminder15Min, setReminder15Min] = useState(true);
  const [savingReminders, setSavingReminders] = useState(false);

  const load = useCallback(() => {
    v2Meetings
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
      .catch(() => {});
  }, [meetingId]);

  useEffect(() => {
    load();
  }, [load]);

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
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
        Guests get the join link now (you&apos;re CC&apos;d when enabled in account settings) and automatic reminders
        {reminderSummary ? ` ${reminderSummary}` : ' before the meeting'}. Times in emails use your account timezone.
        No account needed for guests.
      </p>

      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
        <p className="text-xs font-medium text-foreground">Reminder schedule for this meeting</p>
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

      {guests.length > 0 && (
        <ul className="space-y-1 border-t border-border/60 pt-2">
          {guests.map((g) => {
            const sentReminders = g.reminders_sent ? Object.keys(g.reminders_sent) : [];
            return (
              <li key={g.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{g.email}</span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-muted-foreground">
                  {g.sent_at ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <Check className="h-3 w-3" /> invited
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <Clock className="h-3 w-3" /> queued
                    </span>
                  )}
                  {sentReminders.map((offset) => (
                    <span key={offset} className="inline-flex items-center gap-1">
                      <Check className="h-3 w-3" /> {reminderOffsetLabel(Number(offset))}
                    </span>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
