import { Navigate, useLocation } from 'react-router-dom'

/**
 * Legacy /preview and /preview/* routes redirect cleanly to the live / and /blog routes.
 */
export default function PreviewStaticRedirect() {
  const { pathname, search, hash } = useLocation()
  const clean = pathname.replace(/\/index\.html$/, '').replace(/\/$/, '')

  if (clean === '/preview/blog' || clean.startsWith('/preview/blog/')) {
    const rest = clean.slice('/preview'.length)
    return <Navigate to={`${rest}${search || ''}${hash || ''}`} replace />
  }

  return <Navigate to={`/${search || ''}${hash || ''}`} replace />
}
