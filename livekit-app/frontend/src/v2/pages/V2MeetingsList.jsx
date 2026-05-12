import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { v2Meetings } from '../../services/apiV2';

export default function V2MeetingsList() {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    v2Meetings
      .list()
      .then((r) => setMeetings(r.meetings || []))
      .catch(() => toast.error('Failed to load meetings'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const createNow = async () => {
    try {
      const m = await v2Meetings.create({ title: 'Instant meeting' });
      toast.success('Meeting created');
      window.location.href = `/v2/app/meetings/${m.id}`;
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not create');
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Meetings</h1>
          <p className="text-gray-500 text-sm mt-1">V2-managed rooms with org billing context.</p>
        </div>
        <button
          type="button"
          onClick={createNow}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          New meeting now
        </button>
      </div>
      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : meetings.length === 0 ? (
        <p className="text-gray-500 text-sm">No meetings yet. Create one above or schedule from Schedule.</p>
      ) : (
        <ul className="space-y-2">
          {meetings.map((m) => (
            <li key={m.id}>
              <Link
                to={`/v2/app/meetings/${m.id}`}
                className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/30 px-4 py-3 hover:border-gray-600 transition-colors"
              >
                <span className="text-white font-medium">{m.title || m.livekit_room_name}</span>
                <span className="text-xs text-gray-500 uppercase">{m.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
