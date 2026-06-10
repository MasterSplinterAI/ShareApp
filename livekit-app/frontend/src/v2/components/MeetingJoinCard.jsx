import { Globe, Copy, Link2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';

/**
 * Compact "Join as host" form. Rendered inside the header popover on the
 * meeting detail page (no Card chrome of its own).
 */
export default function MeetingJoinCard({
  meetingLanguages,
  name,
  setName,
  selectedLanguage,
  setSelectedLanguage,
  onJoinAsHost,
  hostShareUrl,
  onCopyHostLink,
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        In the meeting, use the <strong className="text-foreground">People</strong> button in the bottom bar to mute or
        remove participants.
      </p>
      <div className="space-y-2">
        <Label htmlFor="host-name">Your name</Label>
        <Input id="host-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Host display name" />
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-1">
          <Globe className="h-3.5 w-3.5" />
          My language (speak &amp; hear)
        </Label>
        <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {meetingLanguages.map((lang) => (
              <SelectItem key={lang.code} value={lang.code}>
                {lang.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="button" className="w-full" onClick={onJoinAsHost}>
        Join as host
      </Button>
      {hostShareUrl && onCopyHostLink ? (
        <div className="rounded-md border border-dashed border-border bg-muted/40 p-3">
          <Label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" />
            Host link (only works for the meeting host)
          </Label>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={hostShareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="h-8 truncate font-mono text-xs"
            />
            <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={onCopyHostLink}>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Save this for later or send to yourself — opening it while signed in jumps straight into the room as host.
          </p>
        </div>
      ) : null}
    </div>
  );
}
