'use strict';

/**
 * Google Meet platform adapter (meet.google.com/xxx-xxxx-xxx).
 * Handles prejoin dismissal, muted camera/mic entry, guest name input,
 * lobby waiting, active-speaker DOM scraping, and call-end / alone detection.
 */
const GoogleMeetAdapter = {
  platform: 'google_meet',
  label: 'Google Meet',

  async join({ page, url, botDisplayName, lobbyTimeoutMs = 600_000, onStatus }) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2500);

    // Dismiss "Continue without microphone and camera" or "Got it" prompts if shown
    for (const btnText of [
      /continue without microphone and camera/i,
      /continue without microphone/i,
      /^got it$/i,
      /^dismiss$/i,
    ]) {
      const btn = page.getByRole('button', { name: btnText }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(600);
      }
    }

    // Ensure camera and microphone are turned off on prejoin
    for (const toggleLabel of [/turn off microphone/i, /turn off camera/i]) {
      const toggle = page.getByRole('button', { name: toggleLabel }).first();
      if (await toggle.isVisible().catch(() => false)) {
        await toggle.click().catch(() => {});
      }
    }

    // Fill guest name input if not signed into a Google account
    const nameInput = page
      .locator('input[placeholder*="Your name" i], input[aria-label*="Your name" i]')
      .first();
    if (await nameInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await nameInput.fill(botDisplayName);
      await page.waitForTimeout(300);
    }

    // Click "Ask to join" or "Join now"
    const joinBtn = page
      .getByRole('button', { name: /^(ask to join|join now|join|switch here)$/i })
      .first();
    if (!(await joinBtn.isVisible({ timeout: 10_000 }).catch(() => false))) {
      throw new Error('Could not find Google Meet Join button (meeting may be restricted to organization users)');
    }
    await joinBtn.click();

    // Poll until admitted to call, denied, or lobby timeout
    const deadline = Date.now() + lobbyTimeoutMs;
    let reportedLobby = false;

    while (Date.now() < deadline) {
      const state = await this.inspectRoomState(page);
      if (state.inCall) {
        return { joined: true };
      }
      if (state.denied) {
        throw new Error(state.reason || 'Host denied entry or meeting ended before admission');
      }
      if (state.inLobby && !reportedLobby) {
        reportedLobby = true;
        if (onStatus) {
          await onStatus('waiting_in_lobby', `Waiting in Google Meet lobby as "${botDisplayName}"…`);
        }
      }
      await page.waitForTimeout(1500);
    }

    throw new Error('Timed out waiting to be admitted from the Google Meet lobby');
  },

  async inspectRoomState(page) {
    return page.evaluate(() => {
      const bodyText = (document.body?.innerText || '').slice(0, 4000);
      const hasLeaveBtn = Boolean(
        document.querySelector('button[aria-label*="Leave call" i]')
      );
      if (hasLeaveBtn) {
        // Estimate participant count from tile containers / badge counts
        const tiles = document.querySelectorAll('[data-participant-id], [data-requested-participant-id]');
        let participantCount = tiles.length;
        if (!participantCount) {
          const badge = document.querySelector('[aria-label*="Show everyone" i]');
          const numMatch = badge?.parentElement?.innerText?.match(/\d+/);
          if (numMatch) participantCount = Number(numMatch[0]);
        }
        return { inCall: true, participantCount: participantCount || 2 };
      }

      if (
        /someone in the call denied your request|you can't join this video call|no one responded to your request|meeting has ended|you've been removed from the meeting|return to home screen/i.test(
          bodyText
        )
      ) {
        return { inCall: false, denied: true, ended: true, reason: 'Meeting ended or entry was declined' };
      }

      if (/asking to be let in|someone will let you in soon|waiting for the host/i.test(bodyText)) {
        return { inCall: false, inLobby: true };
      }

      return { inCall: false, inLobby: false };
    });
  },

  async scrapeActiveSpeakers(page) {
    return page
      .evaluate(() => {
        const active = [];
        const tiles = document.querySelectorAll('[data-participant-id], [data-self-name]');
        for (const tile of tiles) {
          // Meet renders an animated audio wave indicator inside the tile when speaking
          const hasVoiceWave = Boolean(
            tile.querySelector('[jscontroller] [class*="voice"], [aria-label*="speaking" i]')
          );
          if (!hasVoiceWave) continue;
          const nameEl =
            tile.querySelector('[data-self-name]') ||
            tile.querySelector('[class*="notranslate"]') ||
            tile;
          const rawName = (
            nameEl.getAttribute?.('data-self-name') ||
            nameEl.textContent ||
            ''
          )
            .trim()
            .split('\n')[0]
            .trim();
          if (rawName && rawName.length <= 80) {
            active.push(rawName);
          }
        }
        return active;
      })
      .catch(() => []);
  },

  async leave(page) {
    const leaveBtn = page.locator('button[aria-label*="Leave call" i]').first();
    if (await leaveBtn.isVisible().catch(() => false)) {
      await leaveBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  },
};

module.exports = { GoogleMeetAdapter };
