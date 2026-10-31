import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { format, isToday, isTomorrow, isThisYear } from 'date-fns';
import {
  ArrowRight,
  CalendarClock,
  Clock,
  FileText,
  Phone,
  PhoneMissed,
  Plus,
  Sparkles,
  Video,
  Zap,
} from 'lucide-react';
import { v2Auth, v2Calls, v2Contacts, v2Meetings, v2Orgs } from '../../services/apiV2';
import { getMeetingUiState, isMeetingEffectivelyEnded, toneToBadgeVariant } from '../lib/meetingState';
import { workspaceLabel, isTeamWorkspace } from '../lib/workspaceDisplay';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { useTranslation } from '../../lib/i18n/I18nProvider';
import { dateFnsLocale } from '../../lib/i18n/dateLocale';
import { useUpgradeOffer } from '../hooks/useUpgradeOffer';
import { UpgradeUsageCard } from '../components/UpgradePrompt';
import { getPublicAppOrigin, parseJoinTarget } from '../../lib/nativePlatform';

export default function V2AppHome() {
  const navigate = useNavigate();
  const { t, locale } = useTranslation();
  const [me, setMe] = useState(null);
  const [orgData, setOrgData] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [callHistory, setCallHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startingInstant, setStartingInstant] = useState(false);
  const [callingId, setCallingId] = useState(null);
  const [joinInput, setJoinInput] = useState('');
  const { offer, checkoutLoading, startCheckout, subscription: sub, usage } = useUpgradeOffer(me);

  const dateLocale = dateFnsLocale(locale);

  const greetingForNow = () => {
    const h = new Date().getHours();
    if (h < 12) return t('appHome.greetingMorning');
    if (h < 18) return t('appHome.greetingAfternoon');
    return t('appHome.greetingEvening');
  };

  const friendlyTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    if (isToday(d)) return t('appHome.todayAt', { time: format(d, 'p', { locale: dateLocale }) });
    if (isTomorrow(d)) return t('appHome.tomorrowAt', { time: format(d, 'p', { locale: dateLocale }) });
    if (isThisYear(d)) return format(d, 'EEE MMM d, p', { locale: dateLocale });
    return format(d, 'MMM d, yyyy', { locale: dateLocale });
  };

  useEffect(() => {
    Promise.all([
      v2Auth.me(),
      v2Orgs.me(),
      v2Meetings.list(),
      v2Contacts.list().catch(() => ({ contacts: [] })),
      v2Calls.history().catch(() => ({ calls: [] })),
    ])
      .then(([meRes, o, mList, cList, hList]) => {
        setMe(meRes);
        setOrgData(o);
        setMeetings(mList.meetings || []);
        setContacts(cList.contacts || []);
        setCallHistory(hList.calls || []);
      })
      .catch((e) => {
        toast.error(e.response?.data?.error || t('appHome.loadFailed'));
      })
      .finally(() => setLoading(false));
  }, []);

  const displayName =
    me?.user?.display_name || me?.user?.displayName || me?.user?.email?.split('@')[0] || 'Host';
  const firstName = displayName.split(' ')[0];
  const workspaceName = workspaceLabel({ org: me?.org || orgData?.org, user: me?.user });
  const teamAccount = isTeamWorkspace(me?.org || orgData?.org);

  const conferenceMeetings = useMemo(
    () => meetings.filter((m) => !m.is_direct_call),
    [meetings]
  );

  const nextUpcoming = useMemo(() => {
    const now = Date.now();
    // Prioritize any currently live meeting or next future scheduled meeting
    const liveNow = conferenceMeetings.find((m) => {
      const ui = getMeetingUiState(m);
      return ui.key === 'live_active' || ui.key === 'scheduled_active';
    });
    if (liveNow) return liveNow;

    return (
      conferenceMeetings
        .filter((m) => {
          if (isMeetingEffectivelyEnded(m)) return false;
          const time = m.scheduled_start ? new Date(m.scheduled_start).getTime() : NaN;
          return !Number.isNaN(time) && time > now;
        })
        .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start))[0] || null
    );
  }, [conferenceMeetings]);

  const recentMeetings = useMemo(
    () => conferenceMeetings.filter((m) => m.id !== nextUpcoming?.id).slice(0, 3),
    [conferenceMeetings, nextUpcoming]
  );

  const missedCalls = useMemo(
    () =>
      callHistory.filter(
        (c) => c.direction === 'incoming' && (c.status === 'missed' || c.status === 'canceled')
      ),
    [callHistory]
  );

  const usageMinutes = Math.round(
    Number(usage?.meetingMinutes ?? orgData?.usageThisMonth?.meetingMinutes) || 0
  );
  const planName = sub?.plan?.name;

  const startAndJoinInstantMeeting = async () => {
    if (startingInstant) return;
    setStartingInstant(true);
    try {
      const m = await v2Meetings.create({
        title: `${firstName}’s meeting`,
        host_required_to_start: false,
      });
      await v2Meetings.hostSessionOpen(m.id).catch(() => {});
      const participantInfo = {
        isHost: true,
        participantName: displayName,
        hostCode: m.hostCode,
        shareableLink: m.joinUrl,
        shareableLinkNetwork: m.joinUrl,
        roomName: m.livekitRoomName,
        meetingId: m.id,
        inviteToken: '',
      };
      try {
        sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));
      } catch {
        /* ignore */
      }
      navigate(`/room/${encodeURIComponent(m.livekitRoomName)}`, {
        state: {
          ...participantInfo,
          meetingTitle: m.title,
        },
      });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not start meeting');
      setStartingInstant(false);
    }
  };

  const joinExistingMeetingAsHost = async (m) => {
    try {
      await v2Meetings.hostSessionOpen(m.id).catch(() => {});
      const share =
        m.joinUrl || `${getPublicAppOrigin()}/join/${encodeURIComponent(m.livekit_room_name)}`;
      const participantInfo = {
        isHost: true,
        participantName: displayName,
        hostCode: m.host_code,
        shareableLink: share,
        shareableLinkNetwork: share,
        roomName: m.livekit_room_name,
        meetingId: m.id,
        inviteToken: '',
      };
      sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));
      navigate(`/room/${encodeURIComponent(m.livekit_room_name)}`, {
        state: {
          ...participantInfo,
          meetingTitle: m.title,
        },
      });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not join meeting');
    }
  };

  const quickCallContact = async (contact) => {
    if (callingId) return;
    setCallingId(contact.id);
    try {
      const data = await v2Calls.start({ contactId: contact.id });
      toast.success(`Ringing ${contact.name}…`);
      const { call, meeting } = data;
      const participantInfo = {
        isHost: true,
        participantName: displayName,
        hostCode: meeting.hostCode,
        shareableLink: meeting.joinUrl,
        shareableLinkNetwork: meeting.joinUrl,
        roomName: meeting.livekitRoomName,
        meetingId: meeting.id,
        inviteToken: '',
      };
      sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));
      navigate(`/room/${encodeURIComponent(meeting.livekitRoomName)}`, {
        state: {
          ...participantInfo,
          meetingTitle: meeting.title,
          directCall: call,
        },
      });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not start call');
      setCallingId(null);
    }
  };

  const handleJoinByCode = (e) => {
    e.preventDefault();
    const target = parseJoinTarget(joinInput);
    if (!target) {
      toast.error('Paste an invite link or enter a room code');
      return;
    }
    navigate(target);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Header */}
      <section className="pt-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {greetingForNow()}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {teamAccount
            ? t('appHome.subtitleTeam', { workspace: workspaceName })
            : t('appHome.subtitlePersonal')}
        </p>
      </section>

      {/* Missed call alert banner (only when there are missed incoming calls) */}
      {!loading && missedCalls.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/20 text-destructive">
              <PhoneMissed className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {missedCalls.length === 1
                  ? `Missed call from ${missedCalls[0].counterpartName}`
                  : `${missedCalls.length} missed calls`}
              </p>
              <p className="text-xs text-muted-foreground">
                Latest: {missedCalls[0].counterpartName} · {friendlyTime(missedCalls[0].createdAt)}
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/v2/app/calls">
              View call log
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      )}

      {/* 4 Primary Quick Actions */}
      <section aria-label="Quick actions" className="grid gap-3 sm:grid-cols-2">
        {/* 1. Start Instant Meeting */}
        <Card className="app-card border-primary/30 bg-gradient-to-br from-primary/[0.08] via-card to-card">
          <CardContent className="flex h-full flex-col justify-between gap-4 p-5">
            <div className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Zap className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-foreground">{t('appHome.instantMeetingTitle')}</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {t('appHome.instantMeetingDesc')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                className="flex-1 gap-2"
                disabled={startingInstant}
                onClick={startAndJoinInstantMeeting}
              >
                <Video className="h-4 w-4" />
                {startingInstant ? 'Starting…' : t('appHome.startAndJoinNow')}
              </Button>
              <Button variant="outline" asChild className="gap-1.5">
                <Link to="/v2/app/meetings?create=1">
                  <CalendarClock className="h-4 w-4" />
                  {t('appHome.schedule')}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 2. Direct Call & Contacts */}
        <Card className="app-card border-border/70">
          <CardContent className="flex h-full flex-col justify-between gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Phone className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-foreground">{t('appHome.directCallTitle')}</h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t('appHome.directCallDesc')}
                  </p>
                </div>
              </div>
            </div>

            {contacts.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {contacts.slice(0, 3).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={Boolean(callingId)}
                    onClick={() => quickCallContact(c)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
                  >
                    <Phone className="h-3 w-3" />
                    {callingId === c.id ? 'Calling…' : c.name}
                  </button>
                ))}
                <Link
                  to="/v2/app/calls"
                  className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {t('appHome.allCallsAndContacts')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <Button variant="outline" asChild className="w-full gap-2">
                <Link to="/v2/app/calls">
                  <Phone className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  {t('appHome.openCallsAndContacts')}
                  <ArrowRight className="ml-auto h-4 w-4 opacity-70" />
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Join a meeting by code or link */}
      <form
        onSubmit={handleJoinByCode}
        className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/70 p-3.5 sm:flex-row sm:items-center"
      >
        <span className="text-xs font-medium text-muted-foreground sm:shrink-0 sm:px-1">
          {t('appHome.haveMeetingLink')}
        </span>
        <Input
          value={joinInput}
          onChange={(e) => setJoinInput(e.target.value)}
          placeholder={t('appHome.pasteInvitePlaceholder')}
          className="h-9 flex-1 text-xs"
          autoCapitalize="none"
          autoCorrect="off"
        />
        <Button type="submit" size="sm" variant="secondary" className="h-9 shrink-0 gap-1.5">
          {t('appHome.joinRoom')}
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </form>

      {/* Up Next / Live Now */}
      {!loading && nextUpcoming && (
        <section>
          <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('appHome.upNext')}
          </h2>
          <Card className="app-card border-primary/30 bg-gradient-to-br from-card via-card to-primary/[0.04]">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
              <div className="flex min-w-0 items-center gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <CalendarClock className="h-5 w-5 text-primary" />
                </span>
                <div className="min-w-0">
                  <Link
                    to={`/v2/app/meetings/${nextUpcoming.id}`}
                    className="block truncate font-medium text-foreground hover:text-primary"
                  >
                    {nextUpcoming.title || nextUpcoming.livekit_room_name}
                  </Link>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {friendlyTime(nextUpcoming.scheduled_start || nextUpcoming.created_at)}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5 bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500"
                  onClick={() => joinExistingMeetingAsHost(nextUpcoming)}
                >
                  <Video className="h-3.5 w-3.5" />
                  Join
                </Button>
                <Button variant="outline" size="sm" asChild className="h-8 text-xs">
                  <Link to={`/v2/app/meetings/${nextUpcoming.id}`}>Details</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Recent Meetings */}
      <section>
        <div className="mb-2.5 flex items-center justify-between gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('appHome.recentMeetings')}
          </h2>
          <Link to="/v2/app/meetings" className="text-xs font-medium text-primary hover:underline">
            {t('appHome.viewAll')}
          </Link>
        </div>
        {loading ? (
          <ul className="space-y-2">
            {[0, 1, 2].map((i) => (
              <li key={i} className="app-card h-[64px] animate-pulse border-border/50 bg-muted/40" />
            ))}
          </ul>
        ) : recentMeetings.length === 0 ? (
          <Card className="border-dashed border-border bg-muted/30 shadow-none">
            <CardContent className="flex flex-col items-center py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                <Video className="h-5 w-5 text-primary" />
              </span>
              <p className="mt-3 text-sm font-medium text-foreground">{t('appHome.noMeetings')}</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">{t('appHome.noMeetingsHint')}</p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {recentMeetings.map((m) => {
              const ui = getMeetingUiState(m);
              const ended = ui.key === 'ended' || ui.key === 'archived';
              const lineCount = Number(m.transcript_line_count) || 0;
              return (
                <li key={m.id}>
                  <Card className="app-card border-border/70">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3.5 sm:p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/v2/app/meetings/${m.id}`}
                            className="truncate text-sm font-medium text-foreground hover:text-primary"
                          >
                            {m.title || m.livekit_room_name}
                          </Link>
                          <Badge variant={toneToBadgeVariant(ui.tone)} className="shrink-0 text-[10px]">
                            {ui.label}
                          </Badge>
                        </div>
                        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{friendlyTime(m.scheduled_start || m.created_at)}</span>
                          {lineCount > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {lineCount} lines
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {!ended && (
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 gap-1.5 bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500"
                            onClick={() => joinExistingMeetingAsHost(m)}
                          >
                            <Video className="h-3.5 w-3.5" />
                            Join
                          </Button>
                        )}
                        <Button variant="outline" size="sm" asChild className="h-8 gap-1 px-2.5 text-xs">
                          <Link to={`/v2/app/meetings/${m.id}`}>
                            {lineCount > 0 ? (
                              <>
                                <Sparkles className="h-3 w-3 text-primary" />
                                Transcript &amp; AI
                              </>
                            ) : (
                              <>
                                Details
                                <ArrowRight className="h-3 w-3" />
                              </>
                            )}
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Plan & Usage Summary at bottom of Home */}
      {!loading && (offer?.show || sub?.plan) && (
        <UpgradeUsageCard
          offer={offer}
          checkoutLoading={checkoutLoading}
          onCheckout={startCheckout}
          usage={usage ?? orgData?.usageThisMonth}
          currentPlan={sub?.plan}
        />
      )}

      {!loading && (
        <p className="text-xs text-muted-foreground">
          {planName ? t('appHome.planUsage', { plan: planName }) : t('appHome.planUnknown')}
          <span className="mx-1.5">·</span>
          {t('appHome.minutesUsed', { minutes: usageMinutes })}
          <span className="mx-1.5">·</span>
          <Link to="/v2/app/settings?section=billing" className="text-primary hover:underline">
            {t('appHome.manageBilling')}
          </Link>
        </p>
      )}
    </div>
  );
}
