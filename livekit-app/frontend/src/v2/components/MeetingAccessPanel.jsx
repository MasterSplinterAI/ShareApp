import { ExternalLink, Copy } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';

export default function MeetingAccessPanel({
  meeting,
  policy,
  onPatchPolicy,
  canManageTranscriptPolicy,
  showGuestUrl,
  showPolicyToggles = true,
  guestUrlNeedsToken,
  guestLinkMeta,
  onCopyGuestUrl,
}) {
  return (
    <div className="space-y-6">
      {showPolicyToggles && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/40 px-3 py-3">
            <div>
              <Label className="text-sm">Require host before guests enter</Label>
              <p className="text-xs text-muted-foreground">Guests wait in the lobby until you join.</p>
            </div>
            <Switch checked={!!policy.host_required_to_start} onCheckedChange={(v) => onPatchPolicy({ host_required_to_start: v })} />
          </div>
          {canManageTranscriptPolicy && (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/40 px-3 py-3">
              <div>
                <Label className="text-sm">Save transcript on server</Label>
                <p className="text-xs text-muted-foreground">Host session uploads finalized captions when enabled.</p>
              </div>
              <Switch checked={!!policy.store_transcripts} onCheckedChange={(v) => onPatchPolicy({ store_transcripts: v })} />
            </div>
          )}
        </div>
      )}
      {showGuestUrl && (
        <div>
          <p className="text-xs text-muted-foreground">
            Share this secure invite link with guests — it includes a token in the URL.
          </p>
          {guestLinkMeta?.expiryLabel && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{guestLinkMeta.expiryLabel}</span>
              {guestLinkMeta.expiryDetail ? ` — ${guestLinkMeta.expiryDetail}` : ''}
            </p>
          )}
          {guestUrlNeedsToken && (
            <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-xs text-amber-800 dark:text-amber-200">
              Invite tokens are required, but no active invite link was found. Create a new invite in Meeting settings →
              Advanced invites.
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              readOnly
              aria-label="Guest join link"
              value={meeting.joinUrl || ''}
              onFocus={(e) => e.currentTarget.select()}
              spellCheck={false}
              className="h-9 min-w-0 flex-1 truncate font-mono text-xs"
            />
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={onCopyGuestUrl}>
              <Copy className="h-4 w-4" />
              Copy
            </Button>
            {meeting.joinUrl && (
              <Button variant="outline" size="sm" className="gap-1" asChild>
                <a href={meeting.joinUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Open
                </a>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
