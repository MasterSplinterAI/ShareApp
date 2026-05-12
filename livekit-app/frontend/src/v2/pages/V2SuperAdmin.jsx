import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Orgs } from '../../services/apiV2';

export default function V2SuperAdmin() {
  const [allowed, setAllowed] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [billingEdit, setBillingEdit] = useState({});

  useEffect(() => {
    v2Orgs
      .adminPing()
      .then(() => setAllowed(true))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    v2Orgs
      .adminOrgs()
      .then((r) => setOrgs(r.orgs || []))
      .catch((e) => toast.error(e.response?.data?.error || 'Failed to load orgs'));
  }, [allowed]);

  const saveOrg = async (orgId) => {
    const status = billingEdit[orgId];
    if (!status) return;
    try {
      await v2Orgs.adminPatchOrg(orgId, { billing_status: status });
      toast.success('Updated');
      const r = await v2Orgs.adminOrgs();
      setOrgs(r.orgs || []);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Update failed');
    }
  };

  if (allowed === null) {
    return <p className="text-gray-500 text-sm">Checking access…</p>;
  }
  if (!allowed) {
    return (
      <div>
        <Link to="/v2/app" className="text-sm text-blue-400 hover:text-blue-300 mb-4 inline-block">
          ← Workspace
        </Link>
        <p className="text-gray-400">Superadmin is restricted. Set <code className="text-gray-300">V2_SUPERADMIN_EMAILS</code> on the server to include your account email.</p>
      </div>
    );
  }

  return (
    <div>
      <Link to="/v2/app" className="text-sm text-blue-400 hover:text-blue-300 mb-4 inline-block">
        ← Workspace
      </Link>
      <h1 className="text-2xl font-semibold text-white mb-2">Platform admin</h1>
      <p className="text-gray-500 text-sm mb-8">Cross-tenant overview (SQLite MVP).</p>
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-950 text-gray-400">
            <tr>
              <th className="px-3 py-2">Organization</th>
              <th className="px-3 py-2">Billing</th>
              <th className="px-3 py-2">Members</th>
              <th className="px-3 py-2">Meetings</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-t border-gray-800">
                <td className="px-3 py-2 text-gray-200">{o.name}</td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    defaultValue={o.billing_status}
                    onChange={(e) => setBillingEdit((prev) => ({ ...prev, [o.id]: e.target.value }))}
                    className="w-full max-w-[140px] rounded bg-gray-900 border border-gray-700 px-2 py-1 text-gray-200"
                  />
                </td>
                <td className="px-3 py-2 text-gray-400">{o.member_count}</td>
                <td className="px-3 py-2 text-gray-400">{o.meeting_count}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => saveOrg(o.id)}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Save billing
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
