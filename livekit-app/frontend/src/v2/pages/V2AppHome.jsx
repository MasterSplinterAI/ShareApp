import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Users, Video, Settings } from 'lucide-react';
import { v2Orgs, v2Billing, v2Meetings } from '../../services/apiV2';
import { getMeetingUiState, toneClasses } from '../lib/meetingState';

export default function V2AppHome() {
  const [orgData, setOrgData] = useState(null);
  const [sub, setSub] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [membersCount, setMembersCount] = useState(0);

  useEffect(() => {
    Promise.all([v2Orgs.me(), v2Billing.subscription(), v2Meetings.list(), v2Orgs.listMembers()])
      .then(([o, s, mList, mem]) => {
        setOrgData(o);
        setSub(s);
        setMeetings(mList.meetings || []);
        setMembersCount((mem.members || []).length);
      })
      .catch((e) => {
        toast.error(e.response?.data?.error || 'Could not load workspace');
      });
  }, []);

  const recentMeetings = useMemo(() => meetings.slice(0, 5), [meetings]);

  const activeLive = useMemo(() => meetings.filter((m) => m.status === 'live').length, [meetings]);

  return (
    <div className="space-y-10">
      <section className="rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 via-gray-900 to-blue-950/40 p-8 sm:p-10">
        <p className="text-sm text-blue-400 font-medium mb-1">Workspace</p>
        <h1 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight mb-2">
          {orgData?.org?.name || 'Your organization'}
        </h1>
        <p className="text-gray-400 text-sm max-w-xl mb-6">
          Host translated meetings with screen share and live captions. Manage meetings and members from here.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/v2/app/meetings?create=1"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 text-sm font-semibold shadow-lg shadow-blue-900/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New meeting
          </Link>
          <Link
            to="/v2/app/meetings"
            className="inline-flex items-center gap-2 rounded-xl border border-gray-600 bg-gray-800/80 hover:bg-gray-800 text-gray-200 px-5 py-2.5 text-sm font-medium transition-colors"
          >
            <Video className="w-4 h-4" />
            All meetings
          </Link>
          <Link
            to="/v2/app/settings"
            className="inline-flex items-center gap-2 rounded-xl border border-gray-600 bg-gray-800/80 hover:bg-gray-800 text-gray-200 px-5 py-2.5 text-sm font-medium transition-colors"
          >
            <Settings className="w-4 h-4" />
            Settings
          </Link>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">At a glance</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-gray-800 bg-gray-800/30 px-5 py-4">
            <p className="text-xs text-gray-500 mb-1">Meetings</p>
            <p className="text-2xl font-semibold text-white">{meetings.length}</p>
            <p className="text-xs text-gray-500 mt-1">in this workspace</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-800/30 px-5 py-4">
            <p className="text-xs text-gray-500 mb-1">Live now</p>
            <p className="text-2xl font-semibold text-emerald-400">{activeLive}</p>
            <p className="text-xs text-gray-500 mt-1">status &quot;live&quot;</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-800/30 px-5 py-4">
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
              <Users className="w-3 h-3" /> Members
            </p>
            <p className="text-2xl font-semibold text-white">{membersCount}</p>
            <p className="text-xs text-gray-500 mt-1">organization</p>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-4 mb-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Recent meetings</h2>
          <Link to="/v2/app/meetings" className="text-xs text-blue-400 hover:text-blue-300">
            View all
          </Link>
        </div>
        {recentMeetings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/20 px-6 py-10 text-center">
            <p className="text-gray-400 text-sm mb-4">No meetings yet.</p>
            <Link
              to="/v2/app/meetings?create=1"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Create your first meeting
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {recentMeetings.map((m) => {
              const ui = getMeetingUiState(m);
              return (
                <li key={m.id}>
                  <Link
                    to={`/v2/app/meetings/${m.id}`}
                    className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-800/30 px-4 py-3 hover:border-gray-600 transition-colors gap-3"
                  >
                    <div className="min-w-0">
                      <span className="text-white font-medium block truncate">{m.title || m.livekit_room_name}</span>
                      {m.scheduled_start && (
                        <span className="text-xs text-gray-500">{new Date(m.scheduled_start).toLocaleString()}</span>
                      )}
                    </div>
                    <span className={`text-xs uppercase shrink-0 rounded border px-2 py-0.5 ${toneClasses(ui.tone)}`}>{ui.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-800/20 p-6">
        <h2 className="font-medium text-white mb-2">Subscription</h2>
        <p className="text-sm text-gray-500">
          Plan: <span className="text-gray-300">{sub?.plan?.name || '—'}</span>
          <span className="mx-2 text-gray-600">·</span>
          Status: <span className="text-gray-300">{sub?.subscription?.status || '—'}</span>
        </p>
      </section>
    </div>
  );
}
