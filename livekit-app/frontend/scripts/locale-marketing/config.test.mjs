import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localePath, absoluteUrl, PREFIXED_LOCALES } from './config.mjs';

describe('locale path prefix pattern', () => {
  it('keeps English unprefixed and prefixes other locales', () => {
    assert.equal(localePath('en', '/'), '/');
    assert.equal(localePath('en', '/blog'), '/blog');
    assert.equal(localePath('es', '/'), '/es/');
    assert.equal(localePath('es', '/blog'), '/es/blog');
    assert.equal(localePath('zh-CN', '/languages'), '/zh-CN/languages');
    assert.equal(absoluteUrl('fr', '/blog/foo'), 'https://lalia.cloud/fr/blog/foo');
  });

  it('lists the expected prefixed locales', () => {
    assert.deepEqual(PREFIXED_LOCALES, ['es', 'fr', 'de', 'pt', 'ja', 'zh-CN']);
  });
});
