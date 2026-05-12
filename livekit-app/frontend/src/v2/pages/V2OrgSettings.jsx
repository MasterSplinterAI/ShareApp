import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Auth, v2Orgs } from '../../services/apiV2';

export default function V2OrgSettings() {
  const [role, setRole] = useState('');
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState('');
  const [memberRole, setMemberRole] = useState('member');
  const [loading, setLoading] = useState(true);

  const load = () => {
    Promise.all([v2Auth.me(), v2Orgs.listMembers()])
      .then(([me, m]) => {
        setRole(me.role || '');
        setMembers(m.members || []);
      })
      .catch((e) => toast.error(e.response?.data?.error || 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const canManage = ['owner', 'admin'].includes(role);

  const addMember = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      await v2Orgs.addMember({ email: email.trim(), role: memberRole });
      toast.success('Member added');
      setEmail('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Add failed');
    }
  };

  const remove = async (userId) => {
    if (!window.confirm('Remove this member from the organization?')) return;
    try {
      await v2Orgs.removeMember(userId);
      toast.success('Removed');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Remove failed');
    }
  };

  if (loading) {
    return <p className="text-gray-500 text-sm">Loading…</p>;
  }

  return (
    <div className="max-w-2xl">
      <Link to="/v2/app" className="text-sm text-blue-400 hover:text-blue-300 mb-4 inline-block">
        ← Workspace
      </Link>
      <h1 className="text-2xl font-semibold text-white mb-2">Organization</h1>
      <p className="text-gray-500 text-sm mb-8">Your role: <span className="text-gray-300">{role}</span></p>

      <div className="rounded-lg border border-gray-800 bg-gray-800/30 p-5 mb-8">
        <h2 className="text-white font-medium mb-4">Members</h2>
        {!canManage && <p className="text-sm text-gray-500">Only owners and admins can manage members.</p>}
        {canManage && (
          <form onSubmit={addMember} className="flex flex-col sm:flex-row gap-2 mb-6">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="flex-1 rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-white text-sm"
            />
            <select
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value)}
              className="rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-white text-sm"
            >
              <option value="member">Member</option>
              {role === 'owner' && <option value="admin">Admin</option>}
            </select>
            <button
              type="submit"
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2"
            >
              Add
            </button>
          </form>
        )}
        <ul className="space-y-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between rounded-lg border border-gray-700/80 bg-gray-900/40 px-3 py-2 text-sm"
            >
              <div>
                <div className="text-gray-200">{m.email}</div>
                <div className="text-xs text-gray-500">{m.display_name || '—'} · {m.role}</div>
              </div>
              {canManage && m.role !== 'owner' && (
                <button type="button" onClick={() => remove(m.id)} className="text-xs text-red-400 hover:text-red-300">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
