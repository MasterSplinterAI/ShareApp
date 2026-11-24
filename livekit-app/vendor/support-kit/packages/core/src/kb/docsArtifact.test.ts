import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('sanitized docs artifact recursively reads allowed docs and rejects unsafe material and symlinks',async()=>{
  const {readDocsArtifact}=await import('./docsArtifact.js');
  const root=mkdtempSync(join(tmpdir(),'support-docs-'));
  try {
    mkdirSync(join(root,'nested'));writeFileSync(join(root,'nested','help.md'),'# Safe help\nProduct steps.');
    const artifact=readDocsArtifact(root);assert.equal(artifact.sources[0]?.path,'nested/help.md');assert.ok(artifact.sourceRevision);
    assert.equal(readDocsArtifact(root).sourceRevision,artifact.sourceRevision);
    writeFileSync(join(root,'nested','help.md'),'# Safe help\nChanged steps.');assert.notEqual(readDocsArtifact(root).sourceRevision,artifact.sourceRevision);
    symlinkSync(join(root,'nested','help.md'),join(root,'linked.md'));assert.throws(()=>readDocsArtifact(root),/symlink/i);rmSync(join(root,'linked.md'));
    mkdirSync(join(root,'case-files'));writeFileSync(join(root,'case-files','secret.md'),'private');assert.throws(()=>readDocsArtifact(root),/forbidden/i);rmSync(join(root,'case-files'),{recursive:true});
    writeFileSync(join(root,'.env'),'SECRET=private');assert.throws(()=>readDocsArtifact(root),/forbidden/i);rmSync(join(root,'.env'));
    assert.throws(()=>readDocsArtifact(root,{maxTotalBytes:1}),/limit/i);
    writeFileSync(join(root,'token.md'),'api_key = sk_live_veryprivatevalue');assert.throws(()=>readDocsArtifact(root),/secret/i);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('JSON documentation artifacts enforce the same boundaries and stable revision',async()=>{
 const {validateDocsSources}=await import('./docsArtifact.js');
 const valid=[{path:'nested/help.md',body:'# Help\nSafe steps'}];
 assert.equal(validateDocsSources(valid).sourceRevision,validateDocsSources(valid).sourceRevision);
 for(const path of ['/absolute.md','../escape.md','nested/../escape.md','C:\\private.md','nested\\escape.md','.env','cases/private.md','runtime/help.md','code.js'])assert.throws(()=>validateDocsSources([{path,body:'text'}]),/forbidden|invalid/i);
 assert.throws(()=>validateDocsSources([...valid,...valid]),/duplicate/i);
 assert.throws(()=>validateDocsSources([{path:'safe.md',body:'api_key=sk_live_secretvalue'}]),/secret/i);
 assert.throws(()=>validateDocsSources(valid,{maxFiles:0}),/limit/i);
});

test('reviewed Matters product help is allowed while private matter folders and case files stay excluded',async()=>{
 const {readDocsArtifact,validateDocsSources}=await import('./docsArtifact.js');
 const root=mkdtempSync(join(tmpdir(),'support-topic-docs-'));
 try{
  writeFileSync(join(root,'matters.md'),'# Matters (cases)\nOpen Matters, choose New matter, then select a title.');
  assert.equal(readDocsArtifact(root).sources[0]?.path,'matters.md');
  assert.equal(validateDocsSources([{path:'guides/matters.md',body:'# Matters\nProduct help.'}]).sources.length,1);
  for(const path of ['matters/private.md','cases/private.md','case-client-123.md','matter-client-123.md'])assert.throws(()=>validateDocsSources([{path,body:'Private content'}]),/forbidden/i);
  mkdirSync(join(root,'matters'));writeFileSync(join(root,'matters','record.md'),'Private content');
  assert.throws(()=>readDocsArtifact(root),/forbidden/i);
 }finally{rmSync(root,{recursive:true,force:true});}
});

const privateMeetingPaths=['meetings/2026-11-11.md','meeting-notes.md','transcripts/call.md','meeting-2026-11-11.txt','call-transcript.md','exports/meeting_notes.md','transcript.md','product/meetings/private.md'];
test('JSON artifacts exclude private meeting and transcript exports but retain reviewed public topics',async()=>{
 const {validateDocsSources}=await import('./docsArtifact.js');
 for(const path of privateMeetingPaths)assert.throws(()=>validateDocsSources([{path,body:'Attendees discussed a confidential client engagement.'}]),/forbidden/i,path);
 for(const path of ['product/meetings.md','product/transcripts-security.md','matters.md'])assert.equal(validateDocsSources([{path,body:'# Product help\nReviewed public instructions.'}]).sources.length,1);
});
test('filesystem artifacts exclude private meeting and transcript exports using the JSON boundary policy',async()=>{
 const {readDocsArtifact}=await import('./docsArtifact.js');
 const root=mkdtempSync(join(tmpdir(),'support-meeting-docs-'));
 try{
  for(const file of privateMeetingPaths){
   const parts=file.split('/');const name=parts.pop()!;const dir=join(root,...parts);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,name),'Private meeting details.');
   assert.throws(()=>readDocsArtifact(root),/forbidden/i,file);rmSync(root,{recursive:true,force:true});mkdirSync(root);
  }
  mkdirSync(join(root,'product'));writeFileSync(join(root,'product','meetings.md'),'# Meetings\nPublic product instructions.');writeFileSync(join(root,'product','transcripts-security.md'),'# Transcript security\nPublic product guidance.');writeFileSync(join(root,'matters.md'),'# Matters\nPublic help.');
  assert.equal(readDocsArtifact(root).sources.length,3);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('canonical CI producer preserves prefixed public topic paths and rejects prefixed private exports',async()=>{
 const {readDocsArtifact,validateDocsSources}=await import('./docsArtifact.js');
 const root=mkdtempSync(join(tmpdir(),'support-ci-docs-'));
 try{
  mkdirSync(join(root,'product'));
  for(const file of ['product/meetings.md','product/transcripts-security.md','matters.md'])writeFileSync(join(root,...file.split('/')),'# Public topic\nReviewed help.');
  // Same transformation as templates/github-actions/support-kb-ingest.yml.
  const artifact=readDocsArtifact(root);
  const exported=validateDocsSources(artifact.sources.map(source=>({...source,path:`docs/support/${source.path}`})));
  assert.deepEqual(exported.sources.map(source=>source.path),['docs/support/matters.md','docs/support/product/meetings.md','docs/support/product/transcripts-security.md']);
  for(const file of privateMeetingPaths)assert.throws(()=>validateDocsSources([{path:`docs/support/${file}`,body:'Private meeting export.'}]),/forbidden/i,file);
 }finally{rmSync(root,{recursive:true,force:true});}
});
