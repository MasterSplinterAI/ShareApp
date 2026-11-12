import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve,join,dirname} from 'node:path';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(join(process.cwd(),'package.json'));
const manifestPath=join(root,'manifest.json');
if(existsSync(manifestPath)) {
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 if(manifest.namespace!=='@rhule/ops-sdk'||manifest.developmentOnly)throw Error('Invalid SDK snapshot');
 for(const [file,hash] of Object.entries(manifest.files)) {
  if(!/^(src\/[^.][\w/.-]*\.ts|scripts\/build\.mjs|package\.json|tsconfig\.json)$/.test(file)||file.includes('..'))throw Error('Invalid manifest path');
  if(createHash('sha256').update(readFileSync(join(root,file))).digest('hex')!==hash)throw Error('SDK snapshot hash mismatch: '+file);
 }
 if(createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex')!==manifest.contentHash)throw Error('SDK manifest mismatch');
}
const {build}=require('esbuild');
for(const [format,extension] of [['esm','js'],['cjs','cjs']])await build({entryPoints:[join(root,'src/index.ts')],bundle:true,platform:'neutral',external:['node:crypto'],format,target:'es2022',outfile:join(root,'dist/index.'+extension)});
execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p',join(root,'tsconfig.json'),'--emitDeclarationOnly','--typeRoots',dirname(dirname(require.resolve('@types/node/package.json')))],{stdio:'inherit'});
console.log('Verified and built @rhule/ops-sdk ESM, CJS and declarations');
