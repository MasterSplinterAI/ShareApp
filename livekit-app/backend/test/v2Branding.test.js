const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { publicLogoUrl, newLogoFileName } = require('../lib/v2Branding');

function req() {
  return {
    get(name) {
      if (name === 'host') return 'staging.jarmetals.com';
      return undefined;
    },
    protocol: 'https',
  };
}

describe('publicLogoUrl', () => {
  it('returns null when there is no logo file', () => {
    assert.equal(publicLogoUrl(req(), 'org-1', null), null);
    assert.equal(publicLogoUrl(req(), 'org-1', ''), null);
  });

  it('changes the URL when the stored logo file changes', () => {
    const first = publicLogoUrl(req(), 'org-1', 'logo-aaa.png');
    const second = publicLogoUrl(req(), 'org-1', 'logo-bbb.png');
    assert.notEqual(first, second);
    assert.match(first, /\/api\/v2\/branding\/org-1\/logo\?v=logo-aaa\.png$/);
    assert.match(second, /\?v=logo-bbb\.png$/);
  });
});

describe('newLogoFileName', () => {
  it('uses a unique name so a replacement is not the same cache key', () => {
    const a = newLogoFileName('image/png');
    const b = newLogoFileName('image/png');
    assert.notEqual(a, b);
    assert.match(a, /^logo-[a-z0-9]+-[a-f0-9]+\.png$/);
    assert.match(newLogoFileName('image/jpeg'), /\.jpg$/);
    assert.match(newLogoFileName('image/webp'), /\.webp$/);
    assert.match(newLogoFileName('image/gif'), /\.gif$/);
  });
});
