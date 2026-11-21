'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SpeakerTimeline } = require('../src/speakerTimeline');
const { LiveAudioPipeline, buildWavHeader, resolveSttAttemptOrder } = require('../src/audioPipeline');
const { getAdapterForPlatform } = require('../src/adapters');

describe('SpeakerTimeline', () => {
  it('attributes utterances to active DOM speakers and remembers diarized speaker mapping', () => {
    const timeline = new SpeakerTimeline({ botDisplayName: "Kenneth's Lalia Notetaker" });

    // Bot's own label is ignored
    timeline.recordActiveSpeakers(["Kenneth's Lalia Notetaker"], 1000);
    assert.equal(timeline.events.length, 0);

    // Sarah speaks between 2000ms and 3200ms
    timeline.recordActiveSpeakers(['Sarah Chen'], 2100);
    timeline.recordActiveSpeakers(['Sarah Chen'], 2500);
    timeline.recordActiveSpeakers(['Sarah Chen'], 2900);

    const resolved1 = timeline.resolveSpeaker({
      startMs: 2000,
      endMs: 3100,
      diarizeSpeaker: 0,
    });
    assert.equal(resolved1, 'Sarah Chen');

    // Later utterance from diarizeSpeaker=0 when DOM didn't flash still resolves to Sarah Chen
    const resolvedCached = timeline.resolveSpeaker({
      startMs: 10000,
      endMs: 11200,
      diarizeSpeaker: 0,
    });
    assert.equal(resolvedCached, 'Sarah Chen');

    // Unknown speaker falls back cleanly to 1-based Speaker label
    const fallback = timeline.resolveSpeaker({
      startMs: 20000,
      endMs: 21000,
      diarizeSpeaker: 1,
    });
    assert.equal(fallback, 'Speaker 2');
  });
});

describe('Adapters & Audio Encoding', () => {
  it('defaults STT provider ladder to xAI primary with Deepgram Nova-3 fallback', () => {
    assert.deepEqual(
      resolveSttAttemptOrder('xai', { xaiApiKey: 'xai-key', deepgramApiKey: 'dg-key' }),
      ['xai', 'deepgram']
    );
    assert.deepEqual(
      resolveSttAttemptOrder('auto', { xaiApiKey: 'xai-key', deepgramApiKey: 'dg-key' }),
      ['xai', 'deepgram']
    );
    assert.deepEqual(
      resolveSttAttemptOrder('xai', { xaiApiKey: '', deepgramApiKey: 'dg-key' }),
      ['deepgram']
    );
  });

  it('resolves Google Meet and Microsoft Teams adapters and normalizes Teams web URLs', () => {
    const meet = getAdapterForPlatform('google_meet');
    const teams = getAdapterForPlatform('ms_teams');
    assert.equal(meet.platform, 'google_meet');
    assert.equal(teams.platform, 'ms_teams');

    const webUrl = teams.buildWebClientUrl('https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0');
    assert.ok(webUrl.includes('anon=true'));
    assert.ok(webUrl.includes('deeplinkId=lalia-notetaker'));
  });

  it('encodes 1 second of 16kHz PCM audio to MP3 or WAV and cleans up temp dir', async () => {
    const wavHeader = buildWavHeader(32000, 16000, 1, 16);
    assert.equal(wavHeader.length, 44);
    assert.equal(wavHeader.toString('ascii', 0, 4), 'RIFF');

    const pipeline = new LiveAudioPipeline({
      deepgramApiKey: '', // offline unit test
      speakerTimeline: new SpeakerTimeline(),
      onUtterance: () => {},
    });

    await pipeline.start();
    // Push 1 second of 440Hz sine wave at 16kHz mono s16le (32,000 bytes)
    const samples = new Int16Array(16000);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 16000) * 12000);
    }
    pipeline.pushPcmBase64(Buffer.from(samples.buffer).toString('base64'));

    const result = await pipeline.stopAndReadRecording();
    assert.equal(result.durationSeconds, 1);
    assert.ok(result.audioBuffer && result.audioBuffer.length > 100);
    assert.ok(result.mimeType === 'audio/mpeg' || result.mimeType === 'audio/wav');

    await pipeline.cleanup();
  });
});
