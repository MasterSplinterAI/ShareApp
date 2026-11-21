import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createSeoSchemaCache, injectSeoSchema, MAX_SEO_PAGES, MAX_SEO_SCHEMA_BYTES,
  readBoundedSeoResponse, type SeoBusiness, type SeoSchema,
} from './seoSchema.js';

export function createSeoSchemaHost(business: SeoBusiness, cacheFile: string) {
  const url = 'https://ops.lalia.cloud/api/v1/public/seo-schema/' + business;
  const cache = createSeoSchemaCache({
    business,
    async fetchSnapshot() {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('SEO schema feed unavailable');
      return JSON.parse(await readBoundedSeoResponse(response, MAX_SEO_PAGES * (MAX_SEO_SCHEMA_BYTES + 512)));
    },
    async load() {
      try { return JSON.parse(await readFile(cacheFile, 'utf8')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return undefined;
      }
    },
    async save(snapshot) {
      await mkdir(dirname(cacheFile), { recursive: true });
      const temporary = cacheFile + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
        await rename(temporary, cacheFile);
      } finally {
        await rm(temporary, { force: true });
      }
    },
  });
  return {
    get: cache.get,
    async start() {
      await cache.restore().catch(() => console.warn('[seo] Could not restore the published schema cache'));
      const refresh = () => void cache.refresh().catch(() => console.warn('[seo] Published schema refresh failed'));
      refresh();
      const timer = setInterval(refresh, 15000).unref();
      return () => clearInterval(timer);
    },
  };
}

/** Marketing Kit's rendered pages finish a single HTML body with ServerResponse.end. */
export function decorateSeoHtmlResponse(res: ServerResponse, schema: SeoSchema | undefined): void {
  if (!schema) return;
  const end = res.end;
  res.end = function (this: ServerResponse, ...args: unknown[]) {
    this.end = end;
    const contentType = this.getHeader('Content-Type');
    if (!this.headersSent && this.statusCode === 200 && typeof args[0] === 'string' &&
        typeof contentType === 'string' && /^text\/html\b/i.test(contentType)) {
      args[0] = injectSeoSchema(args[0], schema);
      this.removeHeader('Content-Length');
      this.removeHeader('ETag');
      this.setHeader('Cache-Control', 'no-store');
    }
    return Reflect.apply(end, this, args);
  } as typeof res.end;
}
