'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

function buildWavHeader(pcmByteLength, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmByteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
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
 * Dual-tap live audio pipeline:
 * 1. Encodes 16kHz s16le PCM to MP3 via FFmpeg (or WAV fallback if FFmpeg absent)
 * 2. Streams 16kHz s16le PCM to Deepgram Nova-3 (diarize=true, language=multi),
 *    fusing utterances with SpeakerTimeline and calling onUtterance(line).
 */
class LiveAudioPipeline {
  constructor({ deepgramApiKey, speakerTimeline, onUtterance }) {
    this.deepgramApiKey = String(deepgramApiKey || '').trim();
    this.speakerTimeline = speakerTimeline;
    this.onUtterance = onUtterance;

    this.startedAtMs = 0;
    this.totalPcmBytes = 0;
    this.uttCounter = 0;

    this.tmpDir = null;
    this.outputFilePath = null;
    this.outputMimeType = 'audio/mpeg';
    this.ffmpegProc = null;
    this.rawPcmWriteStream = null;

    this.dgSocket = null;
    this.dgKeepAliveTimer = null;
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

    if (this.deepgramApiKey) {
      this.connectDeepgram();
    }
  }

  connectDeepgram() {
    if (this.closed || !this.deepgramApiKey) return;
    const params = new URLSearchParams({
      model: 'nova-3',
      language: 'multi',
      smart_format: 'true',
      punctuate: 'true',
      diarize: 'true',
      interim_results: 'false',
      endpointing: '400',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
    });
    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Token ${this.deepgramApiKey}` },
    });
    this.dgSocket = ws;

    ws.on('open', () => {
      this.dgKeepAliveTimer = setInterval(() => {
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
        const transcript = String(alt?.transcript || '').trim();
        if (!transcript) return;

        const words = Array.isArray(alt?.words) ? alt.words : [];
        const startOffsetSec = Number(words[0]?.start ?? msg.start ?? 0);
        const endOffsetSec = Number(
          words[words.length - 1]?.end ?? (Number(msg.start || 0) + Number(msg.duration || 0))
        );
        const startMs = this.startedAtMs + Math.round(startOffsetSec * 1000);
        const endMs = this.startedAtMs + Math.round(endOffsetSec * 1000);

        // Dominant speaker integer among words in this finalized segment
        let diarizeSpeaker = null;
        if (words.length > 0) {
          const tally = new Map();
          for (const w of words) {
            if (w.speaker != null) {
              tally.set(w.speaker, (tally.get(w.speaker) || 0) + 1);
            }
          }
          let maxCount = 0;
          for (const [spk, cnt] of tally.entries()) {
            if (cnt > maxCount) {
              maxCount = cnt;
              diarizeSpeaker = spk;
            }
          }
        }

        const speakerName = this.speakerTimeline
          ? this.speakerTimeline.resolveSpeaker({ startMs, endMs, diarizeSpeaker })
          : diarizeSpeaker != null
            ? `Speaker ${Number(diarizeSpeaker) + 1}`
            : 'Participant';

        const detectedLang =
          msg.channel?.detected_language ||
          alt?.languages?.[0] ||
          'en';

        this.uttCounter += 1;
        if (typeof this.onUtterance === 'function') {
          this.onUtterance({
            participant_identity: speakerName,
            original_text: transcript,
            language: detectedLang,
            source_language: detectedLang,
            transcription_id: `bot-utt-${this.uttCounter}`,
            recorded_at: new Date(startMs).toISOString(),
          });
        }
      } catch (err) {
        console.warn('[LiveAudioPipeline] Deepgram parse error:', err.message);
      }
    });

    ws.on('close', () => {
      if (this.dgKeepAliveTimer) {
        clearInterval(this.dgKeepAliveTimer);
        this.dgKeepAliveTimer = null;
      }
    });

    ws.on('error', (err) => {
      console.warn('[LiveAudioPipeline] Deepgram WS error:', err.message);
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

    if (this.dgSocket && this.dgSocket.readyState === WebSocket.OPEN) {
      this.dgSocket.send(chunk);
    }
  }

  async stopAndReadRecording() {
    this.closed = true;

    if (this.dgKeepAliveTimer) {
      clearInterval(this.dgKeepAliveTimer);
      this.dgKeepAliveTimer = null;
    }

    if (this.dgSocket) {
      try {
        if (this.dgSocket.readyState === WebSocket.OPEN) {
          this.dgSocket.send(JSON.stringify({ type: 'CloseStream' }));
          await new Promise((resolve) => {
            const t = setTimeout(resolve, 1500);
            this.dgSocket.once('close', () => {
              clearTimeout(t);
              resolve();
            });
          });
        }
        this.dgSocket.close();
      } catch {
        /* ignore */
      }
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
    };
  }

  async cleanup() {
    if (this.tmpDir) {
      await fsp.rm(this.tmpDir, { recursive: true, force: true }).catch(() => {});
      this.tmpDir = null;
    }
  }
}

module.exports = { LiveAudioPipeline, buildWavHeader };
