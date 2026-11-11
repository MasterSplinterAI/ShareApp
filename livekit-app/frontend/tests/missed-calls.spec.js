import { test, expect } from '@playwright/test';

async function setupCalls(page, { failRead = false, beforeRead } = {}) {
  const calls = [{
    id: 'missed-1', direction: 'incoming', status: 'missed', readAt: null,
    counterpartName: 'Maria', counterpartEmail: 'maria@example.com',
    createdAt: new Date().toISOString(), meetingId: 'meeting-1',
  }];
  const acknowledgements = [];
  await page.addInitScript(() => {
    localStorage.setItem('v2_token', 'test-only-token');
    localStorage.setItem('lalia_onboarding_completed_v1', '1');
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path.endsWith('/auth/me')) {
      body = { user: { id: 'recipient', display_name: 'Test User', preferredLanguage: 'en' }, org: { id: 'org', name: 'Personal', account_type: 'personal' }, role: 'owner' };
    } else if (path.endsWith('/calls/history/read')) {
      const ids = route.request().postDataJSON().callIds;
      acknowledgements.push(ids);
      if (beforeRead) await beforeRead();
      if (failRead) {
        return route.fulfill({ status: 500, json: { error: 'Test failure' } });
      }
      calls.forEach((call) => { if (ids.includes(call.id)) call.readAt = new Date().toISOString(); });
      body = { ok: true };
    } else if (path.endsWith('/calls/history')) {
      body = { calls };
    } else if (path.endsWith('/contacts')) {
      body = { contacts: [], addedYou: [] };
    } else if (path.endsWith('/meetings')) {
      body = { meetings: [] };
    } else if (path.endsWith('/calls/incoming')) {
      body = { incomingCalls: [] };
    } else if (path.endsWith('/billing/plans')) {
      body = { plans: [] };
    }
    return route.fulfill({ status: 200, json: body });
  });
  return { calls, acknowledgements };
}

test('viewing the call log clears the home alert, preserves history, and leaves new calls unread', async ({ page }) => {
  const { calls, acknowledgements } = await setupCalls(page);
  await page.goto('/v2/app');
  await expect(page.getByText('Missed call from Maria', { exact: true })).toBeVisible();
  expect(acknowledgements).toEqual([]);
  await page.getByRole('link', { name: 'View call log' }).click();
  await expect(page).toHaveURL(/\/calls\?tab=history$/);
  await expect(page.getByText('Maria', { exact: true })).toBeVisible();
  await expect.poll(() => acknowledgements.length).toBeGreaterThan(0);
  expect(acknowledgements[0]).toEqual(['missed-1']);
  await expect(page.getByRole('button', { name: /^Missed/ })).toHaveText('Missed');
  await page.goto('/v2/app');
  await expect(page.getByRole('heading', { name: /Test/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View call log' })).toHaveCount(0);

  calls.push({ ...calls[0], id: 'missed-2', counterpartName: 'Alex', readAt: null });
  await page.reload();
  await expect(page.getByText('Missed call from Alex', { exact: true })).toBeVisible();
});

test('contacts alone do not acknowledge calls; the Missed tab does', async ({ page }) => {
  const { acknowledgements } = await setupCalls(page);
  await page.goto('/v2/app/calls');
  const missedTab = page.getByRole('button', { name: /^Missed/ });
  await expect(missedTab).toHaveText(/Missed\s*1/);
  expect(acknowledgements).toEqual([]);
  await missedTab.click();
  await expect(page.getByText('Maria', { exact: true })).toBeVisible();
  await expect(missedTab).toHaveText('Missed');
  expect(acknowledgements[0]).toEqual(['missed-1']);
});

test('a failed acknowledgement leaves the missed-call alert unread', async ({ page }) => {
  await setupCalls(page, { failRead: true });
  await page.goto('/v2/app/calls?tab=history');
  await expect(page.getByText('Could not mark missed calls as read. Reopen call history to retry.')).toBeVisible();
  await page.goto('/v2/app');
  await expect(page.getByText('Missed call from Maria', { exact: true })).toBeVisible();
});

test('returning home while acknowledgement is saving does not retain a stale alert', async ({ page }) => {
  let finishRead;
  const saved = new Promise((resolve) => { finishRead = resolve; });
  const { acknowledgements } = await setupCalls(page, { beforeRead: () => saved });
  await page.goto('/v2/app/calls?tab=history');
  await expect.poll(() => acknowledgements.length).toBeGreaterThan(0);
  // Use client-side navigation: the pending request must survive leaving the log.
  await page.locator('a[href="/v2/app"]').first().click();
  await expect(page).toHaveURL(/\/v2\/app$/);
  // Home must not display stale unread calls while the write is pending.
  await expect(page.getByRole('link', { name: 'View call log' })).toHaveCount(0);
  finishRead();
  await expect(page.getByRole('heading', { name: /Test/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View call log' })).toHaveCount(0);
});
