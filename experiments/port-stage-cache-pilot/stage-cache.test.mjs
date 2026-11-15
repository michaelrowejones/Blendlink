import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {acceptancePlan,hash,loadNativeStage,nativeReferenceKey,storeNativeStage} from './stage-cache.mjs'
const input=()=>({schemaVersion:1,stage:'native-reference',family:'compositor-integer-vector3',native:{sha256:'a'.repeat(64),bytes:10,version:'5.3.0',build:'02f0899d78e3'},upstream:{revision:'02f0899d78e374b63e7181d9061e1f7ab03419cc',sources:[{path:'source/node.cc',sha256:'b'.repeat(64)}]},settings:{context:'CPU',width:8,height:8},sourcePins:[{path:'reference.py',sha256:'c'.repeat(64)}],cases:[{case:'owned'}],referenceContract:'test-reference-v1'})
async function host(t){const root=await mkdtemp(join(tmpdir(),'port-stage-pilot-'));t.after(()=>rm(root,{recursive:true,force:true}));const owner=join(root,'native'),cache=join(root,'cache');const{mkdir}=await import('node:fs/promises');await mkdir(owner);const bytes=Buffer.from([0,0,0,0,0,0,128,63]);await writeFile(join(owner,'native.u32'),bytes);return{owner,cache,artifacts:[{path:'native.u32',bytes:bytes.length,sha256:hash(bytes)}]}}
test('runtime-only requests share one exact native stage, while final acceptance always stays fresh',async t=>{
 const h=await host(t),i=input();assert.equal((await loadNativeStage(h.cache,i)).status,'miss');const stored=await storeNativeStage(h.cache,i,h);assert.equal(stored.status,'hit')
 const a=acceptancePlan({nativeKey:stored.key,runtimeKey:'d'.repeat(64)}),b=acceptancePlan({nativeKey:stored.key,runtimeKey:'e'.repeat(64)})
 assert.equal((await loadNativeStage(h.cache,i)).key,stored.key);assert.equal(a.reuse,false);assert.equal(b.reuse,false);assert.notEqual(a.runNonce,b.runNonce);assert.notEqual(a.runtimeKey,b.runtimeKey);assert.equal(a.numericalCredit,0)
 assert.deepEqual(await readdir(h.cache),[stored.key]);assert.throws(()=>nativeReferenceKey({...i,stage:'final-acceptance'}));assert.throws(()=>nativeReferenceKey({...i,runtimeKey:a.runtimeKey}))
})
test('native binary, upstream, reference code, case and settings mutations all miss',async t=>{
 const h=await host(t),i=input();await storeNativeStage(h.cache,i,h)
 for(const change of[x=>x.native.sha256='f'.repeat(64),x=>x.upstream.sources[0].sha256='f'.repeat(64),x=>x.sourcePins[0].sha256='f'.repeat(64),x=>x.referenceContract+='-changed',x=>x.settings.width=9,x=>x.cases[0].case='other']){const v=structuredClone(i);change(v);assert.notEqual(nativeReferenceKey(v),nativeReferenceKey(i));assert.equal((await loadNativeStage(h.cache,v)).status,'miss')}
 const reordered=Object.fromEntries(Object.entries(i).reverse());assert.equal(nativeReferenceKey(reordered),nativeReferenceKey(i));assert.throws(()=>nativeReferenceKey({...i,unreviewed:true}))
})
test('tampered bytes are a hard error, never a miss or a silently trusted hit',async t=>{
 const h=await host(t),i=input(),entry=await storeNativeStage(h.cache,i,h),file=join(entry.folder,'native.u32'),bytes=await readFile(file);bytes[0]^=1;await writeFile(file,bytes)
 await assert.rejects(loadNativeStage(h.cache,i),/bytes changed/);await assert.rejects(storeNativeStage(h.cache,i,h),/bytes changed/)
})
test('manifest substitution, missing/truncated/extra files and equal-byte symlink aliases refuse',async t=>{
 for(const mode of['manifest','missing','truncated','extra','symlink']){
  const h=await host(t),i=input(),entry=await storeNativeStage(h.cache,i,h),file=join(entry.folder,'native.u32')
  if(mode==='manifest'){const p=join(entry.folder,'stage.json'),m=JSON.parse(await readFile(p));m.inputs.settings.width=9;await writeFile(p,JSON.stringify(m))}
  if(mode==='missing')await rm(file)
  if(mode==='truncated')await writeFile(file,Buffer.from([0]))
  if(mode==='extra')await writeFile(join(entry.folder,'unclaimed.u32'),Buffer.from([0]))
  if(mode==='symlink'){await rm(file);await symlink(join(h.owner,'native.u32'),file)}
  await assert.rejects(loadNativeStage(h.cache,i))
 }
})
test('failed source verification leaves no published entry or partial temporary directory',async t=>{
 const h=await host(t),i=input();await writeFile(join(h.owner,'native.u32'),Buffer.from([99]));await assert.rejects(storeNativeStage(h.cache,i,h));assert.deepEqual(await readdir(h.cache),[]);assert.equal((await loadNativeStage(h.cache,i)).status,'miss')
 const bad={...h,artifacts:[{...h.artifacts[0],path:'../escape.u32'}]};await assert.rejects(storeNativeStage(h.cache,i,bad),/Unsafe/);assert.deepEqual(await readdir(h.cache),[])
})
