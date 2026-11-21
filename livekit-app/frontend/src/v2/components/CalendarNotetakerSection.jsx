import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Calendar, CalendarCheck2, Plus, RefreshCw, Unlink, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { v2Notetaker } from '../../services/apiV2';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';

const PLATFORM_LABELS = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  ms_teams: 'Microsoft Teams',
  webex: 'Webex',
};

const AUTO_JOIN_LABELS = {
  manual: 'Manual per-meeting opt-in',
  organizer_only: 'Meetings I organize with a video link',
  all_with_link: 'All meetings with a video link',
};

function isEventOptedIn(ev, cal) {
  if (!ev) return false;
  if (ev.recording_override === 'enabled') return true;
  if (ev.recording_override === 'disabled') return false;
  const rule = ev.auto_join_rule || cal?.auto_join_rule || 'manual';
  if (rule === 'all_with_link') return true;
  if (rule === 'organizer_only') {
    const org = String(ev.organizer_email || '').trim().toLowerCase();
    const acct = String(cal?.account_email || '').trim().toLowerCase();
    return Boolean(org && acct && org === acct);
  }
  return false;
}

function fmtEventTime(startIso, endIso) {
  try {
    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) return startIso || '';
    const datePart = format(start, 'EEE, MMM d');
    const startTime = format(start, 'h:mm a');
    if (endIso) {
      const end = new Date(endIso);
      if (!Number.isNaN(end.getTime())) {
        return `${datePart} • ${startTime} – ${format(end, 'h:mm a')}`;
      }
    }
    return `${datePart} • ${startTime}`;
  } catch {
    return startIso || '';
  }
}

