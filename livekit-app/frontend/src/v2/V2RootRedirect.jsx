import { Navigate } from 'react-router-dom';

export default function V2RootRedirect() {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('v2_token') : null;
  return <Navigate to={token ? '/v2/app' : '/v2/login'} replace />;
}
