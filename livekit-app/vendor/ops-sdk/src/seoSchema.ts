import { canonicalSupportPayload } from './supportGateway.js';

export const SEO_SITES = {
  lalia: 'https://lalia.cloud',
  legalai: 'https://lexit.legal',
} as const;
export type SeoBusiness = keyof typeof SEO_SITES;
export type SeoSchema = Record<string, unknown> | Record<string, unknown>[];
export const MAX_SEO_SCHEMA_BYTES = 24 * 1024;
export const MAX_SEO_PAGES = 100;

export function isSeoBusiness(value: string): value is SeoBusiness {
  return Object.hasOwn(SEO_SITES, value);
}

export function seoPagePath(business: SeoBusiness, input: unknown): string {
  if (typeof input !== 'string' || input.length > 300) throw new Error('Enter a public page URL or path');
  const value = input.trim();
  const origin = SEO_SITES[business];
  const path = value.startsWith(origin + '/') || value === origin ? value.slice(origin.length) || '/' : value;
  if (!/^\/[A-Za-z0-9/_-]*(?:\.html)?$/.test(path) || path.includes('//')) {
    throw new Error('Enter a public page on ' + origin + ' without a query or fragment');
  }
  const canonical = path.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
  const allowed = business === 'lalia'
    ? /^(?:\/|\/languages|\/blog(?:\/[a-z0-9-]+)?|\/(?:de|es|fr|ja|pt|zh-CN)(?:\/(?:languages|blog(?:\/[a-z0-9-]+)?))?)$/
    : /^(?:\/|\/for-individuals|\/for-attorneys|\/pricing|\/blog(?:\/[a-z0-9-]+)?)$/;
  if (!allowed.test(canonical)) throw new Error('Choose a supported marketing or Journal page on ' + origin);
  return canonical;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const schemaContext = (value: unknown) => value === 'https://schema.org' || value === 'https://schema.org/';
function types(value: unknown): string[] {
  const names = Array.isArray(value) ? value : [value];
  return names.filter((name): name is string => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(name));
}
function validateValues(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error('JSON-LD exceeds the supported nesting depth');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('JSON-LD numbers must be finite');
  if (Array.isArray(value)) value.forEach(child => validateValues(child, depth + 1));
  if (isObject(value)) {
    if (Object.hasOwn(value, '@context') && !schemaContext(value['@context'])) {
      throw new Error('Use https://schema.org as the JSON-LD context');
    }
    for (const child of Object.values(value)) validateValues(child, depth + 1);
  }
}

export function parseSeoSchema(input: unknown): SeoSchema {
  if (typeof input !== 'string' || new TextEncoder().encode(input).length > MAX_SEO_SCHEMA_BYTES) {
    throw new Error('Paste a JSON-LD document under 24 KB');
  }
  const text = input.trim();
  const wrapped = text.match(/^<script\s+type=(?:"application\/ld\+json"|'application\/ld\+json')\s*>([\s\S]*)<\/script>$/i);
  let schema: unknown;
  try {
    schema = JSON.parse(wrapped?.[1] ?? text);
  } catch {
    throw new Error('Enter valid JSON-LD');
  }
  const nodes = Array.isArray(schema) ? schema : [schema];
  if (!nodes.length || !nodes.every(node => isObject(node) && schemaContext(node['@context']) &&
      (types(node['@type']).length > 0 || Array.isArray(node['@graph']) && node['@graph'].length > 0 &&
        node['@graph'].every(child => isObject(child) && types(child['@type']).length > 0)))) {
    throw new Error('Add a Schema.org context and a schema type or typed @graph');
  }
  validateValues(schema);
  return schema as SeoSchema;
}

const MANAGED_ATTRIBUTE = 'data-opshub-schema';
export function injectSeoSchema(html: string, schema: SeoSchema): string {
  const json = JSON.stringify(schema).replace(/[<>&\u2028\u2029]/g, ch =>
    '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
  return html.replace(/<\/head\s*>/i, closing =>
    '<script type="application/ld+json" ' + MANAGED_ATTRIBUTE + '="true">' + json + '</script>\n' + closing);
}

function schemaTypes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(schemaTypes);
  if (!isObject(value)) return [];
  return [...types(value['@type']), ...schemaTypes(value['@graph'])];
}

export function inspectSeoSchema(html: string, expected: SeoSchema | null) {
  const builtIn = new Set<string>();
  const managed: unknown[] = [];
  for (const [, attributes, raw] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/(?:^|\s)type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json(?:\s|$))/i.test(attributes!)) continue;
    try {
      const value: unknown = JSON.parse(raw!);
      if (/(?:^|\s)data-opshub-schema="true"(?:\s|$)/i.test(attributes!)) managed.push(value);
      else for (const type of schemaTypes(value)) builtIn.add(type);
    } catch {
      if (/(?:^|\s)data-opshub-schema="true"(?:\s|$)/i.test(attributes!)) managed.push(undefined);
    }
  }
  return {
    matches: expected === null ? managed.length === 0 :
      managed.length === 1 && canonicalSupportPayload(managed[0]) === canonicalSupportPayload(expected),
    overlaps: [...new Set(schemaTypes(expected))].filter(type => builtIn.has(type)).sort(),
  };
}

export async function readBoundedSeoResponse(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error('Response exceeded the size limit');
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

type Snapshot = { pages: Array<{ path: string; schema: SeoSchema }> };
export function createSeoSchemaCache(options: {
  business: SeoBusiness;
  fetchSnapshot: () => Promise<unknown>;
  load: () => Promise<unknown>;
  save: (snapshot: Snapshot) => Promise<void>;
}) {
  let pages = new Map<string, SeoSchema>();
  let refreshing: Promise<void> | undefined;
  function validate(snapshot: unknown): Snapshot {
    if (!isObject(snapshot) || !Array.isArray(snapshot.pages) || snapshot.pages.length > MAX_SEO_PAGES) {
      throw new Error('Invalid SEO schema feed');
    }
    const paths = new Set<string>();
    return { pages: snapshot.pages.map(page => {
      if (!isObject(page)) throw new Error('Invalid SEO schema page');
      const path = seoPagePath(options.business, page.path);
      if (paths.has(path) || path !== page.path) throw new Error('Invalid SEO schema page path');
      paths.add(path);
      return { path, schema: parseSeoSchema(JSON.stringify(page.schema)) };
    }) };
  }
  function install(snapshot: Snapshot) {
    pages = new Map(snapshot.pages.map(page => [page.path, page.schema]));
  }
  return {
    get(input: string) {
      try {
        return pages.get(seoPagePath(options.business, input));
      } catch {
        return undefined;
      }
    },
    async restore() {
      const saved = await options.load();
      if (saved !== undefined) install(validate(saved));
    },
    refresh() {
      refreshing ??= (async () => {
        const next = validate(await options.fetchSnapshot());
        if (JSON.stringify(next.pages) !== JSON.stringify([...pages].map(([path, schema]) => ({ path, schema })))) {
          await options.save(next);
          install(next);
        }
      })().finally(() => { refreshing = undefined; });
      return refreshing;
    },
  };
}
