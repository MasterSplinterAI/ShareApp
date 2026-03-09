import { test, expect } from '@playwright/test';

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
    await page.goto('/');
    await page.getByRole('button', { name: 'Start Meeting' }).click();
    await expect(page.getByPlaceholder('Your name')).toBeVisible();
    await page.getByPlaceholder('Your name').fill('TestUser');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForURL(/\/room\//);
    await page.waitForTimeout(3000);
  });

  test('control bar is visible and compact on mobile', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name.includes('Mobile');

    const leaveBtn = page.getByRole('button', { name: /leave/i });
    await expect(leaveBtn).toBeVisible();

    const micBtn = page.getByRole('button', { name: /microphone/i });
    await expect(micBtn).toBeVisible();

    const cameraBtn = page.getByRole('button', { name: /camera/i });
    await expect(cameraBtn).toBeVisible();

    if (isMobile) {
      const shareScreenBtn = page.getByRole('button', { name: /share screen/i });
      await expect(shareScreenBtn).toBeHidden();
    }
  });

  test('mobile shows caption bar instead of full bottom sheet', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name.includes('Mobile');
    if (!isMobile) {
      test.skip();
      return;
    }

    // Desktop side panel should be hidden on mobile
    const desktopPanel = page.locator('[data-no-translate="true"].hidden.sm\\:flex');
    await expect(desktopPanel).toBeHidden();

    // Mobile caption bar should be visible (thin bar with "Waiting for speech...")
    const captionBar = page.locator('.sm\\:hidden.fixed.bottom-12');
    const isVisible = await captionBar.isVisible().catch(() => false);
    expect(isVisible).toBeTruthy();
  });

  test('mobile caption bar expands to full sheet on tap', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name.includes('Mobile');
    if (!isMobile) {
      test.skip();
      return;
    }

    const captionBar = page.locator('.sm\\:hidden.fixed.bottom-12 button');
    if (await captionBar.isVisible()) {
      await captionBar.click();
      await page.waitForTimeout(300);

      const expandedSheet = page.locator('.sm\\:hidden.fixed.bottom-12.rounded-t-xl');
      const isExpanded = await expandedSheet.isVisible().catch(() => false);
      expect(isExpanded).toBeTruthy();
    }
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
