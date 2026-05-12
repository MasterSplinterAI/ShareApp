import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ExternalLink } from 'lucide-react';
import { v2Meetings } from '../../services/apiV2';

export default function V2MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [name, setName] = useState('');

  useEffect(() => {
    v2Meetings
      .get(id)
      .then(setMeeting)
      .catch(() => {
        toast.error('Meeting not found');
        navigate('/v2/app/meetings');
      });
  }, [id, navigate]);

  const joinAsHost = async () => {
    if (!name.trim()) {
      toast.error('Enter display name');
      return;
    }
    try {
      const tok = await v2Meetings.token(id, { participantName: name.trim(), isHost: true });
      const participantInfo = {
        isHost: true,
        participantName: name.trim(),
        hostCode: meeting.host_code,
        shareableLink: meeting.joinUrl,
        shareableLinkNetwork: meeting.joinUrl,
        roomName: meeting.livekit_room_name,
        selectedLanguage: 'en',
        spokenLanguage: 'en',
      };
      sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));
      navigate(`/room/${meeting.livekit_room_name}${window.location.search || ''}`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Token failed');
    }
  };

  if (!meeting) {
    return <p className="text-gray-500 text-sm">Loading…</p>;
  }

  return (
    <div className="max-w-xl">
      <Link to="/v2/app/meetings" className="text-sm text-blue-400 hover:text-blue-300 mb-4 inline-block">
        ← Meetings
      </Link>
      <h1 className="text-2xl font-semibold text-white mb-2">{meeting.title}</h1>
      <p className="text-gray-500 text-sm mb-6">
        Status: <span className="text-gray-300">{meeting.status}</span> · Room:{' '}
        <code className="text-gray-400 text-xs">{meeting.livekit_room_name}</code>
      </p>
      <div className="rounded-lg border border-gray-800 bg-gray-800/30 p-4 mb-6">
        <p className="text-xs text-gray-500 mb-2">Guest join URL</p>
        <a
          href={meeting.joinUrl}
          target="_blank"
          rel="noreferrer"
          className="text-blue-400 text-sm break-all inline-flex items-center gap-1 hover:text-blue-300"
        >
          {meeting.joinUrl}
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      </div>
      <div className="space-y-3">
        <label className="block text-xs text-gray-500">Your name (host)</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white"
          placeholder="Host display name"
        />
        <button
          type="button"
          onClick={joinAsHost}
          className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
        >
          Join as host (classic room UI)
        </button>
      </div>
    </div>
  );
}
