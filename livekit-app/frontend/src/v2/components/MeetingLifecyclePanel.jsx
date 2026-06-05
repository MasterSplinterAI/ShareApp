import { PhoneOff, Archive, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/button';

export default function MeetingLifecyclePanel({
  meetingStatus,
  canManage,
  canEndMeeting,
  ending,
  onOpenEndDialog,
  onOpenArchiveDialog,
  onOpenDeleteDialog,
  onRestore,
  restoring,
}) {
  if (!canManage) return null;

  const isArchived = meetingStatus === 'archived';

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-muted/30 p-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">Meeting lifecycle</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {isArchived
            ? 'This meeting is archived and hidden from the main list. Restore it or delete permanently.'
            : 'End an active session, archive when done, or permanently delete all meeting data.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {canEndMeeting && !isArchived && (
          <Button type="button" variant="destructive" size="sm" className="gap-2" disabled={ending} onClick={onOpenEndDialog}>
            <PhoneOff className="h-4 w-4" />
            {ending ? 'Ending…' : 'End for everyone'}
          </Button>
        )}
        {!isArchived && (
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={onOpenArchiveDialog}>
            <Archive className="h-4 w-4" />
            Archive
          </Button>
        )}
        {isArchived && (
          <Button type="button" variant="outline" size="sm" className="gap-2" disabled={restoring} onClick={onRestore}>
            <RotateCcw className="h-4 w-4" />
            {restoring ? 'Restoring…' : 'Restore'}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onOpenDeleteDialog}
        >
          <Trash2 className="h-4 w-4" />
          Delete permanently
        </Button>
      </div>
    </div>
  );
}
