import assert from'node:assert/strict'
import{readFileSync}from'node:fs'
export const browserProofContract=Object.freeze({schemaVersion:1,family:'vertex-color-alpha',nativeStatus:'CAPTURED_VERTEX_COLOR_ALPHA',finalStatus:'PUBLISHED_VERTEX_COLOR_ALPHA',browserStatus:'PASSED_VERTEX_COLOR_ALPHA_BUILT_PROOF'})
export const sourceFamily=process.env.SCENETOWEB_ALPHA_SOURCE??'vertex'
assert.ok(['vertex','attribute'].includes(sourceFamily),'Unknown Alpha source family')
export const casesFile=sourceFamily==='attribute'?'attribute-cases.json':'cases.json'
export const sourcePolicyScripts=['packages/blender-addon/tests/vertex_color_alpha_check.py',...(sourceFamily==='attribute'?['packages/blender-addon/tests/attribute_alpha_check.py']:[])]
export const cases=JSON.parse(readFileSync(new URL('./'+casesFile,import.meta.url))).map(row=>({...row,width:64,height:64,owners:row.shared?2:1,materials:row.shared?2:1}))
export const sizes=Object.freeze([64,32,96]),absoluteGate=2**-10
export const expectedCases=()=>structuredClone(cases)
export const expectedFinalCases=expectedCases
export function assertQualification(value){
 assert.equal(value.status,browserProofContract.nativeStatus)
 assert.deepEqual(Object.keys(value).sort(),['schemaVersion','status','nativeVersion','nativeBuild','sourceBackend','sourceHashes','calibration','cases','sourceStage'].sort())
 assert.deepEqual(value.nativeVersion,[5,3,0]);assert.equal(value.nativeBuild,'02f0899d78e3');assert.equal(value.sourceBackend.backend,'METAL')
 assert.deepEqual(value.cases.map(row=>row.case),cases.map(row=>row.case));assert.equal(value.calibration.maxAbs,0);assert.deepEqual(value.calibration.pixelOffset,[0,0])
 for(const[row,spec]of value.cases.map((row,i)=>[row,cases[i]])){
  assert.deepEqual(Object.keys(row).sort(),[...Object.keys(spec),'sourceFile','sourceSha256','rawGlbFile','rawGlbSha256','rawProgramFile','rawProgramSha256','rawProgramBytes','frames'].sort())
  for(const[key,expected]of Object.entries(spec))assert.deepEqual(row[key],expected)
  assert.equal(row.owners,spec.owners);assert.equal(row.materials,spec.materials);assert.equal(row.domain,spec.domain)
  assert.deepEqual(row.frames.map(frame=>frame.width),sizes);assert.ok(row.frames.every(frame=>frame.height===frame.width))
  for(const name of ['source','rawGlb','rawProgram'])assert.ok(typeof row[name+'File']==='string'&&/^[a-f0-9]{64}$/.test(row[name+'Sha256']))
 }
 return value
}
export function assertFinal(value,native,options={}){
 assert.equal(value.status,browserProofContract.finalStatus);assert.equal(value.exporter,'built');assert.equal(value.sourcePreserved,true)
 assert.match(value.nativeQualificationSha256,/^[a-f0-9]{64}$/)
 if(options.nativeSha256)assert.equal(value.nativeQualificationSha256,options.nativeSha256)
 assert.deepEqual(value.rows.map(row=>row.case),native.cases.map(row=>row.case));assert.ok(value.rows.every(row=>row.exactScalarAfterDefaultOptimization===true))
 return value
}
export function assertBrowserRows(report,{profile,phase}){
 assert.equal(report.profile,profile);assert.equal(report.phase,phase);assert.equal(report.built,true)
 assert.deepEqual(report.rows.map(row=>row.backend),['webgpu','webgl2'])
 for(const api of report.rows){
  assert.deepEqual(api.errors,[]);assert.deepEqual(api.uncaptured,[]);assert.deepEqual(api.contextEvents,[])
  assert.deepEqual(api.cases.map(row=>row.case),cases.map(row=>row.case))
  for(const row of api.cases){
   assert.equal(row.primaryWords,64*64*4);assert.equal(row.violations,0);assert.equal(row.alphaOneDiff,0);assert.ok(row.maxAbs<=absoluteGate)
   assert.ok(row.seamPixels>0);assert.equal(row.edgePixels,496);assert.ok(row.seamMax<=absoluteGate);assert.ok(row.edgeMax<=absoluteGate)
   assert.equal(row.cycles,3);assert.equal(row.resizeFrames,3);assert.equal(row.sourceOwnershipRestored,true);assert.equal(row.resourceBaselineRestored,true)
   assert.equal(row.badPinRejected,true);assert.equal(row.scalarWasFloat32,true);assert.equal(row.fullMaterialSmoke,true)
  }
  if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}
  else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
 }
}
/** New named sources must retain their exact field leaf, not a baked/constant substitute. */
export function assertAlphaSourcePrograms(programs,spec){
 if(sourceFamily!=='attribute')return
 assert.equal(spec.sourceNode,'ShaderNodeAttribute');assert.ok(typeof spec.layer==='string'&&spec.layer&&spec.layer!=='temperature')
 for(const material of Object.values(programs.materials)){
  const pending=[material.channels.Emission?.tslIr],seen=new Set(),layers=[]
  while(pending.length){const item=pending.pop();if(!item||typeof item!=='object'||seen.has(item))continue;seen.add(item);if(item.op==='vertex_color_alpha'){assert.equal(item.model,'eevee53-float-color-alpha-scalar-v1');assert.equal(item.sourceProfile,'blender53-eevee-metal-float-color-alpha-v1');layers.push(item.layer)}pending.push(...Object.values(item).filter(x=>x&&typeof x==='object'))}
  assert.ok(layers.length>0);assert.deepEqual([...new Set(layers)],[spec.layer])
 }
}
