'use strict';

/**
 * Microsoft Teams web meeting adapter (teams.microsoft.com & teams.live.com).
 * Forces web-client entry without desktop app launch, mutes mic/camera, enters
 * bot display name, waits in lobby, observes active speakers, and exits cleanly.
 */
const MicrosoftTeamsAdapter = {
  platform: 'ms_teams',
  label: 'Microsoft Teams',

  buildWebClientUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (!u.searchParams.has('anon')) {
        u.searchParams.set('anon', 'true');
      }
      u.searchParams.set('deeplinkId', 'lalia-notetaker');
      return u.toString();
    } catch {
      return rawUrl;
    }
  },

  async join({ page, url, botDisplayName, lobbyTimeoutMs = 600_000, onStatus }) {
    const targetUrl = this.buildWebClientUrl(url);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2500);

    // Click "Continue on this browser" / "Join on the web instead" launcher button if shown
    for (const launcherPattern of [
      /continue on this browser/i,
      /join on the web instead/i,
      /use the web app/i,
    ]) {
      const btn = page
        .locator('button, a[role="button"], [data-tid="joinOnWeb"]')
        .filter({ hasText: launcherPattern })
        .first();
      if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(3000);
        break;
      }
    }

    // Wait for prejoin display name input
    const nameInput = page
      .locator(
        '[data-tid="prejoin-display-name-input"], input[placeholder*="Type your name" i], input[placeholder*="Enter name" i], input[aria-label*="name" i]'
      )
      .first();
    if (await nameInput.isVisible({ timeout: 15_000 }).catch(() => false)) {
      await nameInput.fill(botDisplayName);
      await page.waitForTimeout(300);
    }

    // Turn off camera & mic toggles if currently enabled on prejoin
    for (const selector of [
      '[data-tid="toggle-video"][aria-checked="true"]',
      '[data-tid="toggle-mute"][aria-checked="true"]',
      'input[data-tid="toggle-video"]:checked',
    ]) {
      const el = page.locator(selector).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click().catch(() => {});
      }
    }

    const joinBtn = page
      .locator('[data-tid="prejoin-join-button"], button')
      .filter({ hasText: /^(join now|ask to join)$/i })
      .first();
    if (!(await joinBtn.isVisible({ timeout: 12_000 }).catch(() => false))) {
      throw new Error('Could not find Microsoft Teams Join button');
    }
    await joinBtn.click();

    const deadline = Date.now() + lobbyTimeoutMs;
    let reportedLobby = false;

    while (Date.now() < deadline) {
      const state = await this.inspectRoomState(page);
      if (state.inCall) {
        return { joined: true };
      }
      if (state.denied) {
        throw new Error(state.reason || 'Denied entry to Microsoft Teams meeting');
      }
      if (state.inLobby && !reportedLobby) {
        reportedLobby = true;
        if (onStatus) {
          await onStatus(
            'waiting_in_lobby',
            `Waiting in Microsoft Teams lobby as "${botDisplayName}"…`
          );
        }
      }
      await page.waitForTimeout(1500);
    }

    throw new Error('Timed out waiting to be admitted from the Microsoft Teams lobby');
  },

  async inspectRoomState(page) {
    return page.evaluate(() => {
      const bodyText = (document.body?.innerText || '').slice(0, 4000);
      const hangup = document.querySelector(
        '#hangup-button, [data-tid="call-hangup"], button[aria-label*="Leave" i][id*="hangup" i], button[aria-label^="Leave (" i]'
      );
      if (hangup) {
        const tiles = document.querySelectorAll(
          '[data-tid*="video-tile"], [data-tid*="participant-item"], [data-cid="calling-participant-stream"]'
        );
        return { inCall: true, participantCount: tiles.length || 2 };
      }

      if (
        /sorry, but you were denied|someone in the meeting denied|you've been removed from this meeting|call ended|meeting has ended/i.test(
          bodyText
        )
      ) {
        return { inCall: false, denied: true, ended: true, reason: 'Teams call ended or entry was denied' };
      }

      if (
        /someone in the meeting should let you in soon|we've let people in the meeting know you're waiting|waiting in lobby/i.test(
          bodyText
        )
      ) {
        return { inCall: false, inLobby: true };
      }

      return { inCall: false, inLobby: false };
    });
  },

  async scrapeActiveSpeakers(page) {
    return page
      .evaluate(() => {
        const active = [];
        const speakingNodes = document.querySelectorAll(
          '[data-tid*="voice-level-stream-outline"].vdi-frame-occlusion, [class*="speaking"], [aria-label*="speaking" i]'
        );
        for (const node of speakingNodes) {
          const tile =
            node.closest('[data-tid*="video-tile"], [data-cid="calling-participant-stream"]') ||
            node;
          const label = (
            tile.getAttribute('aria-label') ||
            tile.innerText ||
            ''
          )
            .split('\n')[0]
            .replace(/\s*\(Guest\)\s*/i, '')
            .trim();
          if (label && label.length <= 80) {
            active.push(label);
          }
        }
        return active;
      })
      .catch(() => []);
  },

  async leave(page) {
    const hangup = page
      .locator('#hangup-button, [data-tid="call-hangup"], button[aria-label^="Leave" i]')
      .first();
    if (await hangup.isVisible().catch(() => false)) {
      await hangup.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  },
};

module.exports = { MicrosoftTeamsAdapter };
