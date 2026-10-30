import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

export default function V2RequireAuth() {
  const navigate = useNavigate();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('v2_token') : null;

  useEffect(() => {
    if (!token) {
      navigate('/v2/login', { replace: true });
    }
  }, [token, navigate]);

  if (!token) {
    return (
      <div className="text-center text-gray-500 py-16 text-sm">Redirecting…</div>
    );
  }

  return <Outlet />;
}
