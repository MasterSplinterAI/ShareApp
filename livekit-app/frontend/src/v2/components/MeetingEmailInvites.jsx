import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Mail, Check, Clock } from 'lucide-react';
import { v2Meetings } from '../../services/apiV2';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

/**
 * Invite guests by email: sends each address the meeting's secure join link
 * immediately, and the server emails a reminder shortly before the scheduled
 * start. Links for scheduled meetings stay valid through the meeting.
 */
export default function MeetingEmailInvites({ meetingId }) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [guests, setGuests] = useState([]);

  const load = useCallback(() => {
    v2Meetings
      .listEmailInvites(meetingId)
      .then((r) => setGuests(r.guests || []))
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
        toast(res.message, { icon: 'ℹ️', duration: 6000 });
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

  return (
    <div className="space-y-3">
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
        Guests get the join link now and a reminder before the meeting starts. No account needed.
      </p>
      {guests.length > 0 && (
        <ul className="space-y-1 border-t border-border/60 pt-2">
          {guests.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{g.email}</span>
              <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                {g.sent_at ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <Check className="h-3 w-3" /> invited
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <Clock className="h-3 w-3" /> queued
                  </span>
                )}
                {g.reminder_sent_at && (
                  <span className="inline-flex items-center gap-1">
                    <Check className="h-3 w-3" /> reminded
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
