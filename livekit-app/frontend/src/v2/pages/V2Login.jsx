import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Auth } from '../../services/apiV2';

export default function V2Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await v2Auth.login({ email, password });
      localStorage.setItem('v2_token', data.token);
      toast.success('Signed in');
      navigate('/v2/app/meetings', { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-semibold text-white mb-1">Sign in</h1>
      <p className="text-gray-500 text-sm mb-8">V2 workspace — same dark theme, SaaS controls.</p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
            autoComplete="email"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
            autoComplete="current-password"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium transition-colors"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-gray-500">
        No account?{' '}
        <Link to="/v2/signup" className="text-blue-400 hover:text-blue-300">
          Create organization
        </Link>
      </p>
      <p className="mt-4 text-center">
        <Link to="/" className="text-sm text-gray-600 hover:text-gray-400">
          Back to classic home
        </Link>
      </p>
    </div>
  );
}
