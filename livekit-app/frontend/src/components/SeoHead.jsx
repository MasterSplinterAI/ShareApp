import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { resolveSeo } from '../lib/seoConfig'

/** Upsert a <meta> tag keyed by name or property attribute. */
function upsertMeta(attr, key, content) {
  if (content == null) return
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

/** Upsert or remove the canonical <link>. */
function upsertCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]')
  if (href == null) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

/**
 * Syncs document.title and head meta tags to the current route.
 * Rendered once inside <App />; updates on every location change.
 */
export default function SeoHead() {
  const location = useLocation()

  useEffect(() => {
    const seo = resolveSeo(location.pathname)
    const url = seo.canonical || `https://lalia.cloud${location.pathname}`

    document.title = seo.title

    upsertMeta('name', 'description', seo.description)
    upsertCanonical(seo.canonical)

    upsertMeta('property', 'og:title', seo.title)
    upsertMeta('property', 'og:description', seo.description)
    upsertMeta('property', 'og:url', url)
    upsertMeta('property', 'og:image', seo.ogImage)
    upsertMeta('property', 'og:type', seo.ogType || 'website')

    upsertMeta('name', 'twitter:card', 'summary_large_image')
    upsertMeta('name', 'twitter:title', seo.title)
    upsertMeta('name', 'twitter:description', seo.description)
    upsertMeta('name', 'twitter:image', seo.ogImage)

    if (seo.robots) {
      upsertMeta('name', 'robots', seo.robots)
    } else {
      // Marketing/indexable routes: make sure a stale noindex from a prior
      // route does not linger.
      upsertMeta('name', 'robots', 'index, follow')
    }

    // Scope FAQPage JSON-LD to the homepage (/) only so prerendered sub-pages
    // (/demo, /terms, /privacy, /v2/signup) do not ship duplicate FAQPage schema.
    const ldEl = document.getElementById('seo-jsonld')
    if (ldEl) {
      try {
        if (!ldEl.dataset.fullGraph) {
          ldEl.dataset.fullGraph = ldEl.textContent || ''
        }
        const full = JSON.parse(ldEl.dataset.fullGraph)
        if (location.pathname !== '/' && Array.isArray(full['@graph'])) {
          full['@graph'] = full['@graph'].filter((node) => node?.['@type'] !== 'FAQPage')
        }
        ldEl.textContent = JSON.stringify(full)
      } catch {
        /* ignore malformed json-ld */
      }
    }
  }, [location.pathname])

  return null
}
