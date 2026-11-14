import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
export const browserProofContract=Object.freeze({schemaVersion:1,family:'compositor-white-noise',nativeStatus:'CAPTURED_COMPOSITOR_WHITE_NOISE',finalStatus:'PUBLISHED_COMPOSITOR_WHITE_NOISE',browserStatus:'PASSED_WHITE_NOISE_BUILT_PROOF'})
export const cases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'))
export const expectedCases=()=>structuredClone(cases)
export const expectedFinalCases=()=>structuredClone(cases.filter(row=>row.saved))
export const resizeCount=row=>['1d-value-ordinary','group-4d-color'].includes(row.case)?3:0
const sha=value=>assert.match(value,/^[a-f0-9]{64}$/)
const floatBits=value=>new Uint32Array(new Float32Array([value]).buffer)[0]
const asFloat=word=>new Float32Array(new Uint32Array([word]).buffer)[0]
export function hashWords(words){
 const rotate=(x,n)=>((x<<n)|(x>>>(32-n)))>>>0
 let a=(0xdeadbeef+(words.length<<2)+13)>>>0,b=a,c=a
 a=(a+words[0])>>>0;if(words.length>1)b=(b+words[1])>>>0;if(words.length>2)c=(c+words[2])>>>0
 if(words.length===4){
  a=((a-c)^rotate(c,4))>>>0;c=(c+b)>>>0;b=((b-a)^rotate(a,6))>>>0;a=(a+c)>>>0;c=((c-b)^rotate(b,8))>>>0;b=(b+a)>>>0
  a=((a-c)^rotate(c,16))>>>0;c=(c+b)>>>0;b=((b-a)^rotate(a,19))>>>0;a=(a+c)>>>0;c=((c-b)^rotate(b,4))>>>0;b=(b+a)>>>0;a=(a+words[3])>>>0
 }
 c=((c^b)-rotate(b,14))>>>0;a=((a^c)-rotate(c,11))>>>0;b=((b^a)-rotate(a,25))>>>0;c=((c^b)-rotate(b,16))>>>0;a=((a^c)-rotate(c,4))>>>0;b=((b^a)-rotate(a,14))>>>0;c=((c^b)-rotate(b,24))>>>0
 return c
}
export function expectedRgbaWords(row){
 const words=row.dimensions===1?[row.seedWords[3]]:row.seedWords.slice(0,row.dimensions),unit=words=>floatBits(Math.fround(hashWords(words))/Math.fround(0xffffffff))
 if(row.output==='Value')return [unit(words),unit(words),unit(words),floatBits(1)]
 const [x,y,z,w]=words,seeds=words.length===4?[words,[z,x,w,y],[w,z,y,x]]:[words,[...words,floatBits(1)],[...words,floatBits(2)]]
 return [...seeds.map(unit),floatBits(1)]
}
export const policyRefusals=['raw-refusal-0x80000000','raw-refusal-0x1','raw-refusal-0x80000001','raw-refusal-0x7fffff','stored-nonfinite-0x7fc12345','combine-subnormal-0','combine-subnormal-1','combine-subnormal-2','animated-source','computed-source','implicit-vector-cast','unqualified-gpu-authored-source','group-default-subnormal','group-default-negative-zero','source-depth-budget']
export const interfaceDefaultControls=[
 {case:'vector-UNIFORM_IMAGE_COORDINATES',nativeAvailable:true,status:'unsupported'},
 {case:'vector-linked-override',nativeAvailable:true,status:'extracted'},
 {case:'vector-NORMALIZED_IMAGE_COORDINATES',nativeAvailable:false},
 {case:'vector-PIXEL_IMAGE_COORDINATES',nativeAvailable:false},
 {case:'vector-single-value',nativeAvailable:true,status:'extracted'},
 {case:'float-value-default',nativeAvailable:true,status:'extracted'},
 {case:'float-SCENE_FRAME',nativeAvailable:true,status:'unsupported'},
 {case:'float-SCENE_TIME',nativeAvailable:false},
 {case:'float-SCENE_SECONDS',nativeAvailable:false},
 ...['unknown-default','unknown-structure','field-structure','identifier-mismatch','output-direction','type-mismatch'].map(name=>({case:name,privateSchemaBoundary:true,status:'unsupported'}))
]
export const defaultFieldControls=[{case:'implicit-default-field-model',status:'extracted',model:'native-compositor-white-noise-uniform-cpu-53-v1',profile:'darwin-arm64-53-white-noise-uniform-cpu-v1',coordinateModel:'exact-uniform-r32f-axes-v1',dimension:4,authoredInputs:['W'],isField:true,fieldNumericCredit:0}]
export function assertPolicy(value){
 assert.equal(value.status,'WHITE_NOISE_SOURCE_POLICY_PASSED');assert.equal(value.positiveControls.length,18);assert.deepEqual(value.namedRefusals,policyRefusals)
 assert.deepEqual(value.defaultFieldControls,defaultFieldControls)
 assert.deepEqual(value.interfaceDefaultControls.map(({setterRefusal,...row})=>row),interfaceDefaultControls)
 for(const row of value.interfaceDefaultControls)if(row.nativeAvailable===false){assert.equal(typeof row.setterRefusal,'string');assert.match(row.setterRefusal,/not found/)}
 assert.equal(value.gpuInitializationCalls,0);assert.equal(value.renders,0);assert.equal(value.portCredit,0);return value
}
export function assertQualification(q){
 assert.equal(q.status,browserProofContract.nativeStatus);assert.deepEqual(q.version,[5,3,0]);assert.equal(q.build,'02f0899d78e3');assert.equal(q.device,'CPU');assert.equal(q.sceneEngine,'CYCLES');assert.equal(q.resultPrecision,'CPU_FLOAT32');assert.equal(q.wordDifferences,0)
 assert.deepEqual(q.cases.map(row=>row.case),cases.map(row=>row.case));assert.equal(new Set(q.cases.map(row=>row.case)).size,cases.length)
 for(const [row,index] of q.cases.map((row,i)=>[row,i])){
  for(const key of Object.keys(cases[index]))assert.deepEqual(row[key],cases[index][key])
  assert.deepEqual(row.rgbaWords,expectedRgbaWords(row))
  for(const kind of ['program','pixel','input']){sha(row[kind+'Sha256']);assert.equal(row[kind+'File'],row.case+({program:'.program.json',pixel:'.rgba32f',input:'.input32f'})[kind])}
  assert.equal(!!row.sourceFile,row.saved);if(row.saved){assert.equal(row.sourceFile,row.case+'.blend');sha(row.sourceSha256)}
  if(row.imageInfoControl){assert.deepEqual(row.imageInfoDimensions,[0,0]);assert.equal(row.imageInfoFile,row.case+'.info.rgba32f');sha(row.imageInfoSha256)}
  else for(const key of ['imageInfoDimensions','imageInfoFile','imageInfoSha256'])assert.equal(row[key],undefined)
 }
 return q
}
export function assertFinal(value,q,{built,nativeSha256}){
 assert.equal(value.status,browserProofContract.finalStatus);assert.equal(built,true);assert.equal(value.exporter,'built');assert.equal(value.nativeQualificationSha256,nativeSha256);assert.equal(value.sourcePreserved,true);assert.deepEqual(value.rows.map(row=>row.case),expectedFinalCases().map(row=>row.case))
 for(const row of value.rows){const native=q.cases.find(x=>x.case===row.case);assert.equal(row.sourceFile,native.sourceFile);assert.equal(row.sourceSha256,native.sourceSha256);for(const key of['manifestSha256','glbSha256','presentationSha256'])sha(row[key]);assert.ok(row.presentationPointer?.url);assert.ok(row.presentationPointer.bytes>0)}return value
}
export function assertBrowserRows(report,q,f,{profile,final}){
 assert.equal(report.built,true);assert.equal(report.final,final);assert.equal(report.profile,profile);assert.equal(report.sourceDevice,'CPU');assert.deepEqual(report.rows.map(row=>row.backend),['webgpu','webgl2']);assert.equal(report.missingAdapterControl.refused,true);assert.match(report.missingAdapterControl.error,/actual WebGPU adapter/)
 for(const api of report.rows){assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i);assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.negatives.map(row=>row.kind),['white-noise-source-profile']);assert.match(api.negatives[0].error,/White Noise/)
  assert.deepEqual(api.rows.map(row=>row.case),(final?f.rows:q.cases).map(row=>row.case))
  for(const row of api.rows){const native=q.cases.find(x=>x.case===row.case);for(const key of['width','height','pixelRatio','route'])assert.equal(row[key],native[key]);assert.equal(row.exactWordMismatches,0);assert.equal(row.contractViolations,0);assert.equal(row.comparedWords,native.width*native.height*4);assert.equal(row.exactControlWords,row.comparedWords);assert.equal(row.portOwnedTextures,0);assert.equal(row.remainingRenderTargets,0);assert.equal(row.resizeFrames,resizeCount(native));assert.equal(row.resizeResults.length,resizeCount(native))
   assert.deepEqual(row.resizeResults.map(frame=>[frame.width,frame.height,frame.pixelRatio]),resizeCount(native)?[[8,6,2],[3,5,1],[4,4,1]]:[])
   for(const frame of row.resizeResults){assert.equal(frame.exactWordMismatches,0);assert.equal(frame.contractViolations,0);assert.equal(frame.comparedWords,frame.width*frame.height*4)}
   for(let i=1;i<row.animationFrames.length;i++)assert.ok(row.animationFrames[i]>row.animationFrames[i-1]);assert.ok(row.animationFrames.length>=2)
   if(final){assert.equal(row.pinRejected,true);assert.ok(row.meshCount>0);assert.equal(row.pipeline,'blender-compositor');assert.equal(row.sourceMaterialsPreserved,true);assert.equal(row.lifecycleCycles,3);assert.equal(row.baselineCacheRestored,true);assert.ok(row.baselineSceneDrawCalls>0);assert.ok(row.baselineCache.length<=1);assert.equal(row.remainingTextures,row.baselineCache.length);for(const t of row.baselineCache){assert.equal(t.name,'DFG_LUT');assert.equal(t.width,16);assert.equal(t.height,16)}}else assert.equal(row.remainingTextures,0)
  }
 }return report
}
