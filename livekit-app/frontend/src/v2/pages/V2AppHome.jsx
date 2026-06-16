import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { format, isToday, isTomorrow, isThisYear } from 'date-fns';
import { ArrowRight, CalendarClock, Clock, Plus, UserPlus, Video } from 'lucide-react';
import { v2Auth, v2Orgs, v2Meetings } from '../../services/apiV2';
import { getMeetingUiState, toneToBadgeVariant } from '../lib/meetingState';
import { hasTeamWorkspace } from '../lib/planCapabilities';
import { workspaceLabel, isTeamWorkspace } from '../lib/workspaceDisplay';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { useTranslation } from '../../lib/i18n/I18nProvider';
import { dateFnsLocale } from '../../lib/i18n/dateLocale';
import { useUpgradeOffer } from '../hooks/useUpgradeOffer';
import { UpgradeUsageCard } from '../components/UpgradePrompt';

export default function V2AppHome() {
  const { t, locale } = useTranslation();
  const [me, setMe] = useState(null);
  const [orgData, setOrgData] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
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
    Promise.all([v2Auth.me(), v2Orgs.me(), v2Meetings.list()])
      .then(([meRes, o, mList]) => {
        setMe(meRes);
        setOrgData(o);
        setMeetings(mList.meetings || []);
      })
      .catch((e) => {
        toast.error(e.response?.data?.error || t('appHome.loadFailed'));
      })
      .finally(() => setLoading(false));
  }, []);

  const displayName = me?.user?.display_name || me?.user?.displayName || me?.user?.email?.split('@')[0] || 'there';
  const firstName = displayName.split(' ')[0];
  const workspaceName = workspaceLabel({ org: me?.org || orgData?.org, user: me?.user });
  const teamAccount = isTeamWorkspace(me?.org || orgData?.org);
  const teamWorkspace = hasTeamWorkspace(orgData?.entitlements, sub?.plan);

  const nextUpcoming = useMemo(() => {
    const now = Date.now();
    return meetings
      .filter((m) => {
        const time = m.scheduled_start ? new Date(m.scheduled_start).getTime() : NaN;
        return !Number.isNaN(time) && time > now;
      })
      .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start))[0] || null;
  }, [meetings]);

  const recentMeetings = useMemo(
    () => meetings.filter((m) => m.id !== nextUpcoming?.id).slice(0, 3),
    [meetings, nextUpcoming],
  );

  const usageMinutes = Math.round(Number(usage?.meetingMinutes ?? orgData?.usageThisMonth?.meetingMinutes) || 0);
  const planName = sub?.plan?.name;

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      {!loading && (offer?.show || sub?.plan) && (
        <UpgradeUsageCard
          offer={offer}
          checkoutLoading={checkoutLoading}
          onCheckout={startCheckout}
          usage={usage ?? orgData?.usageThisMonth}
          currentPlan={sub?.plan}
        />
      )}
      <section className="space-y-5 pt-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {greetingForNow()}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {teamAccount
              ? t('appHome.subtitleTeam', { workspace: workspaceName })
              : t('appHome.subtitlePersonal')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild className="gap-2">
            <Link to="/v2/app/meetings?create=1">
              <Plus className="h-4 w-4" />
              {t('appHome.newMeeting')}
            </Link>
          </Button>
          <Button variant="outline" asChild className="gap-2">
            <Link to="/v2/app/meetings?create=1">
              <CalendarClock className="h-4 w-4" />
              {t('appHome.schedule')}
            </Link>
          </Button>
          <Button variant="ghost" asChild className="gap-2">
            <Link to="/v2/app/meetings">
              <Video className="h-4 w-4" />
              {t('appHome.allMeetings')}
            </Link>
          </Button>
          {teamWorkspace && (
            <Button variant="ghost" asChild className="gap-2">
              <Link to="/v2/app/settings">
                <UserPlus className="h-4 w-4" />
                {t('appHome.inviteTeammate')}
              </Link>
            </Button>
          )}
        </div>
      </section>

      {!loading && nextUpcoming && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('appHome.upNext')}</h2>
          <Link to={`/v2/app/meetings/${nextUpcoming.id}`}>
            <Card className="app-card app-card-hover border-primary/30 bg-gradient-to-br from-card via-card to-primary/[0.04] hover:border-primary/50">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="flex min-w-0 items-center gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <CalendarClock className="h-5 w-5 text-primary" />
                  </span>
                  <div className="min-w-0">
                    <span className="block truncate font-medium text-foreground">
                      {nextUpcoming.title || nextUpcoming.livekit_room_name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {friendlyTime(nextUpcoming.scheduled_start)}
                    </span>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('appHome.recentMeetings')}</h2>
          <Link to="/v2/app/meetings" className="text-xs font-medium text-primary hover:underline">
            {t('appHome.viewAll')}
          </Link>
        </div>
        {loading ? (
          <ul className="space-y-2">
            {[0, 1, 2].map((i) => (
              <li key={i} className="app-card h-[68px] animate-pulse border-border/50 bg-muted/40" />
            ))}
          </ul>
        ) : recentMeetings.length === 0 ? (
          <Card className="border-dashed border-border bg-muted/30 shadow-none">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Video className="h-5 w-5 text-primary" />
              </span>
              <p className="mt-4 text-sm font-medium text-foreground">{t('appHome.noMeetings')}</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t('appHome.noMeetingsHint')}</p>
              <Button asChild className="mt-5 gap-2">
                <Link to="/v2/app/meetings?create=1">
                  <Plus className="h-4 w-4" />
                  {t('appHome.createFirst')}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {recentMeetings.map((m) => {
              const ui = getMeetingUiState(m);
              return (
                <li key={m.id}>
                  <Link to={`/v2/app/meetings/${m.id}`}>
                    <Card className="app-card app-card-hover border-border/70 hover:border-primary/40">
                      <CardContent className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{m.title || m.livekit_room_name}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {friendlyTime(m.scheduled_start || m.created_at)}
                          </span>
                        </div>
                        <Badge variant={toneToBadgeVariant(ui.tone)} className="shrink-0 text-xs uppercase tracking-wide">
                          {ui.label}
                        </Badge>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
