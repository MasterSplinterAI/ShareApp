/**
 * Post-build prerender for marketing routes.
 * Serves dist/, loads each route in Chromium, writes HTML shells so crawlers
 * see title/H1/FAQ body without waiting on the full app JS graph.
 * Finally promotes dist/studio-home.html -> dist/index.html so the live Lalia Blue
 * studio home page is served at / while preserving dist/app-index.html for SPA routes.
 */
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, access, copyFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../dist')
const PORT = 4179

const ROUTES = ['/demo', '/terms', '/privacy', '/v2/signup']

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
}

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

function startStaticServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
      let pathname = decodeURIComponent(url.pathname)
      if (pathname.endsWith('/')) pathname += 'index.html'

      let filePath = path.join(DIST, pathname)
      if (!(await exists(filePath))) {
        // SPA fallback while capturing routes that are not yet prerendered
        filePath = path.join(DIST, 'app-index.html')
        if (!(await exists(filePath))) {
          filePath = path.join(DIST, 'index.html')
        }
      }

      const ext = path.extname(filePath)
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
      createReadStream(filePath).pipe(res)
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

function outPathForRoute(route) {
  if (route === '/') return path.join(DIST, 'index.html')
  return path.join(DIST, route.replace(/^\//, ''), 'index.html')
}

async function promoteStudioHome() {
  const indexHtml = path.join(DIST, 'index.html')
  const appIndexHtml = path.join(DIST, 'app-index.html')
  const studioHomeHtml = path.join(DIST, 'studio-home.html')

  if (await exists(indexHtml)) {
    await copyFile(indexHtml, appIndexHtml)
  }
  if (await exists(studioHomeHtml)) {
    await copyFile(studioHomeHtml, indexHtml)
    console.log('prerender: promoted studio-home.html -> dist/index.html (SPA shell saved as dist/app-index.html)')
  }
}

async function main() {
  if (!(await exists(path.join(DIST, 'index.html')))) {
    console.error('prerender: dist/index.html missing — run vite build first')
    process.exit(1)
  }

  // Save SPA index.html as app-index.html before prerendering
  await copyFile(path.join(DIST, 'index.html'), path.join(DIST, 'app-index.html'))

  // Stamp build-date <lastmod> into dist/sitemap.xml for Google Search Console
  const sitemapPath = path.join(DIST, 'sitemap.xml')
  if (await exists(sitemapPath)) {
    try {
      const today = new Date().toISOString().slice(0, 10)
      const xml = await readFile(sitemapPath, 'utf8')
      if (!xml.includes('<lastmod>')) {
        const stamped = xml.replace(/<\/loc>/g, `</loc>\n    <lastmod>${today}</lastmod>`)
        await writeFile(sitemapPath, stamped, 'utf8')
      }
    } catch {
      /* non-fatal */
    }
  }

  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (err) {
    console.warn('prerender: skipping Chromium — promoting studio-home.html directly')
    console.warn(String(err?.message || err))
    await promoteStudioHome()
    process.exit(0)
  }

  const server = await startStaticServer()
  const page = await browser.newPage()

  try {
    for (const route of ROUTES) {
      const url = `http://127.0.0.1:${PORT}${route}`
      console.log(`prerender: ${route}`)
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
      await page.waitForSelector('h1, [data-seo-ready]', { timeout: 20000 }).catch(() => {})
      await new Promise((r) => setTimeout(r, 500))
      const html = await page.content()
      const out = outPathForRoute(route)
      await mkdir(path.dirname(out), { recursive: true })
      await writeFile(out, html, 'utf8')
      console.log(`  → ${path.relative(DIST, out)} (${(html.length / 1024).toFixed(1)} KB)`)
    }
  } finally {
    await browser.close()
    server.close()
  }

  await promoteStudioHome()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
