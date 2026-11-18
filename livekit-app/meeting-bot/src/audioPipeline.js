'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const XAI_WS_URL = 'wss://api.x.ai/v1/stt';
const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';

function buildWavHeader(pcmByteLength, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmByteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmByteLength, 40);
  return header;
}

/**
 * Matches production translation_codeswitch_agent STT ladder:
 * Primary: xAI Grok STT ($0.0033/min, multilingual auto-detect + diarize=true)
 * Fallback: Deepgram Nova-3 ($0.0105/min, language=multi + diarize=true)
 */
function resolveSttAttemptOrder(preferredProvider, { xaiApiKey, deepgramApiKey }) {
  const pref = String(preferredProvider || 'xai').trim().toLowerCase();
  const candidates = pref === 'deepgram' ? ['deepgram', 'xai'] : ['xai', 'deepgram'];
  return candidates.filter((p) => {
    if (p === 'xai') return Boolean(xaiApiKey);
    if (p === 'deepgram') return Boolean(deepgramApiKey);
    return false;
  });
}

function dominantDiarizedSpeaker(words) {
  if (!Array.isArray(words) || words.length === 0) return null;
  const tally = new Map();
  for (const w of words) {
    const spk = w?.speaker ?? w?.speaker_id;
    if (spk != null) {
      tally.set(spk, (tally.get(spk) || 0) + 1);
    }
  }
  let best = null;
  let maxCount = 0;
  for (const [spk, cnt] of tally.entries()) {
    if (cnt > maxCount) {
      maxCount = cnt;
      best = spk;
    }
  }
  return best;
}

/**
 * Dual-tap live audio pipeline:
 * 1. Encodes 16kHz s16le PCM to MP3 via FFmpeg (or WAV fallback if FFmpeg absent)
 * 2. Streams 16kHz s16le PCM to xAI STT primarily, automatically failing over to
 *    Deepgram Nova-3 if xAI handshake/connection fails.
 */
class LiveAudioPipeline {
  constructor({
    sttProvider = 'xai',
    xaiApiKey = '',
    deepgramApiKey = '',
    speakerTimeline,
    onUtterance,
  }) {
    this.sttProvider = sttProvider;
    this.xaiApiKey = String(xaiApiKey || '').trim();
    this.deepgramApiKey = String(deepgramApiKey || '').trim();
    this.speakerTimeline = speakerTimeline;
    this.onUtterance = onUtterance;

    this.providerLadder = resolveSttAttemptOrder(this.sttProvider, {
      xaiApiKey: this.xaiApiKey,
      deepgramApiKey: this.deepgramApiKey,
    });
    this.currentProviderIndex = 0;
    this.activeSttProvider = null;

    this.startedAtMs = 0;
    this.totalPcmBytes = 0;
    this.uttCounter = 0;

    this.tmpDir = null;
    this.outputFilePath = null;
    this.outputMimeType = 'audio/mpeg';
    this.ffmpegProc = null;
    this.rawPcmWriteStream = null;

    this.sttSocket = null;
    this.sttKeepAliveTimer = null;
    this.closed = false;
  }

  async start() {
    this.startedAtMs = Date.now();
    this.tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lalia-bot-audio-'));
    const mp3Path = path.join(this.tmpDir, 'recording.mp3');

    const ffmpegAvailable = await new Promise((resolve) => {
      const check = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
      check.on('error', () => resolve(false));
      check.on('close', (code) => resolve(code === 0));
    });

    if (ffmpegAvailable) {
      this.outputFilePath = mp3Path;
      this.outputMimeType = 'audio/mpeg';
      this.ffmpegProc = spawn(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          's16le',
          '-ar',
          '16000',
          '-ac',
          '1',
          '-i',
          'pipe:0',
          '-codec:a',
          'libmp3lame',
          '-b:a',
          '64k',
          '-y',
          mp3Path,
        ],
        { stdio: ['pipe', 'ignore', 'pipe'] }
      );
      this.ffmpegProc.stdin.on('error', () => {});
    } else {
      const rawPath = path.join(this.tmpDir, 'recording.pcm');
      this.outputFilePath = path.join(this.tmpDir, 'recording.wav');
      this.outputMimeType = 'audio/wav';
      this.rawPcmPath = rawPath;
      this.rawPcmWriteStream = fs.createWriteStream(rawPath);
    }

