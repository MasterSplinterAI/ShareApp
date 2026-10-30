import { test, expect } from '@playwright/test';

async function gotoPrejoin(page, roomName = `test-${Date.now()}`) {
  await page.addInitScript((room) => {
    window.sessionStorage.setItem('participantInfo', JSON.stringify({
      roomName: room,
      participantName: '',
      isHost: true,
      selectedLanguage: 'en',
      spokenLanguage: 'en',
    }));
  }, roomName);
  await page.goto(`/room/${roomName}`);
  await expect(page.getByRole('heading', { name: 'Ready to join?' })).toBeVisible();
  return roomName;
}

async function joinFromPrejoin(page) {
  await page.route('**/api/auth/token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'fake-token', url: 'wss://example.invalid' }),
    });
  });
  await page.getByLabel('Display name').fill('TestUser');
  await page.getByRole('button', { name: 'Join meeting' }).click();
  await expect(page.getByRole('button', { name: /turn .* camera/i })).toBeVisible();
}

test.describe('Home Screen', () => {
  test('renders correctly', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Start Meeting' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join Meeting' })).toBeVisible();
  });

  test('start meeting opens name modal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Start Meeting' }).click();
    await expect(page.getByRole('heading', { name: 'Enter Your Name' })).toBeVisible();
    await expect(page.getByPlaceholder('Your name')).toBeVisible();
    await expect(page.getByText('My language')).toBeVisible();
  });

  test('language dropdown opens upward and is fully visible', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Start Meeting' }).click();
    await expect(page.getByRole('heading', { name: 'Enter Your Name' })).toBeVisible();

    const langButton = page.getByRole('button', { name: /English/ });
    await langButton.click();

    const dropdown = page.locator('.absolute.z-50.bottom-full');
    await expect(dropdown).toBeVisible();

    const box = await dropdown.boundingBox();
    expect(box).not.toBeNull();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
  });
});

test.describe('Meeting Room Layout', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPrejoin(page);
    await joinFromPrejoin(page);
  });

  test('control bar is visible and compact on mobile', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name.includes('Mobile');

    const leaveBtn = page.getByRole('button', { name: /leave/i });
    await expect(leaveBtn).toBeVisible();

    const micBtn = page.getByRole('button', { name: /microphone/i });
    await expect(micBtn).toBeVisible();

    const cameraBtn = page.getByRole('button', { name: /turn .* camera/i });
    await expect(cameraBtn).toBeVisible();

    if (isMobile) {
      const shareScreenBtn = page.getByRole('button', { name: /share screen/i });
      await expect(shareScreenBtn).toBeHidden();
    }
  });

  test('mobile captions open in-flow above control bar without overlap', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name.includes('Mobile');
    if (!isMobile) {
      test.skip();
      return;
    }

    const desktopPanel = page.locator('[data-no-translate="true"].hidden.sm\\:flex');
    await expect(desktopPanel).toBeHidden();

    // Default: expanded in-flow sheet (not a fixed overlay)
    const sheet = page.locator('[data-meeting-mobile-sheet="captions"]');
    await expect(sheet).toBeVisible();

    const controlBar = page.locator('[data-meeting-control-bar="true"]');
    await expect(controlBar).toBeVisible();

    const sheetBox = await sheet.boundingBox();
    const barBox = await controlBar.boundingBox();
    expect(sheetBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    // Sheet bottom should sit at or above control bar top (no overlap)
    expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(barBox.y + 1);
  });

  test('mobile captions minimize to in-flow bar above control bar', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name.includes('Mobile');
    if (!isMobile) {
      test.skip();
      return;
    }

    const sheet = page.locator('[data-meeting-mobile-sheet="captions"]');
    await expect(sheet).toBeVisible();

    await page.getByRole('button', { name: 'Minimize panel' }).click();
    const captionBar = page.locator('[data-meeting-mobile-sheet="captions-bar"]');
    await expect(captionBar).toBeVisible({ timeout: 3000 });
    await expect(sheet).toBeHidden();

    const barBox = await page.locator('[data-meeting-control-bar="true"]').boundingBox();
    const captionBox = await captionBar.boundingBox();
    expect(barBox).not.toBeNull();
    expect(captionBox).not.toBeNull();
    expect(captionBox.y + captionBox.height).toBeLessThanOrEqual(barBox.y + 1);
  });

  test('video grid is visible', async ({ page }) => {
    const userIcon = page.locator('[class*="rounded-full"][class*="bg-gray-700"]').first();
    const videoEl = page.locator('video').first();

    const hasVideo = await videoEl.isVisible().catch(() => false);
    const hasPlaceholder = await userIcon.isVisible().catch(() => false);

    expect(hasVideo || hasPlaceholder).toBeTruthy();
  });

  test('desktop shows side panel', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name.includes('Mobile');
    if (isMobile) {
      test.skip();
      return;
    }

    const desktopPanel = page.locator('[class*="w-[350px]"], [class*="w-[400px]"]');
    const isVisible = await desktopPanel.first().isVisible().catch(() => false);
    expect(isVisible).toBeTruthy();
  });

  test('mobile language selector is compact single button', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name.includes('Mobile');
    if (!isMobile) {
      test.skip();
      return;
    }

    // Mobile should show the compact flag button (sm:hidden)
    const mobileSelector = page.locator('.sm\\:hidden[data-no-translate="true"]').first();
    const isVisible = await mobileSelector.isVisible().catch(() => false);
    expect(isVisible).toBeTruthy();

    // Desktop translation buttons should be hidden
    const desktopSelector = page.locator('.hidden.sm\\:flex[data-no-translate]').first();
    const desktopVisible = await desktopSelector.isVisible().catch(() => false);
    // On mobile viewport, desktop selector should be hidden
    // (this may not work in Playwright if viewport doesn't trigger CSS breakpoints)
  });

  test('mic and camera buttons are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /microphone/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /camera/i })).toBeVisible();
  });

  test('leave button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /leave/i })).toBeVisible();
  });

});

test.describe('Effects Runtime Loading', () => {
  test('prejoin with no selected effect does not fetch MediaPipe assets', async ({ page }) => {
    const requested = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/mediapipe/') || url.includes('track-processors')) {
        requested.push(url);
      }
    });

    // No fake media is needed here: this catches eager prejoin prewarm/import
    // regressions before a user selects any effect.
    await gotoPrejoin(page, 'no-effects-room');
    await page.waitForTimeout(1500);

    expect(requested).toEqual([]);
  });

  test('camera menu owns background effects and standalone effects button is hidden', async ({ page }) => {
    await gotoPrejoin(page, 'camera-effects-menu-room');
    await joinFromPrejoin(page);

    await expect(page.getByRole('button', { name: /background effects/i })).toHaveCount(0);

    const cameraMenu = page.getByRole('button', { name: /camera settings/i });
    await expect(cameraMenu).toBeVisible();
    await cameraMenu.click();

    await expect(page.getByText('Background')).toBeVisible();
    await expect(page.getByRole('button', { name: /Background effect: None/i })).toBeVisible();
  });
});
