import { Copy, Link2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

/**
 * Compact host join actions. Name, language, and devices are collected once on
 * the prejoin screen — this popover only starts that flow.
 */
export default function MeetingJoinCard({ onJoinAsHost, hostShareUrl, onCopyHostLink }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        You&apos;ll pick your language and check camera/mic on the next screen. In the meeting, use{' '}
        <strong className="text-foreground">People</strong> in the bottom bar to manage participants.
      </p>
      <Button type="button" className="w-full" onClick={onJoinAsHost}>
        Continue to join
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
              aria-label="Host link"
              value={hostShareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="h-8 min-w-0 flex-1 truncate font-mono text-xs"
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
