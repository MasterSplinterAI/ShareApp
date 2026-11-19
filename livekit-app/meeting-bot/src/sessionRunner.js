'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { getAdapterForPlatform } = require('./adapters');
const { SpeakerTimeline } = require('./speakerTimeline');
const { LiveAudioPipeline } = require('./audioPipeline');
const { buildBrowserCaptureInitScript } = require('./browserCaptureInit');

const CHROMIUM_ARGS = [
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  ...(process.platform === 'linux' && process.env.CHROMIUM_NO_SANDBOX === 'true'
    ? ['--no-sandbox', '--disable-dev-shm-usage']
    : []),
];

async function runBotSession(session, { apiClient, config, abortSignal }) {
  const adapter = getAdapterForPlatform(session.platform);
  const sessionId = session.id;
  const claimToken = session.claim_token;
  const botDisplayName = session.bot_display_name || 'Lalia Notetaker';

  const speakerTimeline = new SpeakerTimeline({ botDisplayName });
  const pendingLines = [];
  let flushTimer = null;

  const flushTranscriptBatch = async () => {
    if (pendingLines.length === 0) return;
    const batch = pendingLines.splice(0, pendingLines.length);
    try {
      await apiClient.appendTranscriptLines(sessionId, claimToken, batch);
    } catch (err) {
      console.warn(`[BotSession ${sessionId}] Transcript upload warning:`, err.message);
    }
  };

  const audioPipeline = new LiveAudioPipeline({
    sttProvider: config.sttProvider || 'xai',
    xaiApiKey: config.xaiApiKey,
    deepgramApiKey: config.deepgramApiKey,
    speakerTimeline,
    onUtterance: (line) => {
      pendingLines.push(line);
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushTranscriptBatch();
        }, 1200);
      }
    },
  });

  let browser = null;
  let persistentContext = null;
  let tempProfileDir = null;
  let joinedAtMs = 0;

  try {
    await audioPipeline.start();

    const launchOpts = {
      headless: config.headless !== false,
      args: CHROMIUM_ARGS,
    };
    if (config.browserChannel) {
      launchOpts.channel = config.browserChannel;
    }

    const contextOptions = {
      viewport: { width: 1280, height: 720 },
      permissions: ['microphone', 'camera'],
    };

    let context;
    if (
      session.platform === 'google_meet' &&
      config.googleUserDataDir &&
      fs.existsSync(path.join(config.googleUserDataDir, '.signed_in'))
    ) {
      tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lalia-gmeet-profile-'));
      fs.cpSync(config.googleUserDataDir, tempProfileDir, {
        recursive: true,
        filter: (src) => {
          const base = path.basename(src);
          return (
            !base.startsWith('Singleton') &&
            base !== 'RunningChromeVersion' &&
            base !== 'Cache' &&
            base !== 'Code Cache' &&
            base !== 'GPUCache'
          );
        },
      });
      persistentContext = await chromium.launchPersistentContext(tempProfileDir, {
        ...launchOpts,
        ...contextOptions,
      });
      context = persistentContext;
    } else {
      browser = await chromium.launch(launchOpts);
      if (
        session.platform === 'google_meet' &&
        config.googleStorageStatePath &&
        fs.existsSync(config.googleStorageStatePath)
      ) {
        contextOptions.storageState = config.googleStorageStatePath;
      }
      context = await browser.newContext(contextOptions);
    }

    await context.addInitScript(buildBrowserCaptureInitScript({ botDisplayName }));

    const page = context.pages()[0] || (await context.newPage());
    await page.exposeFunction('__laliaPushPcmBase64', (b64) => {
      audioPipeline.pushPcmBase64(b64);
    });

    let stopRequested = false;
    await apiClient.heartbeat(sessionId, claimToken, {
      status: 'joining',
      statusDetail: `Opening ${adapter.label}…`,
    });

    // Heartbeat while joining / waiting in lobby so backend never marks session stale
    const prejoinHb = setInterval(async () => {
      try {
        const hb = await apiClient.heartbeat(sessionId, claimToken, {});
        if (hb?.stopRequested) stopRequested = true;
      } catch {
        /* ignore transient network blips */
      }
    }, 5000);

    try {
      await adapter.join({
        page,
        url: session.normalized_url || session.target_url,
        botDisplayName,
        lobbyTimeoutMs: config.lobbyTimeoutMs || 600_000,
        onStatus: async (status, statusDetail) => {
          const hb = await apiClient.heartbeat(sessionId, claimToken, { status, statusDetail });
          if (hb?.stopRequested) stopRequested = true;
        },
      });
    } finally {
      clearInterval(prejoinHb);
    }

    joinedAtMs = Date.now();
    await page.evaluate(() => {
      if (typeof window.__laliaSetRecordingActive === 'function') {
        window.__laliaSetRecordingActive(true);
      }
    });

    await apiClient.heartbeat(sessionId, claimToken, {
      status: 'recording',
      statusDetail: `Recording audio & speaker transcript in ${adapter.label}`,
      joined: true,
    });

    // Main in-call observation loop
    let aloneSinceMs = 0;
    let lastHeartbeatAt = Date.now();
    const maxCallMs = config.maxCallDurationMs || 4 * 3600 * 1000;
    const aloneTimeoutMs = config.aloneTimeoutMs || 90_000;

    while (!stopRequested && !abortSignal?.aborted) {
      if (Date.now() - joinedAtMs > maxCallMs) {
        break;
      }

      const activeNames = await adapter.scrapeActiveSpeakers(page);
      if (activeNames.length > 0) {
        speakerTimeline.recordActiveSpeakers(activeNames, Date.now());
      }

      const roomState = await adapter.inspectRoomState(page).catch(() => ({ inCall: true, participantCount: 2 }));
      if (!roomState.inCall || roomState.ended) {
        break;
      }

      if ((roomState.participantCount || 2) <= 1) {
        if (!aloneSinceMs) aloneSinceMs = Date.now();
        else if (Date.now() - aloneSinceMs >= aloneTimeoutMs) {
          break;
        }
      } else {
        aloneSinceMs = 0;
      }

      if (Date.now() - lastHeartbeatAt >= 4000) {
        lastHeartbeatAt = Date.now();
        const elapsedSec = Math.round((Date.now() - joinedAtMs) / 1000);
        const mins = Math.floor(elapsedSec / 60);
        const secs = String(elapsedSec % 60).padStart(2, '0');
        const hb = await apiClient
          .heartbeat(sessionId, claimToken, {
            status: 'recording',
            statusDetail: `Recording in ${adapter.label} (${mins}:${secs})`,
          })
          .catch(() => null);
        if (hb?.stopRequested) {
          stopRequested = true;
          break;
        }
      }

      await page.waitForTimeout(400);
    }

    await page
      .evaluate(() => {
        if (typeof window.__laliaSetRecordingActive === 'function') {
          window.__laliaSetRecordingActive(false);
        }
      })
      .catch(() => {});

    await adapter.leave(page).catch(() => {});
    await browser.close().catch(() => {});
    browser = null;

    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    await apiClient.heartbeat(sessionId, claimToken, {
      status: 'processing',
      statusDetail: 'Uploading audio recording & generating AI insights…',
    });

    const { audioBuffer, mimeType, durationSeconds } = await audioPipeline.stopAndReadRecording();
    await flushTranscriptBatch();

    if (audioBuffer && audioBuffer.length > 0) {
      await apiClient.uploadRecording(sessionId, claimToken, audioBuffer, {
        mimeType,
        durationSeconds:
          durationSeconds || Math.max(1, Math.round((Date.now() - joinedAtMs) / 1000)),
      });
    }

    await apiClient.completeSession(sessionId, claimToken, {
      failed: false,
      durationSeconds:
        durationSeconds || (joinedAtMs ? Math.round((Date.now() - joinedAtMs) / 1000) : 0),
    });
  } catch (err) {
    console.error(`[BotSession ${sessionId}] Failed:`, err.message);
    await apiClient
      .completeSession(sessionId, claimToken, {
        failed: true,
        errorCode: 'join_or_capture_failed',
        statusDetail: err.message || 'Could not join or record meeting',
      })
      .catch(() => {});
  } finally {
    if (flushTimer) clearTimeout(flushTimer);
    if (persistentContext) {
      await persistentContext.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (tempProfileDir) {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    }
    await audioPipeline.cleanup();
  }
}

module.exports = { runBotSession };
