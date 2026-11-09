/**
 * Generates live Lalia Blue studio static pages (`public/studio-home.html`,
 * `public/blog/index.html`, and `public/blog/<slug>/index.html`) plus
 * `public/studio-assets/` by running `port.py`.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
execFileSync('python3', [path.join(__dirname, 'port.py')], { stdio: 'inherit' })
