import { Link, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, LayoutDashboard } from 'lucide-react';

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
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <Link to={token ? '/v2/app' : '/v2/login'} className="font-semibold text-white tracking-tight flex items-center gap-2">
            <LayoutDashboard className="w-5 h-5 text-blue-400" />
            Conference V2
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            {token && (
              <>
                <Link to="/v2/app/meetings" className="text-gray-400 hover:text-white transition-colors">
                  Meetings
                </Link>
                <Link to="/v2/app/schedule" className="text-gray-400 hover:text-white transition-colors">
                  Schedule
                </Link>
        <Link
          to="/v2/app/files"
          className="text-gray-400 hover:text-white transition-colors"
        >
          Files
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
