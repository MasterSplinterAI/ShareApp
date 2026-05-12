import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Orgs, v2Billing } from '../../services/apiV2';

export default function V2AppHome() {
  const [data, setData] = useState(null);
  const [sub, setSub] = useState(null);

  useEffect(() => {
    Promise.all([v2Orgs.me(), v2Billing.subscription()])
      .then(([o, s]) => {
        setData(o);
        setSub(s);
      })
      .catch((e) => {
        toast.error(e.response?.data?.error || 'Could not load workspace');
      });
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white mb-2">Workspace</h1>
      <p className="text-gray-400 text-sm mb-8">
        {data?.org?.name ? (
          <>
            Organization: <span className="text-gray-200">{data.org.name}</span>
          </>
        ) : (
          'Loading…'
        )}
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Link
          to="/v2/app/meetings"
          className="block rounded-xl border border-gray-800 bg-gray-800/40 p-5 hover:border-blue-500/50 transition-colors"
        >
          <h2 className="font-medium text-white mb-1">Meetings</h2>
          <p className="text-sm text-gray-500">Create, list, and join meetings.</p>
        </Link>
        <Link
          to="/v2/app/schedule"
          className="block rounded-xl border border-gray-800 bg-gray-800/40 p-5 hover:border-blue-500/50 transition-colors"
        >
          <h2 className="font-medium text-white mb-1">Schedule</h2>
          <p className="text-sm text-gray-500">Future meetings and invite links.</p>
        </Link>
        <Link
          to="/v2/app/host"
          className="block rounded-xl border border-gray-800 bg-gray-800/40 p-5 hover:border-blue-500/50 transition-colors"
        >
          <h2 className="font-medium text-white mb-1">Host console</h2>
          <p className="text-sm text-gray-500">Participants, remove, end room.</p>
        </Link>
        <Link
          to="/v2/app/files"
          className="block rounded-xl border border-gray-800 bg-gray-800/40 p-5 hover:border-blue-500/50 transition-colors"
        >
          <h2 className="font-medium text-white mb-1">Files</h2>
          <p className="text-sm text-gray-500">Upload and download org-scoped attachments.</p>
        </Link>
        <Link
          to="/v2/app/settings"
          className="block rounded-xl border border-gray-800 bg-gray-800/40 p-5 hover:border-blue-500/50 transition-colors"
        >
          <h2 className="font-medium text-white mb-1">Settings</h2>
          <p className="text-sm text-gray-500">Members and organization access.</p>
        </Link>
      </div>
      <div className="mt-8 rounded-xl border border-gray-800 bg-gray-800/20 p-5">
        <h2 className="font-medium text-white mb-1">Subscription</h2>
        <p className="text-sm text-gray-500">
          Plan: <span className="text-gray-300">{sub?.plan?.name || '—'}</span> · Status:{' '}
          <span className="text-gray-300">{sub?.subscription?.status || '—'}</span>
        </p>
      </div>
    </div>
  );
}