    if (this.providerLadder.length > 0) {
      this.connectCurrentSttProvider();
    }
  }

  connectCurrentSttProvider() {
    if (this.closed || this.currentProviderIndex >= this.providerLadder.length) return;
    const provider = this.providerLadder[this.currentProviderIndex];
    if (provider === 'xai') {
      this.connectXaiStt();
    } else if (provider === 'deepgram') {
      this.connectDeepgramStt();
    }
  }

  failoverToNextProvider(reason) {
    if (this.closed) return;
    this.clearSttTimersAndSocket();
    if (this.currentProviderIndex + 1 < this.providerLadder.length) {
      const prev = this.providerLadder[this.currentProviderIndex];
      this.currentProviderIndex += 1;
      const next = this.providerLadder[this.currentProviderIndex];
      console.warn(`[LiveAudioPipeline] STT failover ${prev} -> ${next} (${reason})`);
      this.connectCurrentSttProvider();
    } else {
      console.warn(`[LiveAudioPipeline] STT connection closed (${reason}); continuing audio recording`);
    }
  }

  clearSttTimersAndSocket() {
    if (this.sttKeepAliveTimer) {
      clearInterval(this.sttKeepAliveTimer);
      this.sttKeepAliveTimer = null;
    }
    if (this.sttSocket) {
      try {
        this.sttSocket.removeAllListeners();
        this.sttSocket.close();
      } catch {
        /* ignore */
      }
      this.sttSocket = null;
    }
  }

  emitFinalTranscript({ transcript, words = [], startSec = 0, durationSec = 0, detectedLang = 'en' }) {
    const clean = String(transcript || '').trim();
    if (!clean) return;

    const firstWordStart = Number(words[0]?.start ?? startSec ?? 0);
    const lastWordEnd = Number(
      words[words.length - 1]?.end ?? (Number(startSec || 0) + Number(durationSec || 0))
    );
    const startMs = this.startedAtMs + Math.round(firstWordStart * 1000);
    const endMs = this.startedAtMs + Math.round(lastWordEnd * 1000);
    const diarizeSpeaker = dominantDiarizedSpeaker(words);

    const speakerName = this.speakerTimeline
      ? this.speakerTimeline.resolveSpeaker({ startMs, endMs, diarizeSpeaker })
      : diarizeSpeaker != null && Number.isFinite(Number(diarizeSpeaker))
        ? `Speaker ${Number(diarizeSpeaker) + 1}`
        : 'Participant';

    this.uttCounter += 1;
    if (typeof this.onUtterance === 'function') {
      this.onUtterance({
        participant_identity: speakerName,
        original_text: clean,
        language: detectedLang || 'en',
        source_language: detectedLang || 'en',
        transcription_id: `bot-utt-${this.uttCounter}`,
        recorded_at: new Date(startMs).toISOString(),
      });
    }
  }

  connectXaiStt() {
    // Omit `language` query param so grok-voice-transcribe-2.0 auto-detects and
    // follows mid-call language switches (mirrors xai_multilingual_stt.py).
    const params = new URLSearchParams({
      encoding: 'pcm',
      sample_rate: '16000',
      interim_results: 'false',
      diarize: 'true',
      endpointing: '800',
    });
    const ws = new WebSocket(`${XAI_WS_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${this.xaiApiKey}` },
    });
    this.sttSocket = ws;

    ws.on('open', () => {
      this.activeSttProvider = 'xai';
      this.sttKeepAliveTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.ping();
          } catch {
            /* ignore */
          }
        }
      }, 10_000);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString('utf8'));
        const isFinal =
          msg.is_final === true ||
          msg.type === 'transcript.done' ||
          msg.type === 'speech_final';
        if (!isFinal) return;

        const alt = msg.channel?.alternatives?.[0];
        const transcript = msg.text ?? msg.transcript ?? alt?.transcript ?? '';
        const words = msg.words ?? alt?.words ?? [];
        const detectedLang = msg.language || msg.channel?.detected_language || 'en';

        this.emitFinalTranscript({
          transcript,
          words,
          startSec: Number(msg.start || 0),
          durationSec: Number(msg.duration || 0),
          detectedLang,
        });
      } catch (err) {
        console.warn('[LiveAudioPipeline] xAI parse error:', err.message);
      }
    });

    ws.on('error', (err) => {
      this.failoverToNextProvider(`xAI error: ${err.message}`);
    });

    ws.on('close', (code) => {
      if (!this.closed && code !== 1000) {
        this.failoverToNextProvider(`xAI closed with code ${code}`);
      }
    });
  }

  connectDeepgramStt() {
    const params = new URLSearchParams({
      model: 'nova-3',
      language: 'multi',
      smart_format: 'true',
      punctuate: 'true',
      diarize: 'true',
      interim_results: 'false',
      endpointing: '500',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
    });
    const ws = new WebSocket(`${DEEPGRAM_WS_URL}?${params.toString()}`, {
      headers: { Authorization: `Token ${this.deepgramApiKey}` },
    });
    this.sttSocket = ws;

    ws.on('open', () => {
      this.activeSttProvider = 'deepgram';
      this.sttKeepAliveTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 8000);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString('utf8'));
        if (msg.type !== 'Results' || !msg.is_final) return;
        const alt = msg.channel?.alternatives?.[0];
        const transcript = alt?.transcript || '';
        const words = Array.isArray(alt?.words) ? alt.words : [];
        const detectedLang = msg.channel?.detected_language || alt?.languages?.[0] || 'en';

        this.emitFinalTranscript({
          transcript,
          words,
          startSec: Number(msg.start || 0),
          durationSec: Number(msg.duration || 0),
          detectedLang,
        });
      } catch (err) {
        console.warn('[LiveAudioPipeline] Deepgram parse error:', err.message);
      }
    });

    ws.on('error', (err) => {
      this.failoverToNextProvider(`Deepgram error: ${err.message}`);
    });

    ws.on('close', (code) => {
      if (!this.closed && code !== 1000) {
        this.failoverToNextProvider(`Deepgram closed with code ${code}`);
      }
    });
  }

  pushPcmBase64(b64) {
    if (this.closed || !b64) return;
    const chunk = Buffer.from(b64, 'base64');
    if (chunk.length === 0) return;

    this.totalPcmBytes += chunk.length;

    if (this.ffmpegProc?.stdin && !this.ffmpegProc.stdin.destroyed) {
      this.ffmpegProc.stdin.write(chunk);
    } else if (this.rawPcmWriteStream) {
      this.rawPcmWriteStream.write(chunk);
    }

    if (this.sttSocket && this.sttSocket.readyState === WebSocket.OPEN) {
      this.sttSocket.send(chunk);
    }
  }

  async stopAndReadRecording() {
    this.closed = true;

    if (this.sttKeepAliveTimer) {
      clearInterval(this.sttKeepAliveTimer);
      this.sttKeepAliveTimer = null;
    }

    if (this.sttSocket) {
      try {
        if (this.sttSocket.readyState === WebSocket.OPEN) {
          if (this.activeSttProvider === 'deepgram') {
            this.sttSocket.send(JSON.stringify({ type: 'CloseStream' }));
          }
          await new Promise((resolve) => {
            const t = setTimeout(resolve, 1200);
            this.sttSocket.once('close', () => {
              clearTimeout(t);
              resolve();
            });
            if (this.activeSttProvider === 'xai') {
              this.sttSocket.close(1000);
            }
          });
        }
        this.sttSocket.close();
      } catch {
        /* ignore */
      }
      this.sttSocket = null;
    }

    if (this.ffmpegProc) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10_000);
        this.ffmpegProc.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          this.ffmpegProc.stdin.end();
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    } else if (this.rawPcmWriteStream) {
      await new Promise((resolve) => this.rawPcmWriteStream.end(resolve));
      const rawBuf = await fsp.readFile(this.rawPcmPath).catch(() => Buffer.alloc(0));
      const wavHeader = buildWavHeader(rawBuf.length, 16000, 1, 16);
      await fsp.writeFile(this.outputFilePath, Buffer.concat([wavHeader, rawBuf]));
    }

    const durationSeconds = Math.round(this.totalPcmBytes / (16000 * 2));
    let audioBuffer = null;
    if (this.outputFilePath && fs.existsSync(this.outputFilePath) && this.totalPcmBytes > 0) {
      audioBuffer = await fsp.readFile(this.outputFilePath);
    }

    return {
      audioBuffer,
      mimeType: this.outputMimeType,
      durationSeconds,
      totalPcmBytes: this.totalPcmBytes,
      activeSttProvider: this.activeSttProvider,
    };
  }

  async cleanup() {
    if (this.tmpDir) {
      await fsp.rm(this.tmpDir, { recursive: true, force: true }).catch(() => {});
      this.tmpDir = null;
    }
  }
}

module.exports = { LiveAudioPipeline, buildWavHeader, resolveSttAttemptOrder };
