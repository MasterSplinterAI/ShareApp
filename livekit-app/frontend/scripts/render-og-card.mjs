import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcHtml = resolve(__dirname, 'og-card-source.html');
const outPng = resolve(__dirname, '../public/marketing/og-card.png');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});
await page.goto('file://' + srcHtml, { waitUntil: 'networkidle' });
// Give the web font a moment to swap in.
await page.evaluate(() => document.fonts && document.fonts.ready);
await page.waitForTimeout(400);
await page.screenshot({ path: outPng, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log('Wrote ' + outPng);
