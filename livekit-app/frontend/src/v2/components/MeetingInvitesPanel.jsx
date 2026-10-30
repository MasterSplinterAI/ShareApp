import { ExternalLink, Copy } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { expiryOptionsForMeeting, inviteStatusLine } from '../../lib/inviteExpiry';

export default function MeetingInvitesPanel({
  meeting,
  newInviteExpiryMode,
  setNewInviteExpiryMode,
  newInviteCustomHours,
  setNewInviteCustomHours,
  maxInviteDays,
  onCreateInvite,
  onRevokeInvite,
  onCopyInviteUrl,
}) {
  const expiryOptions = expiryOptionsForMeeting(meeting);
  const selectedExpiry = expiryOptions.find((o) => o.value === newInviteExpiryMode) || expiryOptions[0];
  const showCustomHours = newInviteExpiryMode === 'custom_hours';
  const maxCustomHours = Math.max(1, (maxInviteDays ?? 90) * 24);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Expires</Label>
        <Select value={newInviteExpiryMode} onValueChange={setNewInviteExpiryMode}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {expiryOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showCustomHours && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Custom duration (hours)</Label>
            <Input
              type="number"
              min={1}
              max={maxCustomHours}
              className="w-32"
              value={newInviteCustomHours}
              onChange={(e) =>
                setNewInviteCustomHours(Math.min(maxCustomHours, Math.max(1, Number(e.target.value) || 24)))
              }
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setNewInviteCustomHours(maxCustomHours)}>
            Use max
          </Button>
        </div>
      )}
      {selectedExpiry?.hint && (
        <p className="text-xs text-muted-foreground">{selectedExpiry.hint}</p>
      )}
      <div>
        <Button type="button" onClick={onCreateInvite}>
          Create additional invite
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        This creates an additional guest invite link. Longest cap: {maxInviteDays ?? 90} days from scheduled start
        (or from now if unscheduled).
      </p>
      <ul className="space-y-3 text-sm">
        {(meeting.invites || []).map((inv) => (
          <li key={inv.id} className="space-y-2 rounded-lg border border-border/60 bg-muted/40 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium text-foreground">{inv.label || 'Link'}</div>
                <div className="text-xs text-muted-foreground">{inviteStatusLine(inv)}</div>
                {inv.expiryDetail && !inv.revoked_at && (
                  <div className="mt-0.5 text-xs text-muted-foreground/90">{inv.expiryDetail}</div>
                )}
              </div>
              {!inv.revoked_at && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onRevokeInvite(inv.id)}
                >
                  Revoke
                </Button>
              )}
            </div>
            {inv.joinUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  readOnly
                  aria-label={`Invite link${inv.label ? ` for ${inv.label}` : ''}`}
                  value={inv.joinUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  spellCheck={false}
                  className="h-8 min-w-0 flex-1 truncate font-mono text-xs"
                />
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => onCopyInviteUrl(inv.joinUrl)}>
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
                <Button variant="outline" size="sm" className="gap-1" asChild>
                  <a href={inv.joinUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Open
                  </a>
                </Button>
              </div>
            ) : (
              !inv.revoked_at && (
                <p className="text-xs text-amber-600 dark:text-amber-400">No guest URL — expired or use limit reached.</p>
              )
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
