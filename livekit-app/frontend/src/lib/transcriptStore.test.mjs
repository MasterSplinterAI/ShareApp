import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  DEFAULT_DOM_WINDOW,
  createTranscriptStore,
  applyTranscriptionPacket,
  getWindowedDisplaySlice,
  getAllFinalMessages,
} from './transcriptStore.js';

test('updates partial bubble in place, skips duplicate no-op partials, and commits final', () => {
  const store = createTranscriptStore();

  const r1 = applyTranscriptionPacket(
    store,
    {
      type: 'transcription',
      partial: true,
      transcriptionId: 't1',
      language: 'en',
      sourceLanguage: 'en',
      text: 'Hello',
      timestamp: 1000,
    },
    { speakerId: 'alice', speakerLabel: 'Alice' },
  );
  assert.equal(r1.changed, true);
  assert.equal(store.messages.length, 1);
  assert.equal(store.finalCount, 0);

  // Duplicate partial with newer timestamp must be a no-op (prevents redundant 20Hz re-renders)
  const rDup = applyTranscriptionPacket(
    store,
    {
      type: 'transcription',
      partial: true,
      transcriptionId: 't1',
      language: 'en',
      sourceLanguage: 'en',
      text: 'Hello',
      timestamp: 1000.05,
    },
    { speakerId: 'alice', speakerLabel: 'Alice' },
  );
  assert.equal(rDup.changed, false);

  const r2 = applyTranscriptionPacket(
    store,
    {
      type: 'transcription',
      partial: true,
      transcriptionId: 't1',
      language: 'en',
      sourceLanguage: 'en',
      text: 'Hello everyone',
      timestamp: 1000.2,
    },
    { speakerId: 'alice', speakerLabel: 'Alice' },
  );
  assert.equal(r2.changed, true);
  assert.equal(store.messages.length, 1);
  assert.equal(store.messages[0].originalText, 'Hello everyone');

  const rFinal = applyTranscriptionPacket(
    store,
    {
      type: 'transcription',
      partial: false,
      transcriptionId: 't1',
      language: 'en',
      sourceLanguage: 'en',
      text: 'Hello everyone!',
      timestamp: 1001,
    },
    { speakerId: 'alice', speakerLabel: 'Alice' },
  );
  assert.equal(rFinal.changed, true);
  assert.equal(rFinal.isFinalChange, true);
  assert.equal(store.finalCount, 1);
  assert.equal(store.openPartialIndices.size, 0);
  assert.equal(store.unsentFinalIds.has(store.messages[0].id), true);
  assert.equal(store.messages[0].originalText, 'Hello everyone!');
});

test('keeps A -> B -> A strictly chronological and auto-closes orphaned partials', () => {
  const store = createTranscriptStore();

  applyTranscriptionPacket(
    store,
    { type: 'transcription', partial: true, text: 'First thought', language: 'en', timestamp: 100 },
    { speakerId: 'alice', speakerLabel: 'Alice' },
  );
  applyTranscriptionPacket(
    store,
    { type: 'transcription', partial: false, text: 'Quick reply', language: 'en', timestamp: 101 },
    { speakerId: 'bob', speakerLabel: 'Bob' },
  );
  applyTranscriptionPacket(
    store,
    { type: 'transcription', partial: true, text: 'Second thought', language: 'en', timestamp: 102 },
    { speakerId: 'alice', speakerLabel: 'Alice' },
  );

  assert.equal(store.messages.length, 3);
  assert.deepEqual(
    store.messages.map((m) => [m.speaker, m.originalText, m.isPartial]),
    [
      ['alice', 'First thought', false],
      ['bob', 'Quick reply', false],
      ['alice', 'Second thought', true],
    ],
  );
  assert.equal(store.finalCount, 2);
});

