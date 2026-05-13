import { Radio } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';

export default function MeetingPresenceCard({ presence }) {
  return (
    <Card className="app-card border-border/60">
      <CardHeader className="border-b border-border/60 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4 shrink-0 text-emerald-500" />
          In the room
        </CardTitle>
        <CardDescription>
          LiveKit snapshot (refreshes about every 12s while this meeting is scheduled or live). Agents are not listed.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {presence.humanCount === 0 ? (
          <p className="text-sm text-muted-foreground">No participants connected right now.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(presence.participants || []).map((p) => (
              <span
                key={p.identity}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-foreground"
              >
                <span className="truncate font-mono text-muted-foreground">{p.identity}</span>
                {p.name && p.name !== p.identity && <span className="truncate text-muted-foreground">· {p.name}</span>}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
