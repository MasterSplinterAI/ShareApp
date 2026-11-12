import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PREFIXED_LOCALES } from './config.mjs';
import { stringsFor } from './strings.mjs';

test('generated homepages retain their translated visible hero description', async () => {
  for (const locale of PREFIXED_LOCALES) {
    const html = await readFile(new URL(`../../public/${locale}/index.html`, import.meta.url), 'utf8');
    const paragraph = html.match(/<p class="hero-description">([\s\S]*?)<\/p>/)?.[1];
    assert.ok(paragraph, `${locale}: visible hero paragraph exists`);
    assert.equal(paragraph.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&'), stringsFor(locale).heroDesc, `${locale}: visible copy is translated`);
  }
});
