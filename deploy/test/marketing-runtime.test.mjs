import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const node20=process.env.MARKETING_TEST_NODE || '/Users/rhule/.nvm/versions/node/v20.19.3/bin/node';
const node=fs.existsSync(node20)?node20:process.execPath;
const script=fs.readFileSync(path.join(repo,'deploy-staging.sh'),'utf8');
function block(name){return script.split(`# BEGIN ${name}\n`)[1]?.split(`# END ${name}`)[0];}
function fixture(t){
 const root=fs.mkdtempSync('/private/tmp/phase3-task3a-deploy-test-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const checkout=path.join(root,'checkout'),app=path.join(root,'runtime/livekit-app'),frontend=path.join(checkout,'livekit-app/frontend');
 fs.mkdirSync(frontend,{recursive:true});fs.mkdirSync(path.join(checkout,'deploy'));
 for(const name of ['package.json','package-lock.json'])fs.copyFileSync(path.join(repo,'livekit-app/frontend',name),path.join(frontend,name));
 fs.symlinkSync(path.join(repo,'livekit-app/frontend/node_modules'),path.join(frontend,'node_modules'));
 fs.cpSync(path.join(repo,'livekit-app/vendor/marketing-kit'),path.join(checkout,'livekit-app/vendor/marketing-kit'),{recursive:true,filter:p=>!/(^|\/)(node_modules|dist)(\/|$)/.test(p)});
 const helper=path.join(repo,'deploy/prepare-marketing-runtime.mjs');if(fs.existsSync(helper))fs.copyFileSync(helper,path.join(checkout,'deploy/prepare-marketing-runtime.mjs'));
 const runtime=path.join(app,'vendor/marketing-kit');fs.cpSync(path.join(checkout,'livekit-app/vendor/marketing-kit'),runtime,{recursive:true});
 for(const p of ['config/local.json','media/fixture.png','packages/core/node_modules/fixture/retained','packages/core/dist/index.cjs']){fs.mkdirSync(path.dirname(path.join(runtime,p)),{recursive:true});fs.writeFileSync(path.join(runtime,p),p.endsWith('index.cjs')?'exports.oldArtifact=true;':'retained');}
 const backend=path.join(app,'backend');fs.mkdirSync(path.join(backend,'node_modules/@rhule'),{recursive:true});fs.writeFileSync(path.join(backend,'package.json'),'{"name":"fixture-runtime"}');
 for(const name of ['core','shared'])fs.symlinkSync(path.join(runtime,'packages',name),path.join(backend,'node_modules/@rhule/marketing-'+name));
 const bin=path.join(root,'bin');fs.mkdirSync(bin);fs.symlinkSync(node,path.join(bin,'node'));
 fs.writeFileSync(path.join(bin,'sudo'),'#!/bin/sh\nexec "$@"\n',{mode:0o755});
 const env={...process.env,PATH:bin+':'+process.env.PATH,TEMP_DIR:checkout,VENDOR_DIR:path.dirname(runtime),BACKEND_DIR:backend,NEED_MARKETING_PACKAGE:'true'};
 const vendorSync=script.match(/  sudo rsync -a --delete \\\n(?:.*\n)*?    "\$TEMP_DIR\/livekit-app\/vendor\/" "\$VENDOR_DIR\/"/)[0];
 const smoke=`(cd "$BACKEND_DIR" && node -e 'const c=require("@rhule/marketing-core");if(typeof c.createMarketingKit!=="function")throw Error("missing runtime core");const s=require("@rhule/marketing-shared");if(!Object.keys(s).length)throw Error("missing shared");')`;
 const legacyBuild=`(cd "${frontend}" && node ../vendor/marketing-kit/scripts/build-snapshot.mjs)`;
 const build=block('MARKETING_RUNTIME_PREPARE');
 const publish=block('MARKETING_RUNTIME_PUBLISH');
 function run(intercept='') {
  const commands=build ? `${build}\n${vendorSync}\n${intercept}\n${publish}\n${block('MARKETING_RUNTIME_SMOKE')}` : `${vendorSync}\n${legacyBuild}\n${smoke}`;
  return spawnSync('/bin/bash',['-c',`set -euo pipefail\n${commands}\nprintf restarted > "${root}/restarted"`],{env,encoding:'utf8'});
 }
 return {root,checkout,runtime,backend,env,run,build,publish};
}
test('actual deploy packaging publishes Node20 backend imports without runtime frontend dependencies',t=>{
 const f=fixture(t),r=f.run();assert.equal(r.status,0,r.stderr);assert.ok(fs.existsSync(path.join(f.root,'restarted')));
 assert.equal(fs.existsSync(path.join(f.root,'runtime/livekit-app/frontend/node_modules')),false);
 for(const p of ['config/local.json','media/fixture.png','packages/core/node_modules/fixture/retained'])assert.equal(fs.readFileSync(path.join(f.runtime,p),'utf8'),'retained');
 assert.equal(fs.readFileSync(path.join(f.runtime,'manifest.json'),'utf8'),fs.readFileSync(path.join(f.checkout,'livekit-app/vendor/marketing-kit/manifest.json'),'utf8'));
});
test('failed canonical build stops before vendor publication and restart',t=>{
 const f=fixture(t);
 const peer=path.join(f.checkout,'livekit-app/vendor/marketing-kit/packages/react/node_modules/react');fs.mkdirSync(peer,{recursive:true});fs.writeFileSync(path.join(peer,'retained'),'unrelated installed peer');
 const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/Existing marketing peer differs/);
 assert.equal(fs.readFileSync(path.join(f.runtime,'packages/core/dist/index.cjs'),'utf8'),'exports.oldArtifact=true;');assert.equal(fs.existsSync(path.join(f.root,'restarted')),false);
});
test('staged source mismatch is refused before publication or restart',t=>{
 const f=fixture(t);assert.ok(f.build && f.publish,'deployment must stage and verify marketing artifacts');
 const r=f.run('printf tampered >> "$TEMP_DIR/marketing-runtime/kit/packages/core/src/router.ts"');assert.notEqual(r.status,0);assert.match(r.stderr,/hash mismatch/i);
 assert.equal(fs.readFileSync(path.join(f.runtime,'packages/core/dist/index.cjs'),'utf8'),'exports.oldArtifact=true;');assert.equal(fs.existsSync(path.join(f.root,'restarted')),false);
});

