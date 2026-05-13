import { Globe, ChevronDown, Check } from 'lucide-react';
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
      </CardContent>
    </Card>
  );
}
