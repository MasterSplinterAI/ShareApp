import { ExternalLink, Copy } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';

export default function MeetingAccessPanel({
  meeting,
  titleEdit,
  setTitleEdit,
  onTitleBlur,
  policy,
  onPatchPolicy,
  canManageTranscriptPolicy,
  showGuestUrl,
  showTitleRow = true,
  showPolicyToggles = true,
  guestUrlNeedsToken,
  onCopyGuestUrl,
}) {
  return (
    <div className="space-y-6">
      {showTitleRow && (
        <div className="space-y-2">
          <Label htmlFor="meeting-title">Title</Label>
          <Input
            id="meeting-title"
            value={titleEdit}
            onChange={(e) => setTitleEdit(e.target.value)}
            onBlur={onTitleBlur}
            className="max-w-xl"
          />
          <p className="text-xs text-muted-foreground">Changes save when you leave this field.</p>
        </div>
      )}
      {showPolicyToggles && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/40 px-3 py-3">
            <div>
              <Label className="text-sm">Require host before guests enter</Label>
              <p className="text-xs text-muted-foreground">Guests wait in the lobby until you join.</p>
            </div>
            <Switch checked={!!policy.host_required_to_start} onCheckedChange={(v) => onPatchPolicy({ host_required_to_start: v })} />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/40 px-3 py-3">
            <div>
              <Label className="text-sm">Require invite token (?i=)</Label>
              <p className="text-xs text-muted-foreground">Guests need a full invite URL when enabled.</p>
            </div>
            <Switch checked={!!policy.require_invite_token} onCheckedChange={(v) => onPatchPolicy({ require_invite_token: v })} />
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
          <Label className="text-xs text-muted-foreground">Guest join URL</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Anyone with this link can join (plus <code className="text-foreground/80">?i=</code> when invite tokens are on).
          </p>
          {guestUrlNeedsToken && (
            <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-xs text-amber-800 dark:text-amber-200">
              Invite tokens are required, but no active invite link was found. Create a new invite below.
            </p>
          )}
          <textarea
            readOnly
            rows={4}
            value={meeting.joinUrl || ''}
            spellCheck={false}
            className="mt-2 w-full min-h-[5.5rem] resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs break-all text-foreground"
          />
          <div className="mt-2 flex flex-wrap gap-2">
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
