import { test, expect } from '@playwright/test';

async function setupAccount(page, { subscriptionStatus = 'active', passwordCode, checkoutConflict = false } = {}) {
  const billingRequests = [];
  const plans = [
    { id: 'starter', name: 'Starter', monthly_price_cents: 1900, included_meeting_minutes: 2000, included_translation_minutes: 500 },
    { id: 'pro', name: 'Pro', monthly_price_cents: 4900, included_meeting_minutes: 10000, included_translation_minutes: 3000, teamWorkspace: true },
  ];
  await page.addInitScript(() => {
    if (!window.location.pathname.startsWith('/v2/login')) localStorage.setItem('v2_token', 'test-only-token');
    localStorage.setItem('lalia_onboarding_completed_v1', '1');
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path.endsWith('/auth/me')) body = { user: { id: 'user', email: 'user@example.test', display_name: 'Test User', preferredLanguage: 'en' }, org: { id: 'org', name: 'Personal', account_type: 'personal' }, role: 'owner' };
    else if (path.endsWith('/auth/change-password')) return route.fulfill({ status: 401, json: passwordCode ? { error: 'Unauthorized', code: passwordCode } : { error: 'Current password is incorrect' } });
    else if (path.endsWith('/billing/subscription')) body = { stripeEnabled: true, subscription: { plan_id: 'starter', status: subscriptionStatus, stripe_subscription_id: checkoutConflict ? null : 'sub_existing', stripe_customer_id: 'cus_existing' }, plan: plans[0] };
    else if (path.endsWith('/billing/plans')) body = { plans };
    else if (path.endsWith('/billing/checkout') || path.endsWith('/billing/portal')) {
      billingRequests.push(path.split('/').pop());
      if (checkoutConflict && path.endsWith('/checkout')) return route.fulfill({ status: 409, json: { code: 'subscription_exists', error: 'Use Manage in Stripe' } });
      body = { url: `${new URL(route.request().url()).origin}/billing-test-destination` };
    } else if (path.endsWith('/orgs/me')) body = { org: { id: 'org', name: 'Personal', account_type: 'personal' }, usageThisMonth: { meetingMinutes: 0, translationMinutes: 0 } };
    else if (path.endsWith('/members')) body = { members: [] };
    else if (path.endsWith('/meetings')) body = { meetings: [] };
    else if (path.endsWith('/calls/history')) body = { calls: [] };
    else if (path.endsWith('/calls/incoming')) body = { incomingCalls: [] };
    else if (path.endsWith('/contacts')) body = { contacts: [], addedYou: [] };
    return route.fulfill({ status: 200, json: body });
  });
  return billingRequests;
}

for (const destination of ['/v2/app/settings?section=billing', '/v2/app']) {
  test(`paid upgrade uses existing subscription portal from ${destination}`, async ({ page }) => {
    const requests = await setupAccount(page);
    await page.goto(destination);
    await page.getByRole('button', { name: 'Upgrade to Pro', exact: true }).first().click();
    await expect(page).toHaveURL(/\/billing-test-destination$/);
    expect(requests).toEqual(['portal']);
  });
}

test('a canceled subscription can start a new checkout', async ({ page }) => {
  const requests = await setupAccount(page, { subscriptionStatus: 'canceled' });
  await page.goto('/v2/app/settings?section=billing');
  await page.getByRole('button', { name: 'Upgrade to Pro', exact: true }).first().click();
  await expect(page).toHaveURL(/\/billing-test-destination$/);
  expect(requests).toEqual(['checkout']);
});

test('a stale subscription snapshot recovers from checkout conflict through the portal', async ({ page }) => {
  const requests = await setupAccount(page, { checkoutConflict: true });
  await page.goto('/v2/app/settings?section=billing');
  await page.getByRole('button', { name: 'Upgrade to Pro', exact: true }).first().click();
  await expect(page).toHaveURL(/\/billing-test-destination$/);
  expect(requests).toEqual(['checkout', 'portal']);
});

test('incorrect current password keeps the session and displays the validation error', async ({ page }) => {
  await setupAccount(page);
  await page.goto('/v2/app/settings');
  await page.getByLabel('Current password', { exact: true }).fill('incorrect');
  await page.getByLabel('New password (min 8 characters)', { exact: true }).fill('new-password-123');
  await page.getByLabel('Confirm new password', { exact: true }).fill('new-password-123');
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.getByText('Current password is incorrect', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/v2\/app\/settings$/);
  expect(await page.evaluate(() => localStorage.getItem('v2_token'))).toBe('test-only-token');
});

test('an invalid session on change-password still redirects to sign in', async ({ page }) => {
  await setupAccount(page, { passwordCode: 'invalid_token' });
  await page.goto('/v2/app/settings');
  await page.getByLabel('Current password', { exact: true }).fill('incorrect');
  await page.getByLabel('New password (min 8 characters)', { exact: true }).fill('new-password-123');
  await page.getByLabel('Confirm new password', { exact: true }).fill('new-password-123');
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page).toHaveURL(/\/v2\/login\?session=expired$/);
  expect(await page.evaluate(() => localStorage.getItem('v2_token'))).toBeNull();
});

test('denied media permissions show an actionable prejoin alert', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('participantInfo', JSON.stringify({ roomName: 'permission-test', participantName: 'Guest', isHost: true, selectedLanguage: 'en' }));
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, json: {} }));
  await page.goto('/room/permission-test');
  await expect(page.getByRole('heading', { name: 'Ready to join?' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Camera or microphone unavailable');
  await expect(page.getByRole('alert')).toContainText('NotAllowedError');
  await expect(page.getByRole('button', { name: 'Join meeting', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await page.getByRole('button', { name: 'Turn off camera', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
