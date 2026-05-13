import { PhoneOff } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';

export default function MeetingDangerPanel({ canEndMeeting, ending, onOpenEndDialog, onOpenArchiveDialog }) {
  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Meeting actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {canEndMeeting && (
          <Button type="button" variant="destructive" className="gap-2" disabled={ending} onClick={onOpenEndDialog}>
            <PhoneOff className="h-4 w-4" />
            {ending ? 'Ending…' : 'End meeting for everyone'}
          </Button>
        )}
        <div>
          <Button type="button" variant="link" className="h-auto p-0 text-amber-600 dark:text-amber-400" onClick={onOpenArchiveDialog}>
            Archive meeting (no new joins)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
