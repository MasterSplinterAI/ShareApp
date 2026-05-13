import { Globe, ChevronDown, Check, Copy, Link2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';

export default function MeetingJoinCard({
  meetingLanguages,
  name,
  setName,
  selectedLanguage,
  setSelectedLanguage,
  langOpen,
  setLangOpen,
  onJoinAsHost,
  hostShareUrl,
  onCopyHostLink,
}) {
  return (
    <Card className="app-card border-border/60">
      <CardHeader>
        <CardTitle className="text-base">Join as host</CardTitle>
        <CardDescription>
          In the meeting, use the <strong className="text-foreground">People</strong> button in the bottom bar to mute or remove participants.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="host-name">Your name</Label>
          <Input id="host-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Host display name" />
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-1">
            <Globe className="h-3.5 w-3.5" />
            My language (speak &amp; hear)
          </Label>
          <Popover open={langOpen} onOpenChange={setLangOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between font-normal">
                <span>{meetingLanguages.find((l) => l.code === selectedLanguage)?.name || selectedLanguage}</span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
              <div className="max-h-52 overflow-y-auto py-1">
                {meetingLanguages.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => {
                      setSelectedLanguage(lang.code);
                      setLangOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <span>{lang.name}</span>
                    {selectedLanguage === lang.code && <Check className="h-4 w-4 text-primary" />}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <Button type="button" size="lg" className="w-full" onClick={onJoinAsHost}>
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
                className="h-9 truncate font-mono text-xs"
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
      </CardContent>
    </Card>
  );
}
