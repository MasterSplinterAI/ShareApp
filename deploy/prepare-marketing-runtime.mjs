// Deployment-only packaging. Never installs dependencies or contacts providers.
import fs from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const hash=content=>createHash('sha256').update(content).digest('hex');
const safe=file=>typeof file==='string' && !file.startsWith('/') && !file.includes('\\') && file.split('/').every(part=>part && part!=='.' && part!=='..');
const read=(root,file)=>{
 if(!safe(file))throw Error(`Unsafe artifact path: ${file}`);
 for(let p=join(root,file);p!==dirname(root);p=dirname(p))if(fs.lstatSync(p).isSymbolicLink())throw Error(`Symlink artifact source: ${file}`);
 return fs.readFileSync(join(root,file));
};
function snapshot(root){
 const manifest=JSON.parse(read(root,'manifest.json'));
 if(manifest.namespace!=='@rhule/marketing-*'||manifest.contractVersion!=='1.0.0'||manifest.developmentOnly||!/^[a-f0-9]{40}$/.test(manifest.sourceCommit))throw Error('Pinned marketing snapshot required');
 if(!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files)||hash(JSON.stringify(manifest.files))!==manifest.contentHash)throw Error('Marketing manifest hash mismatch');
 const sourceFiles={...manifest.files,...manifest.hostFiles};
 for(const [file,expected] of Object.entries(sourceFiles)){
  if(!safe(file)||!(/^(packages\/(core|shared|react)\/(src\/.+\.tsx?|package(?:-lock)?\.json|tsconfig\.json)|scripts\/build-snapshot\.mjs|tsconfig\.base\.json)$/.test(file)))throw Error(`Unsafe marketing source path: ${file}`);
  if(hash(read(root,file))!==expected)throw Error(`Marketing source hash mismatch: ${file}`);
 }
 return {manifest,sourceFiles};
}
function verify(artifact,expectedManifest,runtime=false){
 const kit=runtime?artifact:join(artifact,'kit'),{manifest,sourceFiles}=snapshot(kit);
 const expected=JSON.parse(fs.readFileSync(expectedManifest,'utf8'));
 if(manifest.sourceCommit!==expected.sourceCommit||manifest.contentHash!==expected.contentHash)throw Error('Staged marketing pin mismatch');
 const receipt=JSON.parse(read(kit,'runtime-artifacts.json'));
 if(receipt.sourceCommit!==manifest.sourceCommit||receipt.contentHash!==manifest.contentHash)throw Error('Artifact receipt pin mismatch');
 const generated=['core','react','shared'].flatMap(name=>['cjs','js'].map(ext=>`packages/${name}/dist/index.${ext}`)).sort();
 if(JSON.stringify(Object.keys(receipt.files).sort())!==JSON.stringify(generated))throw Error('Unexpected runtime artifacts');
 for(const file of generated)if(hash(read(kit,file))!==receipt.files[file])throw Error(`Runtime artifact hash mismatch: ${file}`);
 const files=[...Object.keys(sourceFiles),'manifest.json','runtime-artifacts.json',...generated].sort();
 if(!runtime && fs.readFileSync(join(artifact,'files.txt'),'utf8')!==files.join('\n')+'\n')throw Error('Artifact file list mismatch');
 // Backend imports are bundled and must not need temporary frontend peers/dependencies.
 execFileSync(process.execPath,['-e','const c=require(process.argv[1]);if(typeof c.createMarketingKit!=="function")throw Error("Missing core export");const s=require(process.argv[2]);if(!Object.keys(s).length)throw Error("Missing shared exports");',join(kit,'packages/core/dist/index.cjs'),join(kit,'packages/shared/dist/index.cjs')],{stdio:'pipe'});
}
const [action,input,output]=process.argv.slice(2);
if(!input||!output||!['build','verify','verify-runtime'].includes(action))throw Error('Usage: prepare-marketing-runtime.mjs build FRONTEND ARTIFACT | verify ARTIFACT EXPECTED_MANIFEST | verify-runtime KIT EXPECTED_MANIFEST');
if(action==='verify'||action==='verify-runtime'){
 verify(resolve(input),resolve(output),action==='verify-runtime');
 console.log('Verified marketing runtime artifact before publication');
}else{
 const frontend=resolve(input),root=resolve(frontend,'../vendor/marketing-kit'),artifact=resolve(output);
 if(fs.existsSync(artifact))throw Error('Runtime artifact destination already exists');
 const before=snapshot(root);
 execFileSync(process.execPath,[join(root,'scripts/build-snapshot.mjs')],{cwd:frontend,stdio:'inherit'});
 const after=snapshot(root);
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Marketing source changed during build');
 const staged=fs.mkdtempSync(join(dirname(artifact),'.marketing-runtime-'));
 try{
  const kit=join(staged,'kit'),files={};
  const copy=file=>{const content=read(root,file);fs.mkdirSync(dirname(join(kit,file)),{recursive:true});fs.writeFileSync(join(kit,file),content);return content;};
  for(const file of [...Object.keys(after.sourceFiles),'manifest.json'])copy(file);
  for(const name of ['core','react','shared'])for(const ext of ['cjs','js']){const file=`packages/${name}/dist/index.${ext}`;files[file]=hash(copy(file));}
  fs.writeFileSync(join(kit,'runtime-artifacts.json'),JSON.stringify({sourceCommit:after.manifest.sourceCommit,contentHash:after.manifest.contentHash,files},null,2)+'\n');
  fs.writeFileSync(join(staged,'files.txt'),[...Object.keys(after.sourceFiles),'manifest.json','runtime-artifacts.json',...Object.keys(files)].sort().join('\n')+'\n');
  verify(staged,join(root,'manifest.json'));
  fs.renameSync(staged,artifact);
 }finally{fs.rmSync(staged,{recursive:true,force:true});}
 console.log(`Packaged marketing runtime from ${after.manifest.sourceCommit}`);
}
