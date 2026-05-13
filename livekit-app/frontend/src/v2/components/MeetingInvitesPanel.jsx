import { ExternalLink, Copy } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';

export default function MeetingInvitesPanel({
  meeting,
  newInviteHours,
  setNewInviteHours,
  newInviteReusable,
  setNewInviteReusable,
  maxInviteHours,
  onCreateInvite,
  onRevokeInvite,
  onCopyInviteUrl,
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Expires in (hours)</Label>
          <Input
            type="number"
            min={1}
            max={maxInviteHours}
            className="w-28"
            value={newInviteHours}
            onChange={(e) => setNewInviteHours(Math.min(maxInviteHours, Math.max(1, Number(e.target.value) || 24)))}
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id="reusable" checked={newInviteReusable} onCheckedChange={setNewInviteReusable} />
          <Label htmlFor="reusable" className="text-sm font-normal">
            Reusable
          </Label>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setNewInviteHours(maxInviteHours)}>
          Max length
        </Button>
        <Button type="button" onClick={onCreateInvite}>
          New invite link
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Longest cap: {Math.round(maxInviteHours / 24)} days from link creation (<code className="text-foreground/70">V2_MAX_INVITE_TTL_DAYS</code>).
      </p>
      <ul className="space-y-3 text-sm">
        {(meeting.invites || []).map((inv) => (
          <li key={inv.id} className="space-y-2 rounded-lg border border-border/60 bg-muted/40 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium text-foreground">{inv.label || 'Link'}</div>
                <div className="text-xs text-muted-foreground">
                  {inv.revoked_at ? (
                    <span className="text-destructive">Revoked</span>
                  ) : (
                    <>
                      Expires {new Date(inv.expires_at).toLocaleString()} · uses {inv.use_count}
                      {inv.reusable ? ' · reusable' : ''}
                    </>
                  )}
                </div>
              </div>
              {!inv.revoked_at && (
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onRevokeInvite(inv.id)}>
                  Revoke
                </Button>
              )}
            </div>
            {inv.joinUrl ? (
              <>
                <textarea
                  readOnly
                  rows={4}
                  value={inv.joinUrl}
                  spellCheck={false}
                  className="w-full min-h-[5rem] resize-y rounded-md border border-input bg-background px-2 py-2 font-mono text-xs break-all"
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => onCopyInviteUrl(inv.joinUrl)}>
                    <Copy className="h-3.5 w-3.5" />
                    Copy URL
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1" asChild>
                    <a href={inv.joinUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </a>
                  </Button>
                </div>
              </>
            ) : (
              !inv.revoked_at && <p className="text-xs text-amber-600 dark:text-amber-400">No guest URL — expired or use limit reached.</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
