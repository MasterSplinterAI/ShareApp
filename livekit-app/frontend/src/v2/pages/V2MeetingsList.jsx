import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { v2Meetings } from '../../services/apiV2';
import { getMeetingUiState, toneClasses } from '../lib/meetingState';

export default function V2MeetingsList() {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('Instant meeting');
  const [hostRequired, setHostRequired] = useState(false);

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
      const m = await v2Meetings.create({
        title: newTitle.trim() || 'Instant meeting',
        host_required_to_start: hostRequired,
      });
      toast.success('Meeting created');
      setShowCreate(false);
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
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          New meeting
        </button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-xl">
            <h2 className="text-lg font-medium text-white mb-4">Create meeting</h2>
            <label className="block text-xs text-gray-500 mb-1">Title</label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full rounded-lg bg-gray-800 border border-gray-600 px-3 py-2 text-white mb-4"
            />
            <label className="flex items-center gap-2 text-sm text-gray-300 mb-6 cursor-pointer">
              <input type="checkbox" checked={hostRequired} onChange={(e) => setHostRequired(e.target.checked)} />
              Guests wait until you join first
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
                Cancel
              </button>
              <button type="button" onClick={createNow} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium">
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : meetings.length === 0 ? (
        <p className="text-gray-500 text-sm">No meetings yet. Create one above or schedule from Schedule.</p>
      ) : (
        <ul className="space-y-2">
          {meetings.map((m) => {
            const ui = getMeetingUiState(m);
            return (
              <li key={m.id}>
                <Link
                  to={`/v2/app/meetings/${m.id}`}
                  className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/30 px-4 py-3 hover:border-gray-600 transition-colors gap-3"
                >
                  <div className="min-w-0">
                    <span className="text-white font-medium block truncate">{m.title || m.livekit_room_name}</span>
                    {m.scheduled_start && (
                      <span className="text-xs text-gray-500 block mt-0.5">
                        {new Date(m.scheduled_start).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <span className={`text-xs uppercase shrink-0 rounded border px-2 py-0.5 ${toneClasses(ui.tone)}`}>{ui.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
