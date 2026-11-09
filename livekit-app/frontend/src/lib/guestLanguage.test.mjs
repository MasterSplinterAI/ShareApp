import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePreselectedLanguage,
  parseGuestLanguageFromSearch,
  buildJoinUrlWithLanguage,
  formatPreselectedLanguageNotice,
} from './guestLanguage.js';

test('resolvePreselectedLanguage normalizes canonical, regional, and legacy codes', () => {
  assert.equal(resolvePreselectedLanguage('es'), 'es');
  assert.equal(resolvePreselectedLanguage('ES-DO'), 'es-DO');
  assert.equal(resolvePreselectedLanguage('es_do'), 'es-DO');
  assert.equal(resolvePreselectedLanguage('fr'), 'fr');
  assert.equal(resolvePreselectedLanguage('pt_br'), 'pt-BR');
  assert.equal(resolvePreselectedLanguage('zh'), 'zh-CN');
  assert.equal(resolvePreselectedLanguage('zh-Hans'), 'zh-CN');
  assert.equal(resolvePreselectedLanguage('zh-Hant'), 'zh-TW');
  assert.equal(resolvePreselectedLanguage('ja'), 'ja');
  assert.equal(resolvePreselectedLanguage('de'), 'de');
  assert.equal(resolvePreselectedLanguage('ar'), 'ar');
  assert.equal(resolvePreselectedLanguage('auto'), null);
  assert.equal(resolvePreselectedLanguage(''), null);
  assert.equal(resolvePreselectedLanguage('invalid-xyz'), null);
});

test('parseGuestLanguageFromSearch extracts ?lang= and ?l= from query strings and URLs', () => {
  assert.equal(parseGuestLanguageFromSearch('?i=tok123&lang=es'), 'es');
  assert.equal(parseGuestLanguageFromSearch('?i=tok123&lang=es-DO'), 'es-DO');
  assert.equal(parseGuestLanguageFromSearch('?i=tok123&l=fr'), 'fr');
  assert.equal(
    parseGuestLanguageFromSearch('https://lalia.cloud/join/v2-abc?i=tok123&lang=zh'),
    'zh-CN'
  );
  assert.equal(parseGuestLanguageFromSearch('/join/v2-abc?i=tok123'), null);
  assert.equal(parseGuestLanguageFromSearch(new URLSearchParams('i=tok&l=pt-BR')), 'pt-BR');
});

test('buildJoinUrlWithLanguage appends, updates, and clears ?lang= on join URLs', () => {
  const baseWithInvite = 'https://lalia.cloud/join/v2-room-1?i=token_abc';
  assert.equal(
    buildJoinUrlWithLanguage(baseWithInvite, 'es'),
    'https://lalia.cloud/join/v2-room-1?i=token_abc&lang=es'
  );
  assert.equal(
    buildJoinUrlWithLanguage(baseWithInvite, 'zh'),
    'https://lalia.cloud/join/v2-room-1?i=token_abc&lang=zh-CN'
  );
  assert.equal(
    buildJoinUrlWithLanguage('https://lalia.cloud/join/v2-room-1?i=token_abc&lang=es', 'fr'),
    'https://lalia.cloud/join/v2-room-1?i=token_abc&lang=fr'
  );
  assert.equal(
    buildJoinUrlWithLanguage('https://lalia.cloud/join/v2-room-1?i=token_abc&lang=es', ''),
    'https://lalia.cloud/join/v2-room-1?i=token_abc'
  );
  assert.equal(
    buildJoinUrlWithLanguage('https://lalia.cloud/join/v2-room-1?i=token_abc&l=de', 'auto'),
    'https://lalia.cloud/join/v2-room-1?i=token_abc'
  );
  assert.equal(
    buildJoinUrlWithLanguage('/join/v2-room-1?i=token_abc', 'ja'),
    '/join/v2-room-1?i=token_abc&lang=ja'
  );
});

test('formatPreselectedLanguageNotice returns clear notice message for preselected language', () => {
  const esNotice = formatPreselectedLanguageNotice('es');
  assert.ok(esNotice);
  assert.equal(esNotice.code, 'es');
  assert.equal(esNotice.displayLabel, 'Spanish (Español)');
  assert.equal(
    esNotice.noticeText,
    'Language pre-set to Spanish (Español) — you can change this anytime'
  );

  const enNotice = formatPreselectedLanguageNotice('en');
  assert.ok(enNotice);
  assert.equal(enNotice.displayLabel, 'English');
  assert.equal(
    enNotice.noticeText,
    'Language pre-set to English — you can change this anytime'
  );

  assert.equal(formatPreselectedLanguageNotice(''), null);
});
