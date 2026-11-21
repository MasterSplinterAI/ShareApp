// Run from an installed host: node <vendor>/scripts/build-snapshot.mjs
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.namespace !== '@rhule/marketing-*' || manifest.contractVersion !== '1.0.0' || manifest.developmentOnly) throw Error('Pinned marketing snapshot required');
  if (createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex') !== manifest.contentHash) throw Error('Marketing manifest hash mismatch');
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (file.startsWith('/') || file.includes('\\') || file.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Unsafe marketing manifest path');
    for (let path = join(root,file); path !== root; path = dirname(path)) if (lstatSync(path).isSymbolicLink()) throw Error(`Symlink snapshot source: ${file}`);
    if (createHash('sha256').update(readFileSync(join(root,file))).digest('hex') !== expected) throw Error(`Marketing snapshot hash mismatch: ${file}`);
  }
} else {
  const canonical = resolve(root, '../..');
  if (JSON.parse(readFileSync(join(canonical,'package.json'),'utf8')).name !== 'ops-hub') throw Error('Only canonical OpsHub may build without a snapshot manifest');
}
// Tools belong to the host lockfile; no vendored node_modules or dist is distributed.
let build, host;
const hostCandidates = [process.cwd(), resolve(root,'../..'), resolve(root,'../../frontend'), resolve(root,'../../backend')].filter(candidate => !candidate.startsWith(root));
for (const candidate of hostCandidates) {
  try { build = createRequire(join(candidate,'package.json'))('esbuild').build; host = candidate; break; } catch {}
}
if (!build) throw Error('Install the host esbuild dependency before building marketing-kit');
// A file: package resolves peers from its real vendor path, not the sibling frontend.
// Link only host-lockfile-installed peers; never download or replace an existing path.
const peerDirectory = join(root,'packages/react/node_modules');
if (lstatSync(peerDirectory,{throwIfNoEntry:false})?.isSymbolicLink()) throw Error('Symlink peer directory forbidden');
mkdirSync(peerDirectory,{recursive:true});
for (const name of ['react','react-dom']) {
  let installed;
  for (const candidate of hostCandidates) {
    try { installed = dirname(createRequire(join(candidate,'package.json')).resolve(`${name}/package.json`)); break; } catch {}
  }
  if (!installed) throw Error(`Install the host-locked ${name} peer before building marketing-kit`);
  const target = join(peerDirectory,name), existing = lstatSync(target,{throwIfNoEntry:false});
  if (existing) {
    if (!existsSync(target) || realpathSync(target) !== realpathSync(installed)) throw Error(`Existing marketing peer differs from the host installation: ${target}`);
  } else symlinkSync(relative(peerDirectory,installed),target,'dir');
}
const alias = Object.fromEntries(['shared','core','react'].map(name => [`@rhule/marketing-${name}`,join(root,`packages/${name}/src/index.${name === 'react' ? 'tsx' : 'ts'}`)]));
for (const name of ['shared','core','react']) {
  const output = join(root,`packages/${name}/dist`);
  if (existsSync(output) && lstatSync(output).isSymbolicLink()) throw Error('Symlink build output forbidden');
  rmSync(output,{recursive:true,force:true});
  for (const format of ['esm','cjs']) await build({entryPoints:[alias[`@rhule/marketing-${name}`]],outfile:join(output,format === 'esm' ? 'index.js' : 'index.cjs'),bundle:true,format,platform:name === 'react' ? 'browser' : 'node',target:'node20',alias,external:['react','react-dom'],jsx:'automatic',nodePaths:[join(host,'node_modules')],logLevel:'warning'});
}
console.log('Built marketing shared/core/react for Node 20 and browser consumers');
