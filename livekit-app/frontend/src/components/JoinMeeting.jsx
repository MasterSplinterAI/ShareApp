import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Users, Loader2, AlertCircle, Video } from 'lucide-react';
import toast from 'react-hot-toast';
import { roomService, joinPublicService } from '../services/api';
import NameModal from './NameModal';
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
  const [roomInfo, setRoomInfo] = useState(null);
  const [error, setError] = useState(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [isInviteLink, setIsInviteLink] = useState(false);
  const [isStartingRoom, setIsStartingRoom] = useState(false);
  const [v2Context, setV2Context] = useState(null);
  const [waitingHost, setWaitingHost] = useState(false);

  const goHome = useCallback(() => navigate(homePath()), [navigate]);

  useEffect(() => {
    checkRoom();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomName, inviteFromUrl]);

  const proceedAfterV2Allowed = async () => {
    try {
      const info = await roomService.getInfo(roomName);
      setRoomInfo(info);
      setShowNameModal(true);
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
        if (!joinPreview.allowed && joinPreview.reason === 'waiting_for_host') {
          setWaitingHost(true);
          setV2Context({ meetingId: joinPreview.meetingId, inviteToken: inviteFromUrl });
          setIsLoading(false);
          if (!pollRef.current) {
            pollRef.current = setInterval(async () => {
              try {
                const j = await joinPublicService.joinInfo(roomName, inviteFromUrl);
                if (j.allowed) {
                  clearInterval(pollRef.current);
                  pollRef.current = null;
                  setWaitingHost(false);
                  await proceedAfterV2Allowed();
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
        setV2Context({ meetingId: joinPreview.meetingId, inviteToken: inviteFromUrl });
        await proceedAfterV2Allowed();
        return;
      }

      const info = await roomService.getInfo(roomName);
      setRoomInfo(info);
      setShowNameModal(true);
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
      setRoomInfo(response);
      setIsInviteLink(false);
      setShowNameModal(true);
    } catch (error) {
      console.error('Failed to start room:', error);
      toast.error('Failed to start the meeting. Please try again.');
    } finally {
      setIsStartingRoom(false);
    }
  };

  const handleNameSubmit = (name, selectedLanguage = 'en', spokenLanguage = null) => {
    const spoken = spokenLanguage ?? selectedLanguage;
    const isHost = !!roomInfo?.hostCode;
    const participantInfo = {
      participantName: name,
      isHost,
      hostCode: roomInfo?.hostCode,
      shareableLink: roomInfo?.shareableLink,
      shareableLinkNetwork: roomInfo?.shareableLinkNetwork,
      roomName,
      roomMode: roomInfo?.roomMode || 'multi-language',
      selectedLanguage,
      spokenLanguage: spoken,
      meetingId: v2Context?.meetingId,
      inviteToken: v2Context?.inviteToken || inviteFromUrl,
    };

    sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));

    setTimeout(() => {
      const search = window.location.search;
      navigate(`/room/${roomName}${search}`, {
        state: participantInfo,
        replace: false,
      });
    }, 10);
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
            <Users className="mx-auto mb-2 h-16 w-16 text-amber-500" />
            <CardTitle>Waiting for host</CardTitle>
            <CardDescription>
              The organizer has not opened this meeting yet. This page will refresh automatically.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button type="button" variant="secondary" className="w-full" onClick={goHome}>
              {typeof localStorage !== 'undefined' && localStorage.getItem('v2_token')
                ? 'Open workspace'
                : 'Back to home'}
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Users className="mx-auto mb-2 h-16 w-16 text-primary" />
          <CardTitle>Join meeting</CardTitle>
          {roomInfo && roomInfo.numParticipants > 0 && (
            <CardDescription>
              {roomInfo.numParticipants} participant{roomInfo.numParticipants !== 1 ? 's' : ''} in room
            </CardDescription>
          )}
        </CardHeader>
      </Card>

      {showNameModal && (
        <NameModal
          onClose={() => {
            setShowNameModal(false);
            goHome();
          }}
          onSubmit={handleNameSubmit}
          title="Join Meeting"
          subtitle="Enter your name and select your preferred translation language"
          showLanguageSelector={true}
          defaultLanguage="en"
        />
      )}
    </div>
  );
}

export default JoinMeeting;
