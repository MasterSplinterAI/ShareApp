// Run from an installed host directory: node <vendor>/scripts/build-consumer-snapshot.mjs
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--development-only')) throw new Error('Usage: build-consumer-snapshot.mjs [--development-only]');
const developmentBuild = args.includes('--development-only');
if (developmentBuild && process.env.NODE_ENV === 'production') throw new Error('Development-only build cannot override production');
if (manifest.developmentOnly && !developmentBuild) throw new Error('Development snapshot requires an explicit --development-only build outside production');
for (const [file, expected] of Object.entries(manifest.files)) {
  const actual = createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
  if (actual !== expected) throw new Error(`Support snapshot hash mismatch: ${file}`);
}
const hostRequire = createRequire(join(process.cwd(), 'package.json'));
const { build } = hostRequire('esbuild');
const alias = Object.fromEntries(['shared','core','react','channels'].map(name => [`@quill/support-${name}`, join(root, `packages/${name}/src/index.${name === 'react' ? 'tsx' : 'ts'}`)]));
for (const name of ['shared','core','channels','react']) {
  const output = join(root, `packages/${name}/dist`);
  rmSync(output, {recursive:true,force:true});
  for (const format of ['esm','cjs']) await build({entryPoints:[alias[`@quill/support-${name}`]], outfile:join(output, format === 'esm' ? 'index.js' : 'index.cjs'), bundle:true, format, platform:name === 'react' ? 'browser' : 'node', target:'es2022', alias, external:['react','react-dom','better-sqlite3'], jsx:'automatic', nodePaths:[join(process.cwd(),'node_modules')], logLevel:'warning'});
}
console.log(`Built verified support snapshot ${manifest.sourceCommit}${manifest.developmentOnly ? " DEVELOPMENT ONLY" : ""}`);
