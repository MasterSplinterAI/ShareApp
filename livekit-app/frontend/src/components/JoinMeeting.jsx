import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Users, Loader2, AlertCircle, Video, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { roomService, joinPublicService } from '../services/api';
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

  const goHome = useCallback(() => navigate(homePath()), [navigate]);

  // Name + language + devices are collected on the prejoin screen (/room/:roomName).
  // This page only validates access, then forwards the join context.
  const goToPrejoin = useCallback(
    (info, v2Ctx) => {
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

  const proceedAfterV2Allowed = async (v2Ctx) => {
    try {
      const info = await roomService.getInfo(roomName);
      goToPrejoin(info, v2Ctx);
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
                  await proceedAfterV2Allowed(v2Ctx);
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
              : joinPreview.reason === 'invalid_invite' || joinPreview.reason === 'invite_expired'
                ? 'This invite link is invalid or has expired.'
                : joinPreview.reason === 'meeting_ended'
                  ? 'This meeting has ended.'
                  : 'You cannot join this meeting.';
          setError(msg);
          setIsLoading(false);
          return;
        }
        await proceedAfterV2Allowed(v2Ctx);
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
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-primary" />
          <p className="text-muted-foreground">Checking meeting room…</p>
        </div>
      </div>
    );
  }

  if (waitingHost) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="relative mx-auto mb-2 inline-flex h-16 w-16 items-center justify-center">
              <Clock className="h-12 w-12 text-amber-500" />
              <Loader2 className="absolute -right-1 -top-1 h-5 w-5 animate-spin text-primary" />
            </div>
            <CardTitle>Waiting for the host</CardTitle>
            <CardDescription className="space-y-2">
              <span className="block">
                You&apos;re in the queue — this page checks every few seconds and will let you in as soon as the host opens the room.
              </span>
              <span className="block text-xs text-muted-foreground">
                Stay on this page; you don&apos;t need to refresh manually.
              </span>
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button type="button" variant="ghost" className="w-full" onClick={goHome}>
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
