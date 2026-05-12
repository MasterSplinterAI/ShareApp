import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Meetings, v2Host } from '../../services/apiV2';

export default function V2HostPanel() {
  const [meetings, setMeetings] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    v2Meetings
      .list()
      .then((r) => {
        const list = r.meetings || [];
        setMeetings(list);
        setSelectedId((prev) => prev || (list[0]?.id ?? ''));
      })
      .catch(() => {});
  }, []);

  const refreshParticipants = () => {
    if (!selectedId) return;
    setLoading(true);
    v2Host
      .participants(selectedId)
      .then((r) => setParticipants(r.participants || []))
      .catch(() => toast.error('Could not load participants'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refreshParticipants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const remove = async (identity) => {
    try {
      await v2Host.removeParticipant(selectedId, identity);
      toast.success('Removed');
      refreshParticipants();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Remove failed');
    }
  };

  const endMeeting = async () => {
    if (!selectedId) return;
    try {
      await v2Host.endMeeting(selectedId);
      toast.success('Meeting ended');
      const r = await v2Meetings.list();
      setMeetings(r.meetings || []);
      setParticipants([]);
    } catch (e) {
      toast.error(e.response?.data?.error || 'End failed');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white mb-2">Host console</h1>
      <p className="text-gray-500 text-sm mb-8">LiveKit roster and moderation for your org meetings.</p>
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-xs text-gray-500 mb-2">Meeting</label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white"
          >
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({m.status})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={endMeeting}
            className="mt-3 w-full py-2 rounded-lg border border-red-900/50 text-red-400 hover:bg-red-950/30 text-sm"
          >
            End meeting (delete LiveKit room)
          </button>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500">Participants</span>
            <button type="button" onClick={refreshParticipants} className="text-xs text-blue-400 hover:text-blue-300">
              Refresh
            </button>
          </div>
          {loading ? (
            <p className="text-gray-500 text-sm">Loading…</p>
          ) : participants.length === 0 ? (
            <p className="text-gray-500 text-sm">No participants (room may be empty).</p>
          ) : (
            <ul className="space-y-2">
              {participants.map((p) => (
                <li
                  key={p.sid || p.identity}
                  className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/30 px-3 py-2"
                >
                  <span className="text-sm text-gray-200 truncate">{p.name || p.identity}</span>
                  <button
                    type="button"
                    onClick={() => remove(p.identity)}
                    className="text-xs text-red-400 hover:text-red-300 shrink-0 ml-2"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
