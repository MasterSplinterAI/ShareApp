import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { cn } from '../../../lib/utils';
import { fmtUsd, fmtDateTime } from './formatters';
import { statusBadgeVariant } from './shared';

function meetingDurationLabel(m) {
  if (m.duration_seconds != null) return `${Math.max(1, Math.round(m.duration_seconds / 60))} min`;
  if (m.started_at && m.ended_at) {
    const ms =
      new Date(`${m.ended_at.replace(' ', 'T')}Z`).getTime() -
      new Date(`${m.started_at.replace(' ', 'T')}Z`).getTime();
    if (ms > 0) return `~${Math.round(ms / 60000)} min`;
  }
  if (Number(m.participant_minutes) > 0) return `~${Math.round(m.participant_minutes)} part.-min`;
  return '—';
}

/** Per-meeting cost breakdown — where Gladia-vs-Deepgram (etc.) economics show. */
export function MeetingCostsPanel({ meeting, detail }) {
  return (
    <Card className="app-card border-primary/30">
      <CardHeader>
        <CardTitle className="text-lg">{meeting.title || meeting.livekit_room_name || meeting.id}</CardTitle>
        <CardDescription>
          Cost events for this meeting (room <code>{meeting.livekit_room_name}</code>).
          {detail?.rollup && (
            <span className="block mt-1">
              Rollup total <strong className="tabular-nums">{fmtUsd(detail.rollup.total_cost_usd)}</strong>
              {detail.rollup.duration_seconds != null &&
                ` over ${Math.max(1, Math.round(detail.rollup.duration_seconds / 60))} min`}
              {detail.rollup.computed_at && ` — computed ${fmtDateTime(detail.rollup.computed_at)}`}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      {!detail ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading cost events…</p>
        </CardContent>
      ) : detail.events.length === 0 ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">No cost events recorded for this meeting.</p>
        </CardContent>
      ) : (
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Participant</th>
                <th className="px-4 py-3 font-medium">Units</th>
                <th className="px-4 py-3 font-medium">Unit cost</th>
                <th className="px-4 py-3 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {detail.events.map((ev) => (
                <tr key={ev.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDateTime(ev.created_at)}
                  </td>
                  <td className="px-4 py-2">{ev.event_type}</td>
                  <td className="px-4 py-2">
                    <Badge variant="outline">{ev.provider}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs">{ev.participant || '—'}</td>
                  <td className="px-4 py-2 tabular-nums">{Number(ev.units).toLocaleString()}</td>
                  <td className="px-4 py-2 tabular-nums">${Number(ev.unit_cost_usd || 0).toFixed(6)}</td>
                  <td className="px-4 py-2 tabular-nums">${Number(ev.total_cost_usd || 0).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/20 font-medium">
                <td className="px-4 py-2" colSpan={6}>
                  Sum of events
                </td>
                <td className="px-4 py-2 tabular-nums">
                  ${detail.events.reduce((s, ev) => s + Number(ev.total_cost_usd || 0), 0).toFixed(4)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

export function MeetingsTab({ orgs = [] }) {
  const [meetings, setMeetings] = useState([]);
  const [orgFilter, setOrgFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [costDetail, setCostDetail] = useState(null);

  useEffect(() => {
    const params = { limit: 100 };
    if (orgFilter) params.org_id = orgFilter;
    v2Admin
      .meetings(params)
      .then((r) => setMeetings(r.meetings || []))
      .catch(() => toast.error('Failed to load meetings'));
  }, [orgFilter]);

  useEffect(() => {
    if (!selected) {
      setCostDetail(null);
      return;
    }
    setCostDetail(null);
    v2Admin
      .meetingCosts(selected.id)
      .then(setCostDetail)
      .catch(() => toast.error('Failed to load meeting costs'));
  }, [selected]);

  return (
    <div className="space-y-4">
      <Card className="app-card overflow-hidden border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Meetings</CardTitle>
          <CardDescription>
            Latest 100 meetings across all organizations. Click a row for its per-meeting cost breakdown.
          </CardDescription>
          <select
            aria-label="Filter meetings by organization"
            className="mt-2 h-9 max-w-sm rounded-md border border-input bg-background px-2 text-sm"
            value={orgFilter}
            onChange={(e) => {
              setOrgFilter(e.target.value);
              setSelected(null);
            }}
          >
            <option value="">All organizations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </CardHeader>
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Scheduled</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Infra cost</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr
                  key={m.id}
                  className={cn(
                    'cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30',
                    selected?.id === m.id && 'bg-primary/5'
                  )}
                  onClick={() => setSelected(m)}
                >
                  <td className="px-4 py-3 font-medium">{m.title || m.livekit_room_name || m.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{m.org_name || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusBadgeVariant(m.status)}>{m.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{(m.created_at || '').slice(0, 16)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{(m.scheduled_start || '').slice(0, 16) || '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{meetingDurationLabel(m)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {m.total_cost_usd != null ? fmtUsd(m.total_cost_usd) : '—'}
                  </td>
                </tr>
              ))}
              {meetings.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={7}>
                    No meetings found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {selected && <MeetingCostsPanel meeting={selected} detail={costDetail} />}
    </div>
  );
}

export default MeetingsTab;
