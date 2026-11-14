import assert from'node:assert/strict'
import{readFileSync}from'node:fs'
export const browserProofContract=Object.freeze({schemaVersion:1,family:'compositor-box-mask',nativeStatus:'CAPTURED_COMPOSITOR_BOX_MASK',finalStatus:'PUBLISHED_COMPOSITOR_BOX_MASK',browserStatus:'PASSED_BOX_MASK_BUILT_PROOF'})
export const cases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'))
export const expectedCases=()=>structuredClone(cases),expectedFinalCases=()=>expectedCases().filter(row=>row.saved)
export const policyRefusals=['gpu','rotation','negative-zero','small','border','field','flip','animated']
export const browserRefusals=['model','version','source-profile','evaluator','precision','storage','scalar-words','literal-bound','extra-input','schema','duplicate-id','spatial']
export const resizeSequence=entry=>entry.width===13&&entry.height===9&&entry.route==='direct'&&entry.resizeFamily?[...cases.filter(row=>row.resizeFamily===entry.resizeFamily&&row.case!==entry.case),entry]:[]
const sha=value=>assert.match(value,/^[a-f0-9]{64}$/)
export function assertQualification(q){
 assert.equal(q.status,browserProofContract.nativeStatus);assert.deepEqual(q.version,[5,3,0]);assert.equal(q.build,'02f0899d78e3');assert.equal(q.device,'CPU');assert.equal(q.sceneEngine,'CYCLES');assert.equal(q.resultPrecision,'CPU_FLOAT32');assert.equal(q.scalarReadCycles,128);assert.equal(q.scalarReadSourceUnchanged,true);assert.equal(q.scalarReadGroupCensusRestored,true)
 assert.deepEqual(q.cases.map(row=>row.case),cases.map(row=>row.case));assert.equal(new Set(q.cases.map(row=>row.case)).size,cases.length)
 for(const[row,i]of q.cases.map((row,i)=>[row,i])){for(const key of Object.keys(cases[i]))assert.deepEqual(row[key],cases[i][key]);assert.deepEqual(Object.keys(row).sort(),[...Object.keys(cases[i]),'programFile','programSha256','pixelFile','pixelSha256','inputFile','inputSha256',...(row.saved?['sourceFile','sourceSha256']:[])].sort());for(const kind of['program','pixel','input']){sha(row[kind+'Sha256']);assert.equal(row[kind+'File'],row.case+({program:'.program.json',pixel:'.rgba32f',input:'.input32f'})[kind])}assert.equal(!!row.sourceFile,cases[i].saved);if(row.sourceFile){assert.equal(row.sourceFile,row.case+'.blend');sha(row.sourceSha256)}}
 assert.deepEqual(q.refusals.map(row=>row.case),policyRefusals);for(const row of q.refusals){assert.ok(row.diagnostics.length);assert.ok(row.diagnostics.some(x=>x.code==='animated-tree'||x.message.includes('Box Mask')))}
 assert.equal(q.rawScalarControls.length,3);assert.deepEqual(q.rawScalarControls.map(x=>x.inputWords),[[0,2147483648,1],[8388607,2147483649,2155872255],[1048576000,1056964608,3212836864]]);for(const row of q.rawScalarControls)assert.deepEqual(row.actualWords,row.inputWords)
 return q
}
export function assertFinal(f,q,{built,nativeSha256}){
 assert.equal(f.status,browserProofContract.finalStatus);assert.equal(built,true);assert.equal(f.exporter,'built');assert.equal(f.nativeQualificationSha256,nativeSha256);assert.equal(f.sourcePreserved,true);assert.deepEqual(f.rows.map(row=>row.case),expectedFinalCases().map(row=>row.case))
 for(const row of f.rows){const native=q.cases.find(x=>x.case===row.case);assert.equal(row.sourceFile,native.sourceFile);assert.equal(row.sourceSha256,native.sourceSha256);for(const key of['manifestSha256','glbSha256','presentationSha256'])sha(row[key]);assert.ok(row.presentationPointer?.url);assert.ok(row.presentationPointer.bytes>0)}return f
}
export function assertBrowserRefusals(rows){assert.deepEqual(rows.map(row=>row.kind),browserRefusals);for(const row of rows)assert.match(row.error,/Box Mask/)}
export function assertBrowserRows(report,q,f,{profile,final}){
 assert.equal(report.built,true);assert.equal(report.final,final);assert.equal(report.profile,profile);assert.equal(report.sourceDevice,'CPU');assert.deepEqual(report.rows.map(row=>row.backend),['webgpu','webgl2']);assert.equal(report.missingAdapterControl.refused,true);assert.match(report.missingAdapterControl.error,/actual WebGPU adapter/)
 for(const api of report.rows){assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i);assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assertBrowserRefusals(api.negatives)
  const selected=final?f.rows:q.cases;assert.deepEqual(api.rows.map(row=>row.case),selected.map(row=>row.case))
  for(const row of api.rows){const native=q.cases.find(source=>source.case===row.case);for(const key of['width','height','pixelRatio','route'])assert.equal(row[key],native[key]);assert.equal(row.exactWordMismatches,0);assert.equal(row.contractViolations,0);assert.equal(row.comparedWords,row.width*row.height*4);assert.equal(row.portOwnedTextures,0);assert.equal(row.remainingRenderTargets,0)
   const sequence=resizeSequence(native);assert.equal(row.resizeFrames,sequence.length);assert.equal(row.resizeResults.length,sequence.length);assert.equal(row.extentRefused,sequence.length>0);assert.equal(row.extentRecovered,sequence.length>0)
   for(const[x,i]of row.resizeResults.map((x,i)=>[x,i])){const wanted=sequence[i];assert.deepEqual([x.width,x.height,x.pixelRatio],[wanted.width,wanted.height,wanted.pixelRatio]);assert.equal(x.exactWordMismatches,0);assert.equal(x.contractViolations,0);assert.equal(x.comparedWords,x.width*x.height*4)}
   for(let i=1;i<row.animationFrames.length;i++)assert.ok(row.animationFrames[i]>row.animationFrames[i-1]);assert.ok(row.animationFrames.length>=2)
   if(final){assert.equal(row.pinRejected,true);assert.ok(row.meshCount>0);assert.equal(row.pipeline,'blender-compositor');assert.equal(row.sourceMaterialsPreserved,true);assert.equal(row.lifecycleCycles,3);assert.equal(row.baselineCacheRestored,true);assert.ok(row.baselineSceneDrawCalls>0);assert.ok(row.baselineCache.length<=1);assert.equal(row.remainingTextures,row.baselineCache.length);for(const t of row.baselineCache){assert.equal(t.name,'DFG_LUT');assert.equal(t.width,16);assert.equal(t.height,16)}}else assert.equal(row.remainingTextures,0)
  }
 }return report
}
