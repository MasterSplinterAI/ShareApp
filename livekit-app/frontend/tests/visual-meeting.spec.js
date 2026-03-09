import { test, expect, devices } from '@playwright/test';

const VIEWPORTS = {
  'iphone-portrait': { width: 390, height: 844 },
  'iphone-landscape': { width: 844, height: 390 },
  'pixel-portrait': { width: 412, height: 915 },
  'pixel-landscape': { width: 915, height: 412 },
  'ipad-portrait': { width: 768, height: 1024 },
  'ipad-landscape': { width: 1024, height: 768 },
  'desktop': { width: 1280, height: 720 },
};

async function createAndJoinMeeting(page, name, language = 'en') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start Meeting' }).click();
  await expect(page.getByPlaceholder('Your name')).toBeVisible({ timeout: 10000 });
  await page.getByPlaceholder('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/room\//, { timeout: 15000 });
  await page.waitForTimeout(3000);
}

async function joinExistingMeeting(page, joinUrl, name, language = 'en') {
  await page.goto(joinUrl);
  await page.waitForTimeout(2000);

  // Could be name modal or invite start screen
  const nameInput = page.getByPlaceholder('Your name');
  const startBtn = page.getByRole('button', { name: 'Start Meeting' });

  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
    await page.waitForTimeout(3000);
    await expect(nameInput).toBeVisible({ timeout: 10000 });
  } else {
    await expect(nameInput).toBeVisible({ timeout: 10000 });
  }

  await nameInput.fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/room\//, { timeout: 15000 });
  await page.waitForTimeout(3000);
}

// Run only on Desktop Chrome project to avoid duplication -- we control viewports manually
test.describe('Visual Meeting Screenshots', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only');

  test('two participants - all viewports', async ({ browser }) => {
    // Create host context at desktop size
    const hostContext = await browser.newContext({
      viewport: VIEWPORTS['desktop'],
      permissions: ['camera', 'microphone'],
    });
    const hostPage = await hostContext.newPage();

    // Host creates meeting
    await createAndJoinMeeting(hostPage, 'Host');

    // Get the room URL from the current page URL
    const roomUrl = hostPage.url();
    const roomName = roomUrl.match(/\/room\/(.+?)(\?|$)/)?.[1];
    expect(roomName).toBeTruthy();
    const joinUrl = `http://localhost:5174/join/${roomName}`;

    // Screenshot host alone at desktop
    await hostPage.screenshot({ path: 'test-results/visual/desktop-host-alone.png', fullPage: false });

    // Create guest context at desktop size
    const guestContext = await browser.newContext({
      viewport: VIEWPORTS['desktop'],
      permissions: ['camera', 'microphone'],
    });
    const guestPage = await guestContext.newPage();
    await joinExistingMeeting(guestPage, joinUrl, 'Guest');

    // Wait for both to see each other
    await hostPage.waitForTimeout(2000);
    await guestPage.waitForTimeout(2000);

    // Desktop screenshots - 2 participants
    await hostPage.screenshot({ path: 'test-results/visual/desktop-2p-host.png', fullPage: false });
    await guestPage.screenshot({ path: 'test-results/visual/desktop-2p-guest.png', fullPage: false });

    // Now resize host page through all mobile viewports and screenshot
    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      await hostPage.setViewportSize(viewport);
      await hostPage.waitForTimeout(500);
      await hostPage.screenshot({ path: `test-results/visual/${name}-2p.png`, fullPage: false });
    }

    // Close guest, screenshot host alone in mobile viewports
    await guestContext.close();
    await hostPage.waitForTimeout(1000);

    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      await hostPage.setViewportSize(viewport);
      await hostPage.waitForTimeout(500);
      await hostPage.screenshot({ path: `test-results/visual/${name}-1p.png`, fullPage: false });
    }

    await hostContext.close();
  });
});
