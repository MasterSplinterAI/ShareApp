import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Users, Loader2, AlertCircle, Video } from 'lucide-react';
import toast from 'react-hot-toast';
import { roomService, joinPublicService } from '../services/api';
import NameModal from './NameModal';

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
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-300">Checking meeting room...</p>
        </div>
      </div>
    );
  }

  if (waitingHost) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-gray-800 rounded-lg p-8 text-center">
          <Users className="w-16 h-16 text-amber-400 mx-auto mb-4" />
          <h2 className="text-2xl font-semibold text-white mb-2">Waiting for host</h2>
          <p className="text-gray-400 mb-6">
            The organizer has not opened this meeting yet. This page will refresh automatically.
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-full bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-6 rounded-lg transition-colors"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  if (isInviteLink) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-gray-800 rounded-lg p-8 text-center">
          <Video className="w-16 h-16 text-blue-400 mx-auto mb-4" />
          <h2 className="text-2xl font-semibold text-white mb-2">Meeting Invite</h2>
          <p className="text-gray-400 mb-6">This meeting hasn&apos;t started yet. Start it now?</p>
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleStartInviteRoom}
              disabled={isStartingRoom}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isStartingRoom ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Starting...</span>
                </>
              ) : (
                <>
                  <Video className="w-5 h-5" />
                  <span>Start Meeting</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-6 rounded-lg transition-colors"
            >
              Go to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-gray-800 rounded-lg p-8 text-center">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-2xl font-semibold text-white mb-2">Unable to Join</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-gray-800 rounded-lg p-8">
        <div className="text-center mb-6">
          <Users className="w-16 h-16 text-blue-400 mx-auto mb-4" />
          <h2 className="text-2xl font-semibold text-white mb-2">Join Meeting</h2>
          {roomInfo && roomInfo.numParticipants > 0 && (
            <p className="text-gray-400">
              {roomInfo.numParticipants} participant{roomInfo.numParticipants !== 1 ? 's' : ''} in room
            </p>
          )}
        </div>
      </div>

      {showNameModal && (
        <NameModal
          onClose={() => {
            setShowNameModal(false);
            navigate('/');
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
