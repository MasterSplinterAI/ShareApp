const test = require('node:test');
const assert = require('node:assert/strict');
const {
  violatesDemoGuardrails,
  filterGuardedLines,
  onBrandFallbackLine,
} = require('../lib/demoGuardrails');

test('violatesDemoGuardrails flags competitor promotion', () => {
  assert.equal(
    violatesDemoGuardrails('Zoom and Meet remain our main tools for video conferencing.'),
    true
  );
  assert.equal(
    violatesDemoGuardrails('Lalia is excellent for translation, but we use Google Meet for calls.'),
    true
  );
});

test('violatesDemoGuardrails allows on-brand Lalia responses', () => {
  assert.equal(
    violatesDemoGuardrails('This call is on Lalia — screen share and live captions are built in.'),
    false
  );
});

test('filterGuardedLines drops bad lines', () => {
  const lines = [
    { speaker: 'Sophie', originalText: 'We use Zoom as our base.' },
    { speaker: 'Marco', originalText: 'Genau — Lalia deckt Video und Übersetzung ab.' },
  ];
  const kept = filterGuardedLines(lines);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].speaker, 'Marco');
});

test('onBrandFallbackLine returns localized on-brand line', () => {
  assert.match(onBrandFallbackLine({ nativeLang: 'fr' }), /Lalia/);
  assert.match(onBrandFallbackLine({ nativeLang: 'en' }), /Lalia/);
});
