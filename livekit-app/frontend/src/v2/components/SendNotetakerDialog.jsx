import { useEffect, useMemo, useState } from 'react';
import { Bot, CalendarClock, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { v2Notetaker } from '../../services/apiV2';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { DatetimePicker, getNextRoundedScheduleDate } from '../../components/ui/datetime-picker';

const RECAP_LANGUAGES = [
  { value: 'spoken', label: 'Keep original spoken language' },
  { value: 'en', label: 'English (auto-translate)' },
  { value: 'es', label: 'Spanish (auto-translate)' },
  { value: 'fr', label: 'French (auto-translate)' },
  { value: 'de', label: 'German (auto-translate)' },
  { value: 'pt', label: 'Portuguese (auto-translate)' },
  { value: 'ja', label: 'Japanese (auto-translate)' },
  { value: 'zh-CN', label: 'Mandarin Chinese (auto-translate)' },
];

export function detectExternalMeetingPlatformClient(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3}|lookup\/)/i.test(text)) {
    return { platform: 'google_meet', label: 'Google Meet' };
  }
  if (/teams\.(microsoft|live)\.com\/(l\/meetup-join\/|meet\/|v2\/)/i.test(text)) {
    return { platform: 'ms_teams', label: 'Microsoft Teams' };
  }
  if (/(?:[a-z0-9-]+\.)?zoom\.us\/(?:j|w|s|my)\//i.test(text)) {
    return { platform: 'zoom', label: 'Zoom' };
  }
  if (/(?:[a-z0-9-]+\.)?webex\.com\/(?:meet\/|join\/|wbxmjs\/joinservice)/i.test(text)) {
    return { platform: 'webex', label: 'Webex' };
  }
  return null;
}

export default function SendNotetakerDialog({
  open,
  onOpenChange,
  initialUrl = '',
  defaultFirstName = 'Lalia',
  onDispatched,
}) {
  const [url, setUrl] = useState(initialUrl);
  const [title, setTitle] = useState('');
  const [botDisplayName, setBotDisplayName] = useState(`${defaultFirstName}'s Lalia Notetaker`);
  const [autoRecapMode, setAutoRecapMode] = useState('host_only');
  const [recapLanguage, setRecapLanguage] = useState('spoken');
  const [attendeeEmails, setAttendeeEmails] = useState('');
  const [scheduleLater, setScheduleLater] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(() => getNextRoundedScheduleDate());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl || '');
      setBotDisplayName(`${defaultFirstName || 'Lalia'}'s Lalia Notetaker`);
    }
  }, [open, initialUrl, defaultFirstName]);

  const detected = useMemo(() => detectExternalMeetingPlatformClient(url), [url]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim()) {
      toast.error('Paste a Google Meet, Microsoft Teams, Zoom, or Webex meeting link');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        url: url.trim(),
        title: title.trim() || undefined,
        botDisplayName: botDisplayName.trim() || undefined,
        autoRecapMode,
        recapLanguage: recapLanguage === 'spoken' ? '' : recapLanguage,
        attendeeEmails: autoRecapMode === 'attendees' ? attendeeEmails : undefined,
        scheduledFor: scheduleLater && scheduledDate ? scheduledDate.toISOString() : undefined,
      };
      const res = await v2Notetaker.createSession(payload);
      toast.success(
        scheduleLater
          ? `Scheduled AI Notetaker for ${res.platformLabel}`
          : `Sending AI Notetaker to ${res.platformLabel}…`
      );
      onOpenChange(false);
      if (onDispatched) onDispatched(res);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not dispatch AI Notetaker');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Send AI Notetaker to Meet, Teams, or Zoom
          </DialogTitle>
          <DialogDescription>
            Lalia joins as a notetaker participant, records the audio file, captures speaker-attributed transcripts, and generates AI summaries.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="notetaker-url">Google Meet, Microsoft Teams, Zoom, or Webex link</Label>
              {detected && (
                <Badge variant="success" className="gap-1 text-[11px]">
                  <CheckCircle2 className="h-3 w-3" />
                  {detected.label}
                </Badge>
              )}
            </div>
            <Input
              id="notetaker-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://meet.google.com/abc-defg-hij or https://zoom.us/j/1234567890"
              autoFocus
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="notetaker-title">Meeting title (optional)</Label>
              <Input
                id="notetaker-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Weekly Client Sync"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notetaker-name">Bot name in lobby</Label>
              <Input
                id="notetaker-name"
                value={botDisplayName}
                onChange={(e) => setBotDisplayName(e.target.value)}
                placeholder="Lalia Notetaker"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Auto-email AI recap</Label>
              <Select value={autoRecapMode} onValueChange={setAutoRecapMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="host_only">Only me</SelectItem>
                  <SelectItem value="workspace">My workspace team</SelectItem>
                  <SelectItem value="attendees">Me + attendee emails</SelectItem>
                  <SelectItem value="off">Don&apos;t email automatically</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Summary &amp; transcript language</Label>
              <Select value={recapLanguage} onValueChange={setRecapLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECAP_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {autoRecapMode === 'attendees' && (
            <div className="space-y-1.5">
              <Label htmlFor="notetaker-attendees">Attendee emails (comma-separated)</Label>
              <Input
                id="notetaker-attendees"
                value={attendeeEmails}
                onChange={(e) => setAttendeeEmails(e.target.value)}
                placeholder="alex@company.com, maria@client.com"
              />
            </div>
          )}

          <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
            <label className="flex cursor-pointer items-center justify-between gap-3 text-xs font-medium text-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4 text-primary" />
                Schedule for an upcoming start time instead of joining right now
              </span>
              <input
                type="checkbox"
                checked={scheduleLater}
                onChange={(e) => setScheduleLater(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
            </label>
            {scheduleLater && (
              <div className="mt-3">
                <DatetimePicker
                  value={scheduledDate}
                  onChange={setScheduledDate}
                  placeholder="Pick meeting start time"
                />
              </div>
            )}
          </div>

          <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">Using Proton Mail, iCloud, or any calendar?</strong>{' '}
            Add <code className="font-mono text-primary">notes@lalia.cloud</code> as a guest or forward any meeting invite from your Lalia email—we&apos;ll schedule the Notetaker automatically.
          </p>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {scheduleLater ? 'Schedule Notetaker' : 'Send Notetaker now'}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