test('published runtime artifacts are hash checked before restart',t=>{
 const f=fixture(t);
 fs.writeFileSync(path.join(f.root,'bin/sudo'),'#!/bin/sh\n"$@" || exit $?\ncase "$*" in *--files-from*) printf corrupted >> "$VENDOR_DIR/marketing-kit/packages/core/dist/index.cjs";; esac\n',{mode:0o755});
 const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/Runtime artifact hash mismatch/);assert.equal(fs.existsSync(path.join(f.root,'restarted')),false);
});
test('staging validates source pins before executing a changed build script',t=>{
 const f=fixture(t);
 const build=path.join(f.checkout,'livekit-app/vendor/marketing-kit/scripts/build-snapshot.mjs');fs.writeFileSync(build,'throw Error("untrusted build executed");');
 const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/Marketing source hash mismatch/);assert.doesNotMatch(r.stderr,/untrusted build executed/);
 assert.equal(fs.readFileSync(path.join(f.runtime,'packages/core/dist/index.cjs'),'utf8'),'exports.oldArtifact=true;');assert.equal(fs.existsSync(path.join(f.root,'restarted')),false);
});

test('artifact pin must match the checkout selected for deployment',t=>{
 const f=fixture(t);
 const mutate=`node -e 'const fs=require("fs");const p=process.env.TEMP_DIR+"/marketing-runtime/kit/manifest.json";const m=JSON.parse(fs.readFileSync(p));m.sourceCommit="0".repeat(40);fs.writeFileSync(p,JSON.stringify(m));'`;
 const r=f.run(mutate);assert.notEqual(r.status,0);assert.match(r.stderr,/Staged marketing pin mismatch/);
 assert.equal(fs.readFileSync(path.join(f.runtime,'packages/core/dist/index.cjs'),'utf8'),'exports.oldArtifact=true;');assert.equal(fs.existsSync(path.join(f.root,'restarted')),false);
});
