import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSettingsSection } from './settingsSection.js';

test('ordinary Settings defaults to Profile', () => {
  assert.equal(resolveSettingsSection(new URLSearchParams()), 'profile');
});

for (const marker of ['success', 'cancel', 'portal']) {
  test(`legacy ${marker} return selects Billing`, () => {
    assert.equal(resolveSettingsSection(new URLSearchParams({ billing: marker })), 'billing');
  });

  test(`explicit Billing section works for ${marker}`, () => {
    assert.equal(resolveSettingsSection(new URLSearchParams({ section: 'billing', billing: marker })), 'billing');
  });

  test(`explicit section takes precedence over ${marker}`, () => {
    assert.equal(resolveSettingsSection(new URLSearchParams({ section: 'profile', billing: marker })), 'profile');
  });
}

test('unrecognized billing markers keep the normal Profile default', () => {
  for (const marker of ['', 'pending', 'SUCCESS']) {
    assert.equal(resolveSettingsSection(new URLSearchParams({ billing: marker })), 'profile');
  }
});

test('an empty section keeps existing Profile fallback even on a billing return', () => {
  assert.equal(resolveSettingsSection(new URLSearchParams('section=&billing=success')), 'profile');
});
