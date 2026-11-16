// SPDX-License-Identifier: MIT
// CPU replay: verifies frozen producer, SDK snapshots, fixtures and observations.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
const hash=b=>createHash('sha256').update(b).digest('hex')
const evidence=JSON.parse(await readFile(new URL('evidence.json',import.meta.url)))
assert.equal(evidence.readerSha256,hash(await readFile(import.meta.filename)))
const directory=resolve(process.argv[2])
for(const [file,sha]of Object.entries(evidence.artifacts))assert.equal(hash(await readFile(join(directory,file))),sha,file)
const report=JSON.parse(await readFile(join(directory,'report.json')))
assert.equal(report.status,'PASS');assert.deepEqual(report.errors,[]);assert.equal(report.sourceCommit,evidence.sourceCommit)
assert.equal(report.producerSha256,evidence.artifacts['producer.mjs']);assert.equal(report.fixtureSha256,evidence.artifacts['fixture.js'])
for(const [file,sha]of Object.entries(report.sourceHashes))assert.equal(evidence.artifacts['sdk-snapshot/'+file],sha)
const result=report.result;assert.equal(result.status,'NATIVE_BITMAP_LIFECYCLE_PASS_NOT_NODE_OR_SCENE_PARITY');assert.match(JSON.stringify(result.identity),/Apple.*Metal|Metal.*Apple/)
const names=['default-detached-dispose','default-load-reload-0','default-load-reload-1','public-cancel-during-native-decode','public-fresh-legacy-refusal','custom-loader-borrowed','preloaded-borrowed','cache-borrowed-after-clear']
assert.deepEqual(result.cases.map(c=>c.name),names)
let decoded=0,closed=0
for(const [i,row]of result.cases.entries()){
 assert.equal(row.bitmaps.length,1)
 const b=row.bitmaps[0],owned=i<5;assert.equal(b.nativeBitmap,true);assert.deepEqual(b.initial,[2,2]);assert.equal(b.closeCalls,owned?1:0);assert.deepEqual(b.final,owned?[0,0]:[2,2]);decoded++;closed+=b.closeCalls
 if(i===1||i===2){assert.equal(row.textureDisposes,1);assert.equal(row.sourceCleared,true)}
 if(i>=5)assert.equal(row.sourcePreserved,true)
}
assert.equal(result.cases[3].error.name,'AbortError');assert.match(result.cases[4].error,/Legacy WebGLRenderer cannot render.*Light Path shadow exclusion/);assert.equal(result.cases[7].sharedAcrossLoads,true)
assert.equal(result.observedDecodes,decoded);assert.equal(result.ownedNativeCloses,closed);assert.equal(decoded,8);assert.equal(closed,5)
const bytes=await readFile(join(directory,'required.glb')),json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)))
assert.deepEqual(json.meshes[0].extras.blendlink_tsl_runtime.requiresNodeRenderer.programs,[{op:'shadow_exclusion_native',model:'eevee53-white-shadow-branch-v1'}])
const programs=await readFile(join(directory,'programs.json')),html=await readFile(join(directory,'index.html'),'utf8'),pointer=JSON.parse(html.match(/window.pointer=(\{.*?\})<\/script>/)[1])
assert.equal(pointer.bytes,programs.length);assert.equal(pointer.hash,hash(programs).slice(0,16))
assert.equal(JSON.parse(programs).materials.Artist.channels.Alpha.tslIr.output.op,'shadow_exclusion_native')
console.log(JSON.stringify({status:'CLOSED_NATIVE_IMAGE_BITMAP_LIFECYCLE_NOT_NODE_OR_SCENE_PARITY',cases:names.length,actualDecodes:decoded,ownedCloses:closed,borrowedPreserved:3,sourceCommit:report.sourceCommit}))
