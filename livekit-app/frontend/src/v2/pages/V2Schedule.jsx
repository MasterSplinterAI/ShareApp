import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Meetings } from '../../services/apiV2';

export default function V2Schedule() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [hostRequired, setHostRequired] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const iso = start ? new Date(start).toISOString() : null;
      const m = await v2Meetings.create({
        title: title || 'Scheduled meeting',
        scheduled_start: iso,
        host_required_to_start: hostRequired,
      });
      toast.success(m.status === 'scheduled' ? 'Scheduled' : 'Meeting created');
      navigate(`/v2/app/meetings/${m.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-semibold text-white mb-2">Schedule meeting</h1>
      <p className="text-gray-500 text-sm mb-8">Pick a future start time to keep status as scheduled until you go live.</p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white"
            placeholder="Team standup"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Start (local)</label>
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input type="checkbox" checked={hostRequired} onChange={(e) => setHostRequired(e.target.checked)} />
          Guests wait until host joins first
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium"
        >
          {loading ? 'Saving…' : 'Create'}
        </button>
      </form>
    </div>
  );
}
