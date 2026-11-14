import assert from'node:assert/strict'
import{readFileSync}from'node:fs'
export const browserProofContract=Object.freeze({schemaVersion:1,family:'compositor-static-rotation',nativeStatus:'CAPTURED_COMPOSITOR_STATIC_ROTATION',finalStatus:'PUBLISHED_COMPOSITOR_STATIC_ROTATION',browserStatus:'PASSED_STATIC_ROTATION_BUILT_PROOF'})
export const cases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'))
export const expectedCases=()=>structuredClone(cases),expectedFinalCases=()=>expectedCases().filter(row=>row.saved)
export const policyPositive=['signed-basis-0--1','signed-basis-0-1','signed-basis-1--1','signed-basis-1-1','signed-basis-2--1','signed-basis-2-1','signed-basis-3--1','signed-basis-3-1','zero-identity','scale-min','scale-max','opaque-group-reroute','static-scalar-literal-selector','group-instance-literal-binding']
export const policyRefusals=['negative-zero','subnormal','infinity','nan','below-bound','above-bound','unlinked-rotation-default','implicit-Float-Rotation','computed-component','recombined-components','GPU-source','animation','no-typed-constructor-mute','changed-selector-cache','changed-source-cache','missing-source-ancestry','cached-source-depth','no-quaternion-into-matrix']
export const resizeCount=row=>['basis-w-positive-unit-0','float-group-0'].includes(row.case)?3:0
const sha=value=>assert.match(value,/^[a-f0-9]{64}$/)
const normal=word=>Number.isInteger(word)&&word>=0&&word<=0xffffffff&&word!==0x80000000&&((word&0x7fffffff)===0||(word&0x7fffffff)>=0x00800000&&(word&0x7fffffff)<0x7f800000)
export function assertPolicy(p){assert.equal(p.status,'STATIC_ROTATION_SOURCE_POLICY_PASSED');assert.deepEqual(p.positive,policyPositive);assert.deepEqual(p.refusals,policyRefusals);assert.equal(p.gpuInitializationCalls,0);assert.equal(p.renders,0);assert.equal(p.supportCredit,0);sha(p.scriptSha256);return p}
export function assertQualification(q){
 assert.equal(q.status,browserProofContract.nativeStatus);assert.deepEqual(q.version,[5,3,0]);assert.equal(q.build,'02f0899d78e3');assert.equal(q.device,'CPU');assert.equal(q.sceneEngine,'CYCLES');assert.equal(q.resultPrecision,'CPU_FLOAT32');assert.equal(q.wordDifferences,0);assert.equal(q.privateMFEndpointComparisons,cases.reduce((n,r)=>n+r.indices.length,0))
 assert.deepEqual(q.cases.map(row=>row.case),cases.map(row=>row.case));assert.equal(new Set(q.cases.map(row=>row.case)).size,cases.length)
 for(const[row,index]of q.cases.map((row,i)=>[row,i])){
  for(const key of Object.keys(cases[index]))assert.deepEqual(row[key],cases[index][key]);assert.deepEqual(Object.keys(row).sort(),[...Object.keys(cases[index]),'rgbaWords','privateMFWords','nativeEvaluations','programFile','programSha256','pixelFile','pixelSha256','inputFile','inputSha256',...(row.saved?['sourceFile','sourceSha256']:[])].sort())
  assert.equal(row.nativeEvaluations,1);assert.equal(row.privateMFWords.length,row.indices.length);assert.ok(row.privateMFWords.every(normal));assert.deepEqual(row.rgbaWords,[...row.privateMFWords,...Array(3-row.indices.length).fill(0),0x3f800000]);if(row.manualQuaternionWords)assert.deepEqual(row.privateMFWords,row.indices.map(i=>row.manualQuaternionWords[i]))
  for(const kind of['program','pixel','input']){sha(row[kind+'Sha256']);assert.equal(row[kind+'File'],row.case+({program:'.program.json',pixel:'.rgba32f',input:'.input32f'})[kind])}
  assert.equal(!!row.sourceFile,row.saved);if(row.saved){assert.equal(row.sourceFile,row.case+'.blend');sha(row.sourceSha256)}
 }return q
}
export function assertFinal(f,q,{built,nativeSha256}){
 assert.equal(f.status,browserProofContract.finalStatus);assert.equal(built,true);assert.equal(f.exporter,'built');assert.equal(f.nativeQualificationSha256,nativeSha256);assert.equal(f.sourcePreserved,true);assert.deepEqual(f.rows.map(row=>row.case),expectedFinalCases().map(row=>row.case))
 for(const row of f.rows){const native=q.cases.find(x=>x.case===row.case);assert.equal(row.sourceFile,native.sourceFile);assert.equal(row.sourceSha256,native.sourceSha256);for(const key of['manifestSha256','glbSha256','presentationSha256'])sha(row[key]);assert.ok(row.presentationPointer?.url);assert.ok(row.presentationPointer.bytes>0)}return f
}
export function assertBrowserRows(report,q,f,{profile,final}){
 assert.equal(report.built,true);assert.equal(report.final,final);assert.equal(report.profile,profile);assert.equal(report.sourceDevice,'CPU');assert.deepEqual(report.rows.map(row=>row.backend),['webgpu','webgl2']);assert.equal(report.missingAdapterControl.refused,true);assert.match(report.missingAdapterControl.error,/actual WebGPU adapter/)
 for(const api of report.rows){assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i);assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.negatives.map(row=>row.kind),['rotation-runtime-transport']);assert.match(api.negatives[0].error,/ROTATION/)
  assert.deepEqual(api.rows.map(row=>row.case),(final?f.rows:q.cases).map(row=>row.case))
  for(const row of api.rows){const native=q.cases.find(x=>x.case===row.case);for(const key of['width','height','pixelRatio','route'])assert.equal(row[key],native[key]);assert.equal(row.exactWordMismatches,0);assert.equal(row.contractViolations,0);assert.equal(row.comparedWords,native.width*native.height*4);assert.equal(row.exactControlWords,row.comparedWords);assert.equal(row.portOwnedTextures,0);assert.equal(row.remainingRenderTargets,0);assert.equal(row.resizeFrames,resizeCount(native));assert.equal(row.resizeResults.length,resizeCount(native));assert.deepEqual(row.resizeResults.map(x=>[x.width,x.height,x.pixelRatio]),resizeCount(native)?[[8,6,2],[3,5,1],[4,4,1]]:[])
   for(const frame of row.resizeResults){assert.equal(frame.exactWordMismatches,0);assert.equal(frame.contractViolations,0);assert.equal(frame.comparedWords,frame.width*frame.height*4)}for(let i=1;i<row.animationFrames.length;i++)assert.ok(row.animationFrames[i]>row.animationFrames[i-1]);assert.ok(row.animationFrames.length>=2)
   if(final){assert.equal(row.pinRejected,true);assert.ok(row.meshCount>0);assert.equal(row.pipeline,'blender-compositor');assert.equal(row.sourceMaterialsPreserved,true);assert.equal(row.lifecycleCycles,3);assert.equal(row.baselineCacheRestored,true);assert.ok(row.baselineSceneDrawCalls>0);assert.ok(row.baselineCache.length<=1);assert.equal(row.remainingTextures,row.baselineCache.length);for(const t of row.baselineCache){assert.equal(t.name,'DFG_LUT');assert.equal(t.width,16);assert.equal(t.height,16)}}else assert.equal(row.remainingTextures,0)
  }
 }return report
}
