#!/usr/bin/env node
'use strict';

require('dotenv').config();
const os = require('os');
const { LaliaBotApiClient } = require('./apiClient');
const { runBotSession } = require('./sessionRunner');

const config = {
  apiBaseUrl: process.env.LALIA_API_BASE_URL || 'http://localhost:3001',
  workerSecret: process.env.BOT_WORKER_SECRET || '',
  workerId: process.env.BOT_WORKER_ID || `bot-${os.hostname()}-${process.pid}`,
  deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',
  maxConcurrent: Math.max(1, Number(process.env.MAX_CONCURRENT_SESSIONS || 2)),
  pollIntervalMs: Math.max(1500, Number(process.env.POLL_INTERVAL_MS || 4000)),
  lobbyTimeoutMs: Math.max(30_000, Number(process.env.LOBBY_TIMEOUT_MS || 600_000)),
  aloneTimeoutMs: Math.max(15_000, Number(process.env.ALONE_TIMEOUT_MS || 90_000)),
  maxCallDurationMs: Math.max(60_000, Number(process.env.MAX_CALL_DURATION_MS || 14_400_000)),
  googleStorageStatePath: process.env.GOOGLE_STORAGE_STATE_PATH || '',
  headless: String(process.env.HEADLESS || 'true').toLowerCase() !== 'false',
};

if (!config.workerSecret) {
  console.error('[meeting-bot] Fatal: BOT_WORKER_SECRET is required');
  process.exit(1);
}

const apiClient = new LaliaBotApiClient({
  baseUrl: config.apiBaseUrl,
  workerSecret: config.workerSecret,
  workerId: config.workerId,
});

const abortController = new AbortController();
const activeJobs = new Set();
let shuttingDown = false;

async function pollLoop() {
  console.log(
    `[meeting-bot] Worker ${config.workerId} started (api=${config.apiBaseUrl}, maxConcurrent=${config.maxConcurrent}, headless=${config.headless})`
  );

  while (!shuttingDown) {
    if (activeJobs.size < config.maxConcurrent) {
      try {
        const session = await apiClient.claimNextSession();
        if (session) {
          console.log(
            `[meeting-bot] Claimed ${session.platform} session ${session.id} (${session.normalized_url})`
          );
          const jobPromise = runBotSession(session, {
            apiClient,
            config,
            abortSignal: abortController.signal,
          }).finally(() => {
            activeJobs.delete(jobPromise);
          });
          activeJobs.add(jobPromise);
          continue; // Immediately check if another slot can claim a queued job
        }
      } catch (err) {
        console.warn('[meeting-bot] Claim poll warning:', err.message);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }

  if (activeJobs.size > 0) {
    console.log(`[meeting-bot] Draining ${activeJobs.size} active session(s)…`);
    await Promise.allSettled([...activeJobs]);
  }
  console.log('[meeting-bot] Shutdown complete.');
}

function requestShutdown(sig) {
  if (shuttingDown) return;
  console.log(`[meeting-bot] Received ${sig}, stopping active sessions gracefully…`);
  shuttingDown = true;
  abortController.abort();
}

process.on('SIGINT', () => requestShutdown('SIGINT'));
process.on('SIGTERM', () => requestShutdown('SIGTERM'));

pollLoop().catch((err) => {
  console.error('[meeting-bot] Unhandled fatal error:', err);
  process.exit(1);
});
