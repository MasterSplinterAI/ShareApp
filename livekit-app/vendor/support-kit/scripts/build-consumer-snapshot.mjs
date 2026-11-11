// Run from an installed host directory: node <vendor>/scripts/build-consumer-snapshot.mjs
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
if (manifest.developmentOnly && process.env.NODE_ENV === 'production') throw new Error('Development support snapshot cannot be built for production');
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
console.log(`Built verified support snapshot ${manifest.sourceCommit}`);
