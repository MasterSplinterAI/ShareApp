import { test, expect } from '@playwright/test';

async function setupAccount(page, { subscriptionStatus = 'active', passwordCode, checkoutConflict = false, currentPlan = 'starter', stripeEnabled = true } = {}) {
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
    else if (path.endsWith('/billing/subscription')) body = { stripeEnabled, subscription: { plan_id: currentPlan, status: subscriptionStatus, stripe_subscription_id: checkoutConflict || currentPlan === 'free' ? null : 'sub_existing', stripe_customer_id: 'cus_existing' }, plan: currentPlan === 'free' ? { id: 'free', name: 'Free', monthly_price_cents: 0 } : plans[0] };
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

test('a public account cannot start checkout from a saved upgrade link', async ({ page }) => {
  const requests = await setupAccount(page, { stripeEnabled: false, currentPlan: 'free' });
  await page.goto('/v2/app/settings?section=billing&checkout=pro');
  await expect(page.getByText('active · Free', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upgrade to Pro', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Manage in Stripe' })).toHaveCount(0);
  expect(requests).toEqual([]);
});

for (const query of [
  'billing=success', 'billing=cancel', 'billing=portal',
  'section=billing&billing=success', 'section=billing&billing=cancel',
]) {
  test(`checkout return opens Billing without granting a plan (${query})`, async ({ page }) => {
    await setupAccount(page, { currentPlan: 'free' });
    await page.goto(`/v2/app/settings?${query}`);
    await expect(page.getByText('Account status', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Current password', { exact: true })).toHaveCount(0);
    await expect(page.getByText('active · Free', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
    // Cause a normal rerender without changing the return URL.
    await page.getByLabel('Current password', { exact: true }).fill('manual-selection');
    await expect(page.getByLabel('Current password', { exact: true })).toHaveValue('manual-selection');
  });
}

for (const query of ['', 'billing=unknown', 'section=profile&billing=success']) {
  test(`Settings keeps the Profile default or explicit section (${query || 'no query'})`, async ({ page }) => {
    await setupAccount(page);
    await page.goto(`/v2/app/settings?${query}`);
    await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
  });
}

test('changing return search parameters selects Billing in the mounted Settings page', async ({ page }) => {
  await setupAccount(page, { currentPlan: 'free' });
  await page.goto('/v2/app/settings');
  await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
  for (const marker of ['success', 'cancel', 'portal']) {
    await page.evaluate((billing) => {
      window.history.pushState({}, '', `/v2/app/settings?billing=${billing}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, marker);
    await expect(page.getByText('Account status', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
  }
});

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

for (const saving of [true, false, null]) {
  test(`prejoin discloses transcript storage before joining (${saving})`, async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('participantInfo', JSON.stringify({ roomName: 'disclosure-test', meetingId: 'meeting-disclosure', participantName: 'Guest', isHost: false, inviteToken: 'invite', selectedLanguage: 'en' }));
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
    });
    await page.route('**/api/**', (route) => {
      if (route.request().url().includes('/v2/join-info')) {
        return route.fulfill({ status: saving === null ? 503 : 200, json: saving === null ? {} : { mode: 'v2', allowed: true, policy: { store_transcripts: saving } } });
      }
      return route.fulfill({ status: 200, json: {} });
    });
    await page.goto('/room/disclosure-test');
    const notice = page.getByTestId('transcript-disclosure');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(saving === false ? 'not saving new transcript lines' : saving === true ? 'This meeting saves captions and translations' : 'save transcripts by default');
    await expect(notice.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy');
    await expect(page.getByRole('button', { name: 'Join meeting', exact: true })).toBeEnabled();
  });
}

test('privacy page explains default saving and host opt-out', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByText('Transcript saving is on by default for new calls and meetings.', { exact: false })).toBeVisible();
  await expect(page.getByText('Turning saving off does not delete text already saved.', { exact: false })).toBeVisible();
});

test('host prejoin refreshes the notice after changing settings in another tab', async ({ page }) => {
  let saving = true;
  await page.addInitScript(() => {
    localStorage.setItem('v2_token', 'test-only-token');
    sessionStorage.setItem('participantInfo', JSON.stringify({ roomName: 'host-disclosure', meetingId: 'host-meeting', participantName: 'Host', isHost: true, selectedLanguage: 'en' }));
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, json: route.request().url().includes('/meetings/host-meeting') ? { policy: { store_transcripts: saving } } : {} }));
  await page.goto('/room/host-disclosure');
  const notice = page.getByTestId('transcript-disclosure');
  await expect(notice).toContainText('This meeting saves captions');
  await expect(notice.getByRole('link', { name: 'Manage transcript saving' })).toHaveAttribute('href', '/v2/app/meetings/host-meeting');
  saving = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(notice).toContainText('not saving new transcript lines');
});

for (const savedToken of [null, 'expired-session-token']) {
  test(`guest stays in the meeting with ${savedToken ? 'a stale' : 'no'} account session`, async ({ page }) => {
    const authLookups = [];
    await page.addInitScript((token) => {
      if (token) localStorage.setItem('v2_token', token);
      sessionStorage.setItem('participantInfo', JSON.stringify({
        roomName: 'guest-regression', meetingId: 'guest-meeting', inviteToken: 'guest-invite',
        isHost: false, participantName: '', selectedLanguage: 'en',
      }));
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
    }, savedToken);
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/auth/me') || path.endsWith('/orgs/me')) {
        authLookups.push(path);
        return route.fulfill({ status: 401, json: { error: 'Unauthorized', code: 'invalid_token' } });
      }
      if (path.endsWith('/join-info')) {
        return route.fulfill({ json: { mode: 'v2', allowed: true, policy: { store_transcripts: true } } });
      }
      if (path.endsWith('/guest-token')) {
        return route.fulfill({ json: { token: 'test-only-room-token', url: 'wss://127.0.0.1:1' } });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto('/room/guest-regression');
    await page.getByLabel('Display name', { exact: true }).fill('Guest');
    const receivedGuestToken = page.waitForResponse((response) => response.url().endsWith('/guest-token'));
    await page.getByRole('button', { name: 'Join meeting', exact: true }).click();
    await receivedGuestToken;
    await expect(page.getByRole('button', { name: 'Leave meeting', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/room\/guest-regression$/);
    if (!savedToken) expect(authLookups).toEqual([]);
  });
}
