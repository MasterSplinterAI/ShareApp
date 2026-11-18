'use strict';

/**
 * Returns the browser init script injected via context.addInitScript() before
 * Google Meet or Microsoft Teams loads.
 *
 * 1. Supplies a silent virtual microphone + branded "Lalia AI Notetaker" 720p
 *    canvas video track so headless Chromium never fails device permission checks.
 * 2. Intercepts every RTCPeerConnection remote audio track (plus HTMLMediaElement
 *    srcObject streams) and mixes them into a 16kHz mono linear16 PCM pump sent
 *    to Node via window.__laliaPushPcmBase64(b64).
 */
function buildBrowserCaptureInitScript({ botDisplayName = 'Lalia Notetaker' } = {}) {
  return `
(() => {
  if (window.__laliaCaptureInstalled) return;
  window.__laliaCaptureInstalled = true;

  const BOT_LABEL = ${JSON.stringify(botDisplayName)};
  const SAMPLE_RATE = 16000;
  let mixerCtx = null;
  let mixerGain = null;
  const attachedTrackIds = new Set();

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function ensureAudioMixer() {
    if (mixerCtx) {
      if (mixerCtx.state === 'suspended') {
        mixerCtx.resume().catch(() => {});
      }
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    mixerCtx = new AudioCtx({ sampleRate: SAMPLE_RATE });
    mixerGain = mixerCtx.createGain();
    mixerGain.gain.value = 1.0;

    // 4096 frames @ 16kHz = 256ms chunks (low overhead, smooth streaming to STT + FFmpeg)
    const processor = mixerCtx.createScriptProcessor(4096, 1, 1);
    const silentOut = mixerCtx.createGain();
    silentOut.gain.value = 0;

    mixerGain.connect(processor);
    processor.connect(silentOut);
    silentOut.connect(mixerCtx.destination);

    processor.onaudioprocess = (ev) => {
      if (!window.__laliaRecordingActive || typeof window.__laliaPushPcmBase64 !== 'function') {
        return;
      }
      const input = ev.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i += 1) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      window.__laliaPushPcmBase64(arrayBufferToBase64(pcm16.buffer)).catch(() => {});
    };
  }

  function attachRemoteAudioTrack(track) {
    if (!track || track.kind !== 'audio' || attachedTrackIds.has(track.id)) return;
    attachedTrackIds.add(track.id);
    try {
      ensureAudioMixer();
      if (!mixerCtx || !mixerGain) return;
      const stream = new MediaStream([track]);
      const source = mixerCtx.createMediaStreamSource(stream);
      source.connect(mixerGain);
      track.addEventListener('ended', () => {
        try { source.disconnect(); } catch {}
        attachedTrackIds.delete(track.id);
      });
    } catch (err) {
      console.warn('[LaliaBot] Failed to attach remote audio track:', err);
    }
  }

  // 1. Hook RTCPeerConnection to capture all incoming remote WebRTC audio tracks
  const NativePC = window.RTCPeerConnection;
  if (NativePC) {
    const PatchedPC = function (...args) {
      const pc = new NativePC(...args);
      pc.addEventListener('track', (event) => {
        if (event.track && event.track.kind === 'audio') {
          attachRemoteAudioTrack(event.track);
        }
        if (event.streams) {
          for (const st of event.streams) {
            for (const tr of st.getAudioTracks()) {
              attachRemoteAudioTrack(tr);
            }
          }
        }
      });
      return pc;
    };
    PatchedPC.prototype = NativePC.prototype;
    Object.setPrototypeOf(PatchedPC, NativePC);
    window.RTCPeerConnection = PatchedPC;
  }

  // 2. Also hook HTMLMediaElement.play in case platform routes audio via srcObject
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    try {
      if (this.srcObject instanceof MediaStream) {
        for (const tr of this.srcObject.getAudioTracks()) {
          attachRemoteAudioTrack(tr);
        }
      }
    } catch {}
    return origPlay.apply(this, args);
  };

  // 3. Synthetic silent mic + branded avatar camera for getUserMedia
  function createSilentAudioTrack() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    return dest.stream.getAudioTracks()[0];
  }

  function createBrandedVideoTrack() {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    const draw = () => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 46px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(BOT_LABEL, 640, 340);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '28px system-ui, -apple-system, sans-serif';
      ctx.fillText('Recording audio & AI meeting notes • lalia.cloud', 640, 400);
    };
    draw();
    setInterval(draw, 2000);
    return canvas.captureStream(2).getVideoTracks()[0];
  }

  if (navigator.mediaDevices) {
    const origGetUserMedia = navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints = {}) => {
      try {
        const tracks = [];
        if (constraints.audio) tracks.push(createSilentAudioTrack());
        if (constraints.video) tracks.push(createBrandedVideoTrack());
        if (tracks.length > 0) return new MediaStream(tracks);
      } catch {}
      return origGetUserMedia ? origGetUserMedia(constraints) : new MediaStream();
    };
  }

  window.__laliaSetRecordingActive = (active) => {
    window.__laliaRecordingActive = Boolean(active);
    if (active) ensureAudioMixer();
  };
})();
`;
}

module.exports = { buildBrowserCaptureInitScript };
