import { Link, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, LayoutDashboard, Calendar, Shield, Users, FolderOpen, Radio } from 'lucide-react';

export default function V2Layout() {
  const navigate = useNavigate();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('v2_token') : null;

  const logout = () => {
    localStorage.removeItem('v2_token');
    navigate('/v2/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <Link to={token ? '/v2/app' : '/v2/login'} className="font-semibold text-white tracking-tight flex items-center gap-2">
            <LayoutDashboard className="w-5 h-5 text-blue-400" />
            Conference V2
          </Link>
          <nav className="flex items-center flex-wrap gap-x-4 gap-y-2 text-sm">
            {token && (
              <>
                <Link to="/v2/app" className="text-gray-400 hover:text-white transition-colors inline-flex items-center gap-1">
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  Workspace
                </Link>
                <Link to="/v2/app/meetings" className="text-gray-400 hover:text-white transition-colors inline-flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  Meetings
                </Link>
                <Link to="/v2/app/schedule" className="text-gray-400 hover:text-white transition-colors inline-flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  Schedule
                </Link>
                <Link to="/v2/app/host" className="text-gray-400 hover:text-white transition-colors inline-flex items-center gap-1">
                  <Radio className="w-3.5 h-3.5" />
                  Host
                </Link>
                <Link to="/v2/app/files" className="text-gray-400 hover:text-white transition-colors inline-flex items-center gap-1">
                  <FolderOpen className="w-3.5 h-3.5" />
                  Files
                </Link>
                <Link to="/v2/app/settings" className="text-gray-400 hover:text-white transition-colors inline-flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5" />
                  Settings
                </Link>
                <Link to="/v2/app/superadmin" className="text-gray-500 hover:text-amber-400 transition-colors text-xs">
                  Admin
                </Link>
                <button
                  type="button"
                  onClick={logout}
                  className="inline-flex items-center gap-1 text-gray-400 hover:text-red-400 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Log out
                </button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