export function CalendarNotetakerSection({ onUpdated }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [calendars, setCalendars] = useState([]);
  const [events, setEvents] = useState([]);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [disconnectingId, setDisconnectingId] = useState(null);
  const [savingRuleId, setSavingRuleId] = useState(null);
  const [togglingEventId, setTogglingEventId] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [calRes, evRes] = await Promise.all([
        v2Notetaker.calendars(),
        v2Notetaker.calendarEvents(),
      ]);
      setCalendars(Array.isArray(calRes?.calendars) ? calRes.calendars : []);
      setOauthConfigured(Boolean(calRes?.oauthConfigured));
      setEvents(Array.isArray(evRes?.events) ? evRes.events : []);
    } catch {
      // Non-fatal: meetings list still works even if calendar data fails to load
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const calStatus = searchParams.get('calendar');
    const calErr = searchParams.get('calendar_error');
    if (!calStatus && !calErr) return;
    if (calStatus === 'connected') {
      toast.success('Google Calendar connected! Upcoming events will sync automatically.');
      loadData();
      onUpdated?.();
    } else if (calErr) {
      toast.error(`Google Calendar connection failed (${calErr.replace(/_/g, ' ')})`);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('calendar');
    next.delete('calendar_error');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, loadData, onUpdated]);

  const handleConnectCalendar = async () => {
    setConnecting(true);
    try {
      const res = await v2Notetaker.connectCalendarUrl();
      if (res?.url) {
        window.location.assign(res.url);
        return;
      }
      toast.error('Could not start Google Calendar connection');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not start Google Calendar connection');
    } finally {
      setConnecting(false);
    }
  };

  const handleRuleChange = async (calId, autoJoinRule) => {
    setSavingRuleId(calId);
    try {
      await v2Notetaker.patchCalendar(calId, { autoJoinRule });
      toast.success(`Updated rule: ${AUTO_JOIN_LABELS[autoJoinRule] || autoJoinRule}`);
      await loadData();
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not update calendar rule');
    } finally {
      setSavingRuleId(null);
    }
  };

  const handleSync = async (calId) => {
    setSyncingId(calId);
    try {
      const res = await v2Notetaker.syncCalendar(calId);
      toast.success(`Synced ${res?.eventsProcessed ?? 0} calendar event(s)`);
      await loadData();
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Calendar sync failed');
    } finally {
      setSyncingId(null);
    }
  };

  const handleDisconnect = async (calId) => {
    setDisconnectingId(calId);
    try {
      await v2Notetaker.deleteCalendar(calId);
      toast.success('Calendar disconnected');
      await loadData();
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not disconnect calendar');
    } finally {
      setDisconnectingId(null);
    }
  };

  const handleToggleEvent = async (ev, nextEnabled) => {
    setTogglingEventId(ev.id);
    try {
      await v2Notetaker.toggleCalendarEvent(ev.id, nextEnabled);
      toast.success(
        nextEnabled ? `Bot scheduled for "${ev.title}"` : `Recording canceled for "${ev.title}"`
      );
      await loadData();
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not update recording toggle');
    } finally {
      setTogglingEventId(null);
    }
  };

  if (loading) {
    return null;
  }

  const activeCalendars = calendars.filter((c) => c.status !== 'disconnected');

  if (activeCalendars.length === 0) {
    return (
      <Card className="border-border/70 bg-muted/20 shadow-none">
        <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Calendar className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">Google Calendar Notetaker Sync</p>
              <p className="text-xs text-muted-foreground">
                No Google Calendar connected yet. Connected calendars automatically sync upcoming Meet, Zoom, Teams,
                and Webex events here for 1-click recording opt-in.
              </p>
            </div>
          </div>
          {oauthConfigured ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleConnectCalendar}
              disabled={connecting}
              className="w-fit shrink-0 gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              {connecting ? 'Connecting…' : 'Connect Google Calendar'}
            </Button>
          ) : (
            <Badge variant="outline" className="w-fit shrink-0">
              Not connected
            </Badge>
          )}
        </CardContent>
      </Card>
    );
  }

  const calById = new Map(activeCalendars.map((c) => [c.id, c]));

  return (
    <Card className="app-card border-border/70">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarCheck2 className="h-4 w-4" />
            </span>
            <div>
              <CardTitle className="text-base">Calendar Notetaker Sync</CardTitle>
              <CardDescription className="text-xs">
                Choose your default rule or toggle recording per upcoming meeting.
              </CardDescription>
            </div>
          </div>
          {oauthConfigured && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleConnectCalendar}
              disabled={connecting}
              className="h-8 shrink-0 gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              {connecting ? 'Connecting…' : 'Add Google Calendar'}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2.5">
          {activeCalendars.map((cal) => (
            <div
              key={cal.id}
              className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {cal.account_email || 'Google Calendar'}
                  </span>
                  <Badge
                    variant={cal.status === 'connected' ? 'default' : 'secondary'}
                    className={cal.status === 'connected' ? 'bg-emerald-600 hover:bg-emerald-600' : ''}
                  >
                    {cal.status}
                  </Badge>
                </div>
                {cal.last_synced_at && (
                  <p className="text-xs text-muted-foreground">
                    Last synced {fmtEventTime(cal.last_synced_at)}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={cal.auto_join_rule || 'manual'}
                  onValueChange={(val) => handleRuleChange(cal.id, val)}
                  disabled={savingRuleId === cal.id}
                >
                  <SelectTrigger className="h-8 w-[240px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual per-meeting opt-in</SelectItem>
                    <SelectItem value="organizer_only">Meetings I organize with a link</SelectItem>
                    <SelectItem value="all_with_link">All meetings with a video link</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleSync(cal.id)}
                  disabled={syncingId === cal.id}
                  className="h-8 gap-1.5 text-xs"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingId === cal.id ? 'animate-spin' : ''}`} />
                  Sync
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDisconnect(cal.id)}
                  disabled={disconnectingId === cal.id}
                  className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                >
                  <Unlink className="h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Upcoming Calendar Meetings ({events.length})
            </h3>
          </div>

          {events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
              No upcoming events synced yet. Click <strong>Sync</strong> to refresh from Google Calendar.
            </p>
          ) : (
            <div className="divide-y divide-border/60 rounded-lg border border-border/60 bg-background/60">
              {events.map((ev) => {
                const cal = calById.get(ev.calendar_connection_id);
                const checked = isEventOptedIn(ev, cal);
                const hasLink = Boolean(ev.normalized_meeting_url);
                const isBusy = togglingEventId === ev.id;
                const platformLabel =
                  PLATFORM_LABELS[ev.meeting_platform] || (hasLink ? 'External Call' : 'No video link');

                return (
                  <div
                    key={ev.id}
                    className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{ev.title}</span>
                        <Badge variant="outline" className="text-[11px]">
                          {platformLabel}
                        </Badge>
                        {ev.bot_status && (
                          <Badge variant="secondary" className="text-[11px] capitalize">
                            {ev.bot_status.replace(/_/g, ' ')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {fmtEventTime(ev.start_time, ev.end_time)}
                        {ev.organizer_email ? ` • Host: ${ev.organizer_email}` : ''}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {ev.meeting_id && (
                        <Button asChild size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs">
                          <Link to={`/v2/app/meetings/${ev.meeting_id}`}>
                            View
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </Button>
                      )}
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
                        <span className={!hasLink ? 'text-muted-foreground' : ''}>Record with Lalia</span>
                        <Switch
                          checked={checked}
                          disabled={!hasLink || isBusy}
                          onCheckedChange={(val) => handleToggleEvent(ev, val)}
                          aria-label={`Record ${ev.title} with Lalia`}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default CalendarNotetakerSection;