test('hides chunk finals while an open partial shares the same transcriptionId', () => {
  const store = createTranscriptStore();

  applyTranscriptionPacket(
    store,
    {
      type: 'transcription',
      partial: false,
      transcriptionId: 'turn-chunk',
      language: 'en',
      text: 'Part one',
      timestamp: 200,
    },
    { speakerId: 'alice', speakerLabel: 'Alice' },
  );
  applyTranscriptionPacket(
    store,
    {
      type: 'transcription',
      partial: true,
      transcriptionId: 'turn-chunk',
      language: 'en',
      text: 'Part one and part two',
      timestamp: 201,
    },
    { speakerId: 'alice', speakerLabel: 'Alice' },
  );
  // Wait: if turn-chunk was reopened in place because no other speaker spoke since,
  // simulate a distinct chunk final + open partial with same turn ID after interjection or dual emit:
  store.messages = [];
  store.turnMap.clear();
  store.openPartialIndices.clear();
  store.unsentFinalIds.clear();
  store.idToIndex.clear();
  store.finalCount = 0;

  applyTranscriptionPacket(
    store,
    {
      type: 'transcription',
      partial: false,
      transcriptionId: 'shared-turn',
      language: 'en',
      text: 'Chunk final',
      timestamp: 300,
    },
    { speakerId: 'alice', speakerLabel: 'Alice' },
  );
  applyTranscriptionPacket(
    store,
    {
      type: 'transcription',
      partial: false,
      transcriptionId: 'other-turn',
      language: 'en',
      text: 'Interjection',
      timestamp: 301,
    },
    { speakerId: 'bob', speakerLabel: 'Bob' },
  );
  applyTranscriptionPacket(
    store,
    {
      type: 'transcription',
      partial: true,
      transcriptionId: 'shared-turn',
      language: 'en',
      text: 'Chunk final extended',
      timestamp: 302,
    },
    { speakerId: 'alice', speakerLabel: 'Alice' },
  );

  const slice = getWindowedDisplaySlice(store, DEFAULT_DOM_WINDOW);
  assert.equal(slice.windowedMessages.length, 2);
  assert.deepEqual(
    slice.windowedMessages.map((m) => m.originalText),
    ['Interjection', 'Chunk final extended'],
  );
});

test('attaches late-arriving translation to finalized bubble', () => {
  const store = createTranscriptStore();

  applyTranscriptionPacket(
    store,
    {
      type: 'transcription',
      partial: false,
      transcriptionId: 'turn-es',
      language: 'es',
      sourceLanguage: 'es',
      originalText: 'Buenos días a todos',
      text: 'Buenos días a todos',
      timestamp: 500,
    },
    { speakerId: 'carlos', speakerLabel: 'Carlos' },
  );

  applyTranscriptionPacket(
    store,
    {
      type: 'transcription',
      partial: false,
      transcriptionId: 'turn-es',
      language: 'en',
      sourceLanguage: 'es',
      originalText: 'Buenos días a todos',
      text: 'Good morning everyone',
      timestamp: 500.4,
    },
    { speakerId: 'carlos', speakerLabel: 'Carlos' },
  );

  assert.equal(store.messages.length, 1);
  assert.equal(store.messages[0].originalText, 'Buenos días a todos');
  assert.equal(store.messages[0].translations.en, 'Good morning everyone');
});

test('stays O(1) per packet across 5,000 turns and 20,000 partial updates', () => {
  const store = createTranscriptStore();
  const start = performance.now();

  for (let turn = 1; turn <= 5000; turn += 1) {
    const speakerId = turn % 2 === 0 ? 'host' : 'guest';
    const speakerLabel = turn % 2 === 0 ? 'Host' : 'Guest';
    const turnId = `turn-${turn}`;
    const baseTs = 1700000000 + turn * 2;

    for (let p = 1; p <= 4; p += 1) {
      applyTranscriptionPacket(
        store,
        {
          type: 'transcription',
          partial: true,
          transcriptionId: turnId,
          language: 'en',
          sourceLanguage: 'es',
          originalText: `Esta es la frase número ${turn} parte ${p}`,
          text: `This is sentence number ${turn} part ${p}`,
          timestamp: baseTs + p * 0.1,
        },
        { speakerId, speakerLabel },
      );
    }

    applyTranscriptionPacket(
      store,
      {
        type: 'transcription',
        partial: false,
        transcriptionId: turnId,
        language: 'en',
        sourceLanguage: 'es',
        originalText: `Esta es la frase número ${turn} completa`,
        text: `This is sentence number ${turn} complete`,
        timestamp: baseTs + 0.6,
      },
      { speakerId, speakerLabel },
    );

    if (turn % 25 === 0) {
      const slice = getWindowedDisplaySlice(store, DEFAULT_DOM_WINDOW);
      assert.ok(slice.windowedMessages.length <= DEFAULT_DOM_WINDOW);
    }
  }

  const elapsedMs = performance.now() - start;
  const slice = getWindowedDisplaySlice(store, DEFAULT_DOM_WINDOW);
  assert.equal(slice.windowedMessages.length, DEFAULT_DOM_WINDOW);
  assert.equal(slice.hiddenCount, 5000 - DEFAULT_DOM_WINDOW);
  assert.equal(getAllFinalMessages(store).length, 5000);
  assert.ok(
    elapsedMs < 500,
    `Expected 25,000 packets + 200 slices to finish in <500ms, took ${elapsedMs.toFixed(1)}ms`,
  );
});
