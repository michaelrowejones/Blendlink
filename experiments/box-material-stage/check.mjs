// SPDX-License-Identifier: GPL-3.0-or-later
// Additive complete-color reader; shared sampler/native archive readers remain
// authoritative for their stages. No transformed/omitted-pixel fitting.
import assert from'node:assert/strict'
import{readFile,writeFile}from'node:fs/promises'
import{createHash}from'node:crypto'
import{join,resolve}from'node:path'
import{closePaired}from'../box-image-storage-stage/paired-check.mjs'
import{lowerLeftRows}from'../box-image-storage-stage/orientation-check.mjs'
import{compare}from'../box-image-transport-prototype/compare.mjs'
import{validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
export async function closeColor({retainedNative,browserDir,producer,nativeDir,stageGate}){
 const paired=await closePaired(retainedNative,browserDir,producer)
 const{assertPairedStage}=await import(stageGate);const pairedAcceptance=assertPairedStage(paired)
 const root=resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex')
 const nativeBytes=await readFile(join(nativeDir,'native.json')),n=JSON.parse(nativeBytes),browserBytes=await readFile(join(browserDir,'browser.json')),b=JSON.parse(browserBytes),cases=JSON.parse(await readFile(join(nativeDir,'geometry-inputs.json'))).cases
 assert.equal(n.status,'CAPTURED_ORIGINAL_PLASTER_COLOR_SIGNAL_RESEARCH');assert.equal(n.sourcePreserved,true);assert.equal(n.bound,2**-10);assert.equal(n.sourceSha256,sha(await readFile(n.source)))
 assert.equal(n.captureSha256,sha(await readFile(join(import.meta.dirname,'capture.py'))));assert.equal(n.fixtureSha256,sha(await readFile(join(root,'experiments/box-image-storage-stage/geometry_fixture.py'))));assert.equal(n.geometryInputsSha256,sha(await readFile(join(nativeDir,'geometry-inputs.json'))))
 await validateNativeArchive(JSON.parse(await readFile(join(nativeDir,'native-archive.json'))),nativeDir,{expectedFinalSources:[],expectedScripts:[{path:join(import.meta.dirname,'capture.py'),invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 assert.equal(cases.length,6);assert.deepEqual(cases.map(c=>c.id).sort(),['plane-0','plane-1','plane-2','plane-3','source-Plane.021','source-Walls'])
 assert.equal(n.rows.length,18);assert.equal(new Set(n.rows.map(r=>r.id)).size,18)
 assert.equal(b.apis.length,2);const rows=[]
 for(const api of b.apis){
  assert.equal(api.materialColorRows.length,30);assert.equal(new Set(api.materialColorRows.map(r=>r.id)).size,30)
  for(const input of cases)for(const kind of ['mask','mapping','color','unmapped','unmixed']){
   const expectedKind=['unmapped','unmixed'].includes(kind)?'color':kind,nr=n.rows.find(r=>r.id===input.id+'-'+expectedKind),br=api.materialColorRows.find(r=>r.id==='material-'+input.id+'-'+kind);assert.ok(nr);assert.ok(br)
   const native=await readFile(join(nativeDir,nr.file)),actual=await readFile(join(browserDir,br.file));assert.equal(sha(native),nr.sha256);assert.equal(sha(actual),br.sha256);assert.equal(native.length,4096);assert.equal(actual.length,4096)
   const bound=kind==='mask'?0:2**-10,result=compare(lowerLeftRows(actual,api.backend,64,4),native,bound)
   rows.push({api:api.backend,case:input.id,kind,bound,...result})
  }
  for(const kind of ['unmapped','unmixed'])assert.ok(rows.some(r=>r.api===api.backend&&r.kind===kind&&r.violations>0),'Missing failing '+kind+' negative')
 }
 const positive=rows.filter(r=>!['unmapped','unmixed'].includes(r.kind)),violations=positive.reduce((s,r)=>s+r.violations,0)
 const result={status:violations?'COLOR_SIGNAL_GATE_FAILED':'COLOR_SIGNAL_PASSED_NOT_FINAL_OR_NORMAL_MAP',supportCredit:0,materialCredit:0,sceneCredit:0,nativeSha256:sha(nativeBytes),browserSha256:sha(browserBytes),pairedAcceptance,pairedSourceGateSha256:sha(await readFile(new URL(stageGate))),bound:2**-10,positiveWords:positive.reduce((s,r)=>s+r.words,0),violations,rows}
 return result
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const[retainedNative,browserDir,producer,nativeDir,gate,out]=process.argv.slice(2)
 const result=await closeColor({retainedNative:resolve(retainedNative),browserDir:resolve(browserDir),producer:resolve(producer),nativeDir:resolve(nativeDir),stageGate:new URL('file://'+resolve(gate)).href});await writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));assert.equal(result.violations,0)
}
