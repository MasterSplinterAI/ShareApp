#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const profileDir =
  process.env.GOOGLE_USER_DATA_DIR ||
  path.join(__dirname, '..', 'google-bot-profile');

const outPath =
  process.env.GOOGLE_STORAGE_STATE_PATH ||
  path.join(__dirname, '..', 'google-bot-storage-state.json');

(async () => {
  fs.mkdirSync(profileDir, { recursive: true });
  console.log('[google-login] Opening persistent Chrome profile for Lalia Bot Google account…');
  console.log(`[google-login] Profile directory: ${profileDir}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: process.env.BROWSER_CHANNEL || (process.platform === 'darwin' ? 'chrome' : undefined),
    headless: false,
    args: ['--window-size=1100,780'],
    viewport: { width: 1100, height: 780 },
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://accounts.google.com/ServiceLogin?continue=https://meet.google.com/', {
    waitUntil: 'domcontentloaded',
  });

  console.log('[google-login] Waiting for sign-in to reach https://meet.google.com/ …');
  await page.waitForURL((url) => url.hostname === 'meet.google.com', {
    timeout: 600_000,
  });
  await page.waitForTimeout(3000);

  await context.storageState({ path: outPath });
  fs.writeFileSync(path.join(profileDir, '.signed_in'), new Date().toISOString());
  console.log(`[google-login] Saved persistent Google bot profile to ${profileDir}`);
  await context.close();
})().catch((err) => {
  console.error('[google-login] Failed:', err.message);
  process.exit(1);
});
