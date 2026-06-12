import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Users, Loader2, AlertCircle, Video, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { roomService, joinPublicService } from '../services/api';
import { normalizeMeetingBranding, brandingStyleVars, brandButtonClassName } from '../lib/meetingBranding';
import MeetingBrandHeader from './MeetingBrandHeader';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';

function homePath() {
  if (typeof localStorage === 'undefined') return '/';
  return localStorage.getItem('v2_token') ? '/v2/app' : '/';
}

function JoinMeeting() {
  const { roomName } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteFromUrl = searchParams.get('i') || '';
  const pollRef = useRef(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isInviteLink, setIsInviteLink] = useState(false);
  const [isStartingRoom, setIsStartingRoom] = useState(false);
  const [waitingHost, setWaitingHost] = useState(false);
  const [joinBranding, setJoinBranding] = useState(null);
  const [meetingTitle, setMeetingTitle] = useState('');

  const goHome = useCallback(() => navigate(homePath()), [navigate]);

  // Name + language + devices are collected on the prejoin screen (/room/:roomName).
  // This page only validates access, then forwards the join context.
  const goToPrejoin = useCallback(
    (info, v2Ctx, joinMeta = {}) => {
      const participantInfo = {
        participantName: '',
        isHost: !!info?.hostCode,
        hostCode: info?.hostCode,
        shareableLink: info?.shareableLink,
        shareableLinkNetwork: info?.shareableLinkNetwork,
        roomName,
        roomMode: info?.roomMode || 'multi-language',
        selectedLanguage: 'en',
        spokenLanguage: 'en',
        numParticipants: info?.numParticipants ?? null,
        meetingId: v2Ctx?.meetingId,
        inviteToken: v2Ctx?.inviteToken || inviteFromUrl,
        meetingTitle: joinMeta.meetingTitle || null,
        branding: joinMeta.branding || null,
      };
      sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));
      navigate(`/room/${roomName}${window.location.search}`, {
        state: participantInfo,
        replace: true,
      });
    },
    [navigate, roomName, inviteFromUrl]
  );

  useEffect(() => {
    checkRoom();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [roomName, inviteFromUrl]);

  const proceedAfterV2Allowed = async (v2Ctx, joinMeta = {}) => {
    try {
      const info = await roomService.getInfo(roomName);
      goToPrejoin(info, v2Ctx, joinMeta);
    } catch (e) {
      if (e.response?.status === 404) {
        setError('Meeting room is not available yet. Ask the host to start the meeting from the dashboard.');
      } else {
        setError('Failed to connect to the meeting.');
      }
    }
  };

  const checkRoom = async () => {
    if (!roomName || roomName === 'room') {
      setError('Please use a valid meeting link');
      setIsLoading(false);
      return;
    }

    try {
      const joinPreview = await joinPublicService.joinInfo(roomName, inviteFromUrl);
      if (joinPreview.mode === 'v2') {
        const v2Ctx = { meetingId: joinPreview.meetingId, inviteToken: inviteFromUrl };
        const branding = normalizeMeetingBranding(joinPreview.branding);
        setJoinBranding(branding);
        setMeetingTitle(joinPreview.title || '');
        const joinMeta = { branding, meetingTitle: joinPreview.title || null };
        if (!joinPreview.allowed && joinPreview.reason === 'waiting_for_host') {
          setWaitingHost(true);
          setIsLoading(false);
          if (!pollRef.current) {
            pollRef.current = setInterval(async () => {
              try {
                const j = await joinPublicService.joinInfo(roomName, inviteFromUrl);
                if (j.allowed) {
                  clearInterval(pollRef.current);
                  pollRef.current = null;
                  setWaitingHost(false);
                  await proceedAfterV2Allowed(v2Ctx, joinMeta);
                }
              } catch {
                /* ignore */
              }
            }, 4000);
          }
          return;
        }
        if (!joinPreview.allowed) {
          const msg =
            joinPreview.reason === 'invite_required'
              ? 'This meeting requires a full invite link (with ?i= token).'
              : joinPreview.reason === 'invite_not_yet_valid'
                ? 'This invite link is not active yet — it opens shortly before the meeting.'
              : joinPreview.reason === 'invalid_invite' || joinPreview.reason === 'invite_expired'
                ? 'This invite link is invalid or has expired.'
                : joinPreview.reason === 'meeting_ended'
                  ? 'This meeting has ended.'
                  : 'You cannot join this meeting.';
          setError(msg);
          setIsLoading(false);
          return;
        }
        await proceedAfterV2Allowed(v2Ctx, joinMeta);
        return;
      }

      const info = await roomService.getInfo(roomName);
      goToPrejoin(info, null);
    } catch (err) {
      console.error('Failed to check room:', err);
      if (err.response?.status === 404) {
        setIsInviteLink(true);
      } else {
        setError('Failed to connect to the meeting. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartInviteRoom = async () => {
    setIsStartingRoom(true);
    try {
      const response = await roomService.create(roomName);
      setIsInviteLink(false);
      goToPrejoin(response, null);
    } catch (error) {
      console.error('Failed to start room:', error);
      toast.error('Failed to start the meeting. Please try again.');
    } finally {
      setIsStartingRoom(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center" role="status" aria-live="polite">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-primary" aria-hidden="true" />
          <p className="text-muted-foreground">Checking meeting room…</p>
        </div>
      </div>
    );
  }

  if (waitingHost) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background px-4 py-8"
        style={brandingStyleVars(joinBranding)}
      >
        <Card className="w-full max-w-md overflow-hidden border-border/60 shadow-sm">
          <CardHeader className="space-y-5 pb-2 text-center">
            <MeetingBrandHeader branding={joinBranding} meetingTitle={meetingTitle} />
            <div className="flex flex-col items-center gap-4">
              <div
                className="relative flex h-20 w-20 items-center justify-center"
                role="status"
                aria-live="polite"
              >
                <div
                  className="absolute inset-0 rounded-full border-[3px] border-primary/15 border-t-primary animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
                  <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                </div>
                <span className="sr-only">Waiting for the host to join the meeting</span>
              </div>
              <div className="space-y-2">
                <CardTitle className="text-xl">Waiting for the host</CardTitle>
                <CardDescription className="mx-auto max-w-sm text-sm leading-relaxed">
                  You&apos;re in the queue. This page checks every few seconds and will let you in as soon as the host
                  opens the room.
                </CardDescription>
                <p className="text-xs text-muted-foreground">Stay on this page — no need to refresh.</p>
              </div>
            </div>
          </CardHeader>
          <CardFooter className="flex flex-col gap-2 border-t border-border/60 bg-muted/20 px-6 py-4">
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground" aria-hidden="true">
              <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-primary/60 [animation-delay:0ms]" />
              <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-primary/60 [animation-delay:200ms]" />
              <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-primary/60 [animation-delay:400ms]" />
              <span className="ml-1">Checking for host…</span>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={goHome}>
              {typeof localStorage !== 'undefined' && localStorage.getItem('v2_token')
                ? 'Cancel and open workspace'
                : 'Cancel and go home'}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (isInviteLink) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <Video className="mx-auto mb-2 h-16 w-16 text-primary" />
            <CardTitle>Meeting invite</CardTitle>
            <CardDescription>This meeting hasn&apos;t started yet. Start it now?</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              type="button"
              onClick={handleStartInviteRoom}
              disabled={isStartingRoom}
              className="w-full gap-2"
            >
              {isStartingRoom ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Starting…</span>
                </>
              ) : (
                <>
                  <Video className="h-5 w-5" />
                  <span>Start meeting</span>
                </>
              )}
            </Button>
            <Button type="button" variant="secondary" className="w-full" onClick={goHome}>
              {typeof localStorage !== 'undefined' && localStorage.getItem('v2_token')
                ? 'Open workspace'
                : 'Back to home'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <AlertCircle className="mx-auto mb-2 h-16 w-16 text-destructive" />
            <CardTitle>Unable to join</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button type="button" className="w-full" onClick={goHome}>
              {typeof localStorage !== 'undefined' && localStorage.getItem('v2_token')
                ? 'Open workspace'
                : 'Back to home'}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Access validated — goToPrejoin navigation is in flight.
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Users className="mx-auto mb-2 h-16 w-16 text-primary" />
          <CardTitle>Join meeting</CardTitle>
          <CardDescription>Taking you to the meeting lobby…</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

export default JoinMeeting;
