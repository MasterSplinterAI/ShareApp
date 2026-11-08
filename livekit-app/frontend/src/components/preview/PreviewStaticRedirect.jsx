import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * /preview/* pages are static HTML under public/preview (a 1:1 port of the Lalia Journal
 * WordPress build). nginx serves them before the SPA; this only catches in-app navigation
 * and the Vite dev server. The .html guard stops a redirect loop if a page is missing.
 */
export default function PreviewStaticRedirect() {
  const { pathname, search, hash } = useLocation()

  useEffect(() => {
    if (pathname.endsWith('.html')) return
    window.location.replace(`${pathname.replace(/\/$/, '')}/index.html${search}${hash}`)
  }, [pathname, search, hash])

  return null
}
