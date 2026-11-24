'use strict';

class LaliaBotApiClient {
  constructor({ baseUrl, workerSecret, workerId }) {
    this.baseUrl = String(baseUrl || 'http://localhost:3001').replace(/\/$/, '');
    this.workerSecret = String(workerSecret || '').trim();
    this.workerId = workerId || 'bot-worker-1';
  }

  headers(claimToken, extra = {}) {
    return {
      'x-bot-worker-secret': this.workerSecret,
      ...(claimToken ? { 'x-bot-claim-token': claimToken } : {}),
      ...extra,
    };
  }

  async postJson(pathname, body, claimToken) {
    const res = await fetch(`${this.baseUrl}/api/v2/bot-internal${pathname}`, {
      method: 'POST',
      headers: this.headers(claimToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status} on ${pathname}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async claimNextSession() {
    const res = await this.postJson('/claim', { workerId: this.workerId });
    return res.session || null;
  }

  async heartbeat(sessionId, claimToken, payload = {}) {
    return this.postJson(`/sessions/${encodeURIComponent(sessionId)}/heartbeat`, payload, claimToken);
  }

  async appendTranscriptLines(sessionId, claimToken, lines) {
    return this.postJson(
      `/sessions/${encodeURIComponent(sessionId)}/transcript`,
      { lines },
      claimToken
    );
  }

  async uploadRecording(sessionId, claimToken, audioBuffer, { mimeType = 'audio/mpeg', durationSeconds = 0 } = {}) {
    const res = await fetch(
      `${this.baseUrl}/api/v2/bot-internal/sessions/${encodeURIComponent(sessionId)}/recording`,
      {
        method: 'POST',
        headers: this.headers(claimToken, {
          'Content-Type': mimeType,
          'x-recording-duration-seconds': String(Math.max(0, Math.round(durationSeconds || 0))),
        }),
        body: audioBuffer,
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Recording upload failed (${res.status})`);
    }
    return data;
  }

  async completeSession(sessionId, claimToken, payload = {}) {
    return this.postJson(`/sessions/${encodeURIComponent(sessionId)}/complete`, payload, claimToken);
  }
}

module.exports = { LaliaBotApiClient };
