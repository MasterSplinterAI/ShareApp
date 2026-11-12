import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IngestDocSource } from './codegen.js';
export interface DocsArtifact {
    sourceRevision: string;
    sources: ReadonlyArray<Readonly<IngestDocSource>>;
}
export interface DocsArtifactOptions {
    maxFiles?: number;
    maxFileBytes?: number;
    maxTotalBytes?: number;
}
const forbidden = /(^\.|(?:^|[-_ ])(?:case|cases|matter|matters|prompt|prompts|recording|recordings|meeting|meetings|transcript|transcripts|customer|customers|user|users|secret|secrets|credential|credentials)(?:$|[-_. ])|^(?:node_modules|runtime|data|uploads|backups|logs)$)/i;
// Reviewed product-topic help in a dedicated documentation tree. This exception
// never permits a private matter/meeting/transcript directory or individual export.
// These narrow filename exceptions require human review of the dedicated source tree.
const reviewedTopicFiles=new Set(['matters.md']);
// Both reader-relative paths and the canonical CI producer's stable source keys.
const reviewedTopicPaths=new Set(['product/meetings.md','product/transcripts-security.md','docs/support/product/meetings.md','docs/support/product/transcripts-security.md']);
const forbiddenSegment=(name:string,isFile:boolean,relativePath:string)=>forbidden.test(name)&&!(isFile&&(reviewedTopicFiles.has(name.toLowerCase())||reviewedTopicPaths.has(relativePath.toLowerCase())));
const secretContent = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?[^\s"']{8,}|\b(?:sk_live_|sk-proj-|ghp_|github_pat_)[A-Za-z0-9_-]{8,})/i;
/** Validate an uploaded artifact with the same policy as the filesystem exporter. */
export function validateDocsSources(input: ReadonlyArray<IngestDocSource>, options: DocsArtifactOptions = {}): DocsArtifact {
    const maxFiles = options.maxFiles ?? 500, maxFileBytes = options.maxFileBytes ?? 256000, maxTotalBytes = options.maxTotalBytes ?? 5000000;
    if (!Array.isArray(input))
        throw new Error('Invalid documentation sources');
    if (input.length > maxFiles)
        throw new Error('Documentation artifact file limit exceeded');
    const seen = new Set<string>();
    let total = 0;
    const sources = input.map((source: IngestDocSource) => {
        if (!source || typeof source.path !== 'string' || typeof source.body !== 'string' || (source.title !== undefined && typeof source.title !== 'string'))
            throw new Error('Invalid documentation source');
        const segments = source.path.split('/');
        if (!source.path || source.path.length > 1000 || /[\\:\0]/.test(source.path) || segments.some((segment,index) => !segment || segment === '..' || forbiddenSegment(segment,index===segments.length-1,segments.slice(0,index+1).join('/'))) || !/\.(?:md|mdx|txt)$/i.test(source.path))
            throw new Error('Forbidden documentation artifact path');
        if (seen.has(source.path))
            throw new Error('Duplicate documentation artifact path');
        seen.add(source.path);
        const size = Buffer.byteLength(source.body);
        total += size;
        if (size > maxFileBytes || total > maxTotalBytes)
            throw new Error('Documentation artifact size limit exceeded');
        if (secretContent.test(source.body))
            throw new Error('Possible secret in documentation artifact');
        return Object.freeze({ path: source.path, ...(source.title !== undefined ? { title: source.title } : {}), body: source.body });
    }).sort((a, b) => a.path.localeCompare(b.path));
    return Object.freeze({ sourceRevision: createHash('sha256').update(JSON.stringify(sources)).digest('hex'), sources: Object.freeze(sources) });
}
/** Export only a dedicated, reviewed documentation tree, never an application/runtime root.
 * This bounded artifact is immutable and content-addressed. Heuristics supplement, rather
 * than replace, operator review of the allowlisted source tree before publication.
 */
export function readDocsArtifact(docsRoot: string, options: DocsArtifactOptions = {}): DocsArtifact {
    const root = path.resolve(docsRoot);
    if (fs.lstatSync(root).isSymbolicLink())
        throw new Error('Documentation symlink root is forbidden');
    const canonicalRoot = fs.realpathSync(root);
    const sources: IngestDocSource[] = [];
    const maxFiles = options.maxFiles ?? 500;
    const maxFileBytes = options.maxFileBytes ?? 256000;
    const maxTotalBytes = options.maxTotalBytes ?? 5000000;
    let total = 0;
    function walk(dir: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const file = path.join(dir, entry.name);
            const stat = fs.lstatSync(file);
            if (stat.isSymbolicLink())
                throw new Error('Documentation symlink is forbidden');
            if (forbiddenSegment(entry.name,stat.isFile(),path.relative(root,file).split(path.sep).join('/')))
                throw new Error('Forbidden documentation artifact path');
            const canonical = fs.realpathSync(file);
            if (!canonical.startsWith(canonicalRoot + path.sep))
                throw new Error('Documentation path escapes root');
            if (stat.isDirectory()) {
                walk(file);
                continue;
            }
            if (!stat.isFile() || !/^\.(?:md|mdx|txt)$/i.test(path.extname(file)))
                throw new Error('Forbidden documentation artifact file type');
            if (sources.length >= maxFiles || stat.size > maxFileBytes || total + stat.size > maxTotalBytes)
                throw new Error('Documentation artifact size limit exceeded');
            // O_NOFOLLOW protects the final component against replacement after lstat.
            const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            let body: string;
            try {
                const current = fs.fstatSync(fd);
                if (!current.isFile() || current.size > maxFileBytes || total + current.size > maxTotalBytes)
                    throw new Error('Documentation artifact size limit exceeded');
                body = fs.readFileSync(fd, 'utf8');
                total += Buffer.byteLength(body);
            }
            finally {
                fs.closeSync(fd);
            }
            if (secretContent.test(body))
                throw new Error('Possible secret in documentation artifact');
            const relative = path.relative(root, file).split(path.sep).join('/');
            sources.push(Object.freeze({ path: relative, title: body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(file, path.extname(file)), body }));
        }
    }
    walk(root);
    return validateDocsSources(sources, options);
}
