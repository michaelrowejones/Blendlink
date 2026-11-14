import assert from'node:assert/strict'
import{readFileSync}from'node:fs'
export const browserProofContract=Object.freeze({schemaVersion:1,family:'compositor-static-matrix',nativeStatus:'CAPTURED_COMPOSITOR_STATIC_MATRIX',finalStatus:'PUBLISHED_COMPOSITOR_STATIC_MATRIX',browserStatus:'PASSED_STATIC_MATRIX_BUILT_PROOF'})
export const cases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'))
export const inputWords=Object.freeze([0,0x3dcccccd,0xbdcccccd,0x3eaaaaab,0x00800000,0x80800000,0x7f7fffff,0xff7fffff,0x45001000,0x44fc0400,0x3f4ccccd,0xbf4ccccd,0x3f000001,0x3effffff,0x37800000,0xb7800000])
export const expectedCases=()=>structuredClone(cases)
export const expectedRgbaWords=row=>row.route==='direct'?[...row.indices.map(i=>inputWords[row.transpose?(i%4)*4+Math.floor(i/4):i]),...Array(3-row.indices.length).fill(0),0x3f800000]:[0x3e800000,0x3f400000,0x3f800000,0x3f800000]
export const expectedFinalCases=()=>structuredClone(cases.filter(row=>row.saved))
export const policyRefusals=['gpu','negative-zero','arithmetic','unlinked-matrix','animated','same-extraction-source-mutation','source-depth-limit','cached-source-subtree-depth','cached-source-route-depth','broad-source-node-budget','raw-nonnormal-stored-inputs','same-extraction-initial-group-binding-mutation']
export const resizeCount=row=>['combine-0','float-group'].includes(row.case)?3:0
const sha=value=>assert.match(value,/^[a-f0-9]{64}$/)
export function assertPolicy(value){assert.equal(value.status,'STATIC_MATRIX_SOURCE_POLICY_PASSED');assert.equal(value.positives.length,8);assert.deepEqual(value.refusals,policyRefusals);assert.equal(value.schemas.length,6);assert.equal(value.gpuInitializationCalls,0);assert.equal(value.renders,0);assert.equal(value.nodePortCredit,0);return value}
export function assertQualification(q){
 assert.equal(q.status,browserProofContract.nativeStatus);assert.deepEqual(q.version,[5,3,0]);assert.equal(q.build,'02f0899d78e3');assert.equal(q.device,'CPU');assert.equal(q.sceneEngine,'CYCLES');assert.equal(q.resultPrecision,'CPU_FLOAT32');assert.equal(q.wordDifferences,0)
 assert.deepEqual(q.inputWords,inputWords)
 assert.deepEqual(q.cases.map(row=>row.case),cases.map(row=>row.case));assert.equal(new Set(q.cases.map(row=>row.case)).size,cases.length)
 for(const[row,index]of q.cases.map((row,i)=>[row,i])){
  for(const key of Object.keys(cases[index]))assert.deepEqual(row[key],cases[index][key]);assert.equal(row.rgbaWords.length,4);assert.equal(row.rgbaWords[3],0x3f800000)
  const expected=expectedRgbaWords(row);assert.deepEqual(row.rgbaWords,expected)
  assert.equal(row.nativeEvaluations,row.route==='direct'?1:2);assert.deepEqual(row.privateMFWords,row.rgbaWords.slice(0,row.indices.length))
  for(const kind of['program','pixel','input']){sha(row[kind+'Sha256']);assert.equal(row[kind+'File'],row.case+({program:'.program.json',pixel:'.rgba32f',input:'.input32f'})[kind])}
  assert.equal(!!row.sourceFile,row.saved);if(row.saved){assert.equal(row.sourceFile,row.case+'.blend');sha(row.sourceSha256)}
 }return q
}
export function assertFinal(value,q,{built,nativeSha256}){
 assert.equal(value.status,browserProofContract.finalStatus);assert.equal(built,true);assert.equal(value.exporter,'built');assert.equal(value.nativeQualificationSha256,nativeSha256);assert.equal(value.sourcePreserved,true);assert.deepEqual(value.rows.map(row=>row.case),expectedFinalCases().map(row=>row.case))
 for(const row of value.rows){const native=q.cases.find(x=>x.case===row.case);assert.equal(row.sourceFile,native.sourceFile);assert.equal(row.sourceSha256,native.sourceSha256);for(const key of['manifestSha256','glbSha256','presentationSha256'])sha(row[key]);assert.ok(row.presentationPointer?.url);assert.ok(row.presentationPointer.bytes>0)}return value
}
export function assertBrowserRows(report,q,f,{profile,final}){
 assert.equal(report.built,true);assert.equal(report.final,final);assert.equal(report.profile,profile);assert.equal(report.sourceDevice,'CPU');assert.deepEqual(report.rows.map(row=>row.backend),['webgpu','webgl2']);assert.equal(report.missingAdapterControl.refused,true);assert.match(report.missingAdapterControl.error,/actual WebGPU adapter/)
 for(const api of report.rows){assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i);assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.negatives.map(row=>row.kind),['matrix-runtime-transport']);assert.match(api.negatives[0].error,/matrix-unqualified/)
  assert.deepEqual(api.rows.map(row=>row.case),(final?f.rows:q.cases).map(row=>row.case))
  for(const row of api.rows){const native=q.cases.find(x=>x.case===row.case);for(const key of['width','height','pixelRatio','route'])assert.equal(row[key],native[key]);assert.equal(row.exactWordMismatches,0);assert.equal(row.contractViolations,0);assert.equal(row.comparedWords,native.width*native.height*4);assert.equal(row.exactControlWords,row.comparedWords);assert.equal(row.portOwnedTextures,0);assert.equal(row.remainingRenderTargets,0);assert.equal(row.resizeFrames,resizeCount(native));assert.equal(row.resizeResults.length,resizeCount(native))
   assert.deepEqual(row.resizeResults.map(frame=>[frame.width,frame.height,frame.pixelRatio]),resizeCount(native)?[[8,6,2],[3,5,1],[4,4,1]]:[])
   for(const frame of row.resizeResults){assert.equal(frame.exactWordMismatches,0);assert.equal(frame.contractViolations,0);assert.equal(frame.comparedWords,frame.width*frame.height*4)}
   for(let i=1;i<row.animationFrames.length;i++)assert.ok(row.animationFrames[i]>row.animationFrames[i-1]);assert.ok(row.animationFrames.length>=2)
   if(final){assert.equal(row.pinRejected,true);assert.ok(row.meshCount>0);assert.equal(row.pipeline,'blender-compositor');assert.equal(row.sourceMaterialsPreserved,true);assert.equal(row.lifecycleCycles,3);assert.equal(row.baselineCacheRestored,true);assert.ok(row.baselineSceneDrawCalls>0);assert.ok(row.baselineCache.length<=1);assert.equal(row.remainingTextures,row.baselineCache.length);for(const t of row.baselineCache){assert.equal(t.name,'DFG_LUT');assert.equal(t.width,16);assert.equal(t.height,16)}}else assert.equal(row.remainingTextures,0)
  }
 }return report
}
