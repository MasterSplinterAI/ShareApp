import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/badge';
import { toneToBadgeVariant } from '../lib/meetingState';

export default function MeetingHeader({ meeting, ui, backTo = '/v2/app/meetings' }) {
  return (
    <>
      <Link to={backTo} className="text-sm font-medium text-primary hover:underline">
        ← Meetings
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{meeting.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {ui && (
            <Badge variant={toneToBadgeVariant(ui.tone)} className="uppercase tracking-wide">
              {ui.label}
            </Badge>
          )}
          <span className="text-muted-foreground">
            Room{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{meeting.livekit_room_name}</code>
          </span>
        </div>
        {meeting.scheduled_start && (
          <p className="text-sm text-muted-foreground">
            Scheduled: <span className="text-foreground">{new Date(meeting.scheduled_start).toLocaleString()}</span>
          </p>
        )}
      </header>
    </>
  );
}
