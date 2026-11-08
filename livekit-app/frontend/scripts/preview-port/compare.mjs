import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [, , outDir, ...pairs] = process.argv; // pairs: name=url
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const viewports = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const report = [];
for (const pair of pairs) {
  const i = pair.indexOf('=');
  const name = pair.slice(0, i), url = pair.slice(i + 1);
  for (const [vp, size] of Object.entries(viewports)) {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('requestfailed', (r) => errors.push('FAILED ' + r.url()));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.addStyleTag({ content: '.lp-preview{display:none!important}' });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => ({
      h: document.documentElement.scrollHeight,
      font: getComputedStyle(document.querySelector('h1') || document.body).fontFamily,
      h1: (document.querySelector('h1')?.textContent || '').trim().slice(0, 80),
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    await page.screenshot({ path: `${outDir}/${name}-${vp}.png`, fullPage: true });
    report.push({ name, vp, ...info, errors: errors.slice(0, 5) });
    await page.close();
  }
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
