import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Lightweight reimplementation of the browser/meeting language resolution used
 * by languages.ts so node:test can cover the mapping without a DOM / Vite.
 * Keep in sync with detectBrowserMeetingLanguage / resolvePreferredMeetingLanguage.
 */

const LEGACY_CODE_MAP = {
  zh: 'zh-CN',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
  'en-US': 'en',
  'en-GB': 'en',
  'es-419': 'es',
};

const KNOWN = new Set([
  'en', 'es', 'es-MX', 'fr', 'de', 'pt', 'pt-BR', 'ja', 'zh-CN', 'ko', 'ar', 'hi', 'ru',
]);

function detectBrowserMeetingLanguage(languageTags = []) {
  for (const lang of languageTags) {
    if (!lang) continue;
    const raw = String(lang).trim().replace('_', '-');
    if (!raw) continue;
    if (LEGACY_CODE_MAP[raw]) return LEGACY_CODE_MAP[raw];
    if (KNOWN.has(raw)) return raw;
    const base = raw.split('-')[0];
    if (LEGACY_CODE_MAP[base]) return LEGACY_CODE_MAP[base];
    if (KNOWN.has(base)) return base;
  }
  return 'en';
}

function resolvePreferredMeetingLanguage(explicit, stored, browserTags) {
  if (explicit && String(explicit).trim()) {
    const raw = String(explicit).trim().replace('_', '-');
    return LEGACY_CODE_MAP[raw] || (KNOWN.has(raw) ? raw : (KNOWN.has(raw.split('-')[0]) ? raw.split('-')[0] : 'en'));
  }
  if (stored && String(stored).trim()) {
    const raw = String(stored).trim().replace('_', '-');
    return LEGACY_CODE_MAP[raw] || (KNOWN.has(raw) ? raw : (KNOWN.has(raw.split('-')[0]) ? raw.split('-')[0] : 'en'));
  }
  return detectBrowserMeetingLanguage(browserTags);
}

describe('preferred meeting language defaults', () => {
  it('maps browser locale tags onto supported meeting languages', () => {
    assert.equal(detectBrowserMeetingLanguage(['es-MX', 'en']), 'es-MX');
    assert.equal(detectBrowserMeetingLanguage(['es-US', 'en']), 'es');
    assert.equal(detectBrowserMeetingLanguage(['fr-CA']), 'fr');
    assert.equal(detectBrowserMeetingLanguage(['zh-Hans-CN']), 'zh-CN');
    assert.equal(detectBrowserMeetingLanguage(['en-US']), 'en');
    assert.equal(detectBrowserMeetingLanguage(['xx-YY']), 'en');
  });

  it('prefers explicit then stored then browser then English', () => {
    assert.equal(resolvePreferredMeetingLanguage('ja', 'es', ['fr']), 'ja');
    assert.equal(resolvePreferredMeetingLanguage(null, 'de', ['fr']), 'de');
    assert.equal(resolvePreferredMeetingLanguage(null, null, ['pt-BR']), 'pt-BR');
    assert.equal(resolvePreferredMeetingLanguage(null, null, []), 'en');
  });
});
