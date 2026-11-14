/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {hashWords} from '../compositor-white-noise/protocol.mjs'
export const browserProofContract=Object.freeze({schemaVersion:1,family:'compositor-wave-axis',nativeStatus:'CAPTURED_COMPOSITOR_WAVE_AXIS',finalStatus:'PUBLISHED_COMPOSITOR_WAVE_AXIS',browserStatus:'PASSED_WAVE_AXIS_BUILT_PROOF'})
export const cases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'))
export function assertCasePlan(plan){
 assert.equal(plan.length,140);assert.equal(plan.filter(row=>row.saved).length,20)
 assert.equal(new Set(plan.map(row=>row.case)).size,plan.length)
 const keys=new Set()
 for(const row of plan){
  assert.match(row.case,/^[A-Za-z0-9-]+$/);assert.ok(['X','Y'].includes(row.axis));assert.ok(['SAW','TRI'].includes(row.profile));assert.ok(['Fac','Color'].includes(row.output));assert.ok(['direct','group-reroute','shared','mixed-white-noise'].includes(row.route));assert.ok([1,2].includes(row.pixelRatio));assert.equal(typeof row.saved,'boolean')
  for(const size of[row.width,row.height])assert.ok(Number.isInteger(size)&&size>=4&&size<=8192)
  assert.equal(row.parameterWords.length,3);assert.equal(row.parameterWords[2],0)
  for(const bits of row.parameterWords){assert.ok(Number.isSafeInteger(bits)&&bits>=0&&bits<=0xffffffff);const abs=bits&0x7fffffff;assert.ok(bits===0||abs>=0x37800000&&abs<=0x41000000)}
  assert.ok(Array.isArray(row.resizeCases));for(const label of row.resizeCases)assert.ok(plan.some(r=>r.case===label&&r.axis===row.axis&&r.profile===row.profile&&r.output===row.output&&r.route===row.route&&JSON.stringify(r.parameterWords)===JSON.stringify(row.parameterWords)))
  const key=[row.width,row.height,row.axis,row.profile,row.output,row.route,...row.parameterWords].join(':');assert.ok(!keys.has(key),'Repeated numerical case variant');keys.add(key)
 }
 for(const[w,h]of[[13,9],[9,13],[26,18],[18,26],[127,65],[65,127],[8192,4],[4,8192]])for(const axis of['X','Y'])for(const profile of['SAW','TRI'])for(const output of['Fac','Color'])assert.equal(plan.filter(row=>row.width===w&&row.height===h&&row.axis===axis&&row.profile===profile&&row.output===output&&row.route==='direct'&&JSON.stringify(row.parameterWords)==='[1084227584,0,0]').length,1)
 return plan
}
assertCasePlan(cases)
export const expectedCases=()=>structuredClone(cases)
export const expectedFinalCases=()=>structuredClone(cases.filter(row=>row.saved))
export const extents=Object.freeze([...new Map(cases.map(r=>[r.width+'x'+r.height,[r.width,r.height]])).values()])
export const resizeCount=row=>row.resizeCases.length
export const expectedTables=row=>row.route==='mixed-white-noise'?2:1
export const expectedMaximumRowBytes=row=>Math.max(...[row,...row.resizeCases.map(label=>cases.find(r=>r.case===label))].map(r=>Math.max(r.width,r.height)))*4*(row.route==='mixed-white-noise'?3:1)
export const word=value=>new Uint32Array(new Float32Array([value]).buffer)[0]
export const value=bits=>new Float32Array(new Uint32Array([bits]).buffer)[0]
const sha=value=>assert.match(value,/^[a-f0-9]{64}$/)
export function uniformAxisWords(size,maximum){const f=Math.fround;return Array.from({length:size},(_,i)=>word(f(f(f(f(i+.5)-f(size/2))/maximum)*2)))}
// Independent source-law interpreter; never imports production Wave/row code.
// The native CPU callback divides by double 2*pi before assigning Float32.
export function expectedWaveRgbaWords(row,axes){
 const f=Math.fround,coordinate=value(axes[row.axis==='X'?0:1]),scale=value(row.parameterWords[0]),phase=value(row.parameterWords[1])
 const scaled=f(coordinate*scale),offset=f(scaled+f(.000001)),shrink=f(offset*f(.999999)),argument=f(f(shrink*20)+phase),cycles=f(argument/(Math.PI*2))
 const floor=row.profile==='SAW'?Math.floor(cycles):Math.floor(f(cycles+.5))
 const result=row.profile==='SAW'?f(cycles-floor):f(Math.abs(f(cycles-floor))*2),a=word(result)
 const b=row.route==='mixed-white-noise'?word(f(f(hashWords(axes.slice(0,2)))/f(0xffffffff))):a
 return[a,b,a,word(1)]
}
export const policyPositive=['X-SAW-Color','X-SAW-Fac','X-TRI-Color','X-TRI-Fac','Y-SAW-Color','Y-SAW-Fac','Y-TRI-Color','Y-TRI-Fac','literal-8','literal-9','literal-10','literal-11','literal-12','literal-13','ignored-vector-and-dead-detail','group-reroute-field','repeated-group-shared-key','cross-family-unchanged']
export const policyRefusals=['native-muted-Color','native-muted-Fac','default-SIN','rings','diagonal','distortion','negative-zero','below-minimum','above-maximum','mapping','linked-Scale','linked-Phase Offset','linked-Distortion','linked-Vector','linked-Detail','linked-Detail Scale','linked-Detail Roughness','border','pixel-aspect','GPU','small','spatial-CompositorNodeFlip','spatial-CompositorNodeBlur','nine-distinct-keys','source-operation-limit','animated','cross-family-source-mutation','cross-family-group-mute','cross-family-reroute-relink','injected-reader-word-0x80000000','injected-reader-word-0x1','injected-reader-word-0x7fc12345']
export function assertPolicy(record){assert.equal(record.status,'WAVE_AXIS_SOURCE_POLICY_PASSED');assert.deepEqual(record.positive,policyPositive);assert.deepEqual(record.refusals,policyRefusals);for(const key of['nativeRenders','gpuInitializations','supportCredit'])assert.equal(record[key],0);assert.equal(record.injectedReaderWordControls,3);return record}
export function expectedFinalProvenance(q){return Object.entries(q.sourceHashes).filter(([path])=>/^packages\/blendlink\/blender\/[^/]+\.py$/.test(path)||/^packages\/blender-addon\/[^/]+\.(py|json)$/.test(path)).map(([source,sha256])=>({source,artifact:source.startsWith('packages/blendlink/blender/')?source.replace('/blender/','/dist/blender/'):source.replace('packages/blender-addon/','packages/blendlink/dist/addon/'),sha256})).sort((a,b)=>a.source.localeCompare(b.source))}
export function assertProgram(program,row){
 assert.equal(program.status,'extracted');assert.deepEqual(program.passes,[])
 const fields=program.ops.filter(op=>op.kind==='wave-texture'),count=row.route==='shared'?2:1
 assert.equal(fields.length,count);assert.deepEqual(program.ops.map(op=>op.kind),row.route==='shared'?['wave-texture','wave-texture','combine-vector']:row.route==='mixed-white-noise'?['wave-texture','white-noise-texture','combine-vector']:['wave-texture'])
 for(const op of fields){const p=op.properties
  assert.equal(op.source.nodeType,'ShaderNodeTexWave');assert.equal(op.source.output,row.route==='shared'||row.route==='mixed-white-noise'?'Fac':row.output);assert.equal(op.type,op.source.output==='Color'?'RGBA':'VALUE')
  assert.equal(p.wave_axis_model,'native-compositor-wave-axis-cpu-53-v1');assert.equal(p.wave_axis_profile,'darwin-arm64-53-wave-saw-tri-cpu-v1');assert.deepEqual(p.wave_axis_version,[5,3,0]);assert.equal(p.wave_axis_build,'02f0899d78e3');assert.equal(p.wave_axis_evaluator,'CPU-MF');assert.equal(p.evaluation_device,'CPU');assert.equal(p.single_value_device,'CPU');assert.equal(p.wave_axis_coordinate_model,'implicit-uniform-f32-v1');assert.equal(p.wave_axis_reference_model,'full-frame-context-zero-offset-v1');assert.deepEqual(p.wave_axis_export_extent,[row.width,row.height]);assert.equal(p.wave_axis_precision,'CPU_FLOAT32');assert.ok(['FULL','AUTO'].includes(p.wave_axis_requested_precision));assert.equal(p.wave_axis_mapping_model,'identity-v1');assert.equal(p.wave_axis_detail_model,'unlinked-unused-v1');assert.equal(p.wave_axis_direction,row.axis);assert.equal(p.wave_axis_wave_profile,row.profile);assert.deepEqual(p.wave_axis_parameter_words,row.parameterWords)
  assert.deepEqual(Object.keys(op.inputs).sort(),['Distortion','Phase Offset','Scale']);for(const[name,i]of[['Scale',0],['Phase Offset',1],['Distortion',2]]){const input=op.inputs[name];assert.equal(input.socketType,'VALUE');assert.deepEqual(Object.keys(input.value).sort(),['kind','type','value']);assert.equal(input.value.kind,'constant');assert.equal(input.value.type,'VALUE');assert.equal(word(input.value.value),row.parameterWords[i])}
  if(row.route==='group-reroute')assert.ok(op.source.path.length>0)
 }
 if(row.route==='mixed-white-noise'){const op=program.ops[1];assert.equal(op.source.nodeType,'ShaderNodeTexWhiteNoise');assert.equal(op.source.output,'Value');assert.equal(op.properties.noise_dimensions,2);assert.equal(op.properties.white_noise_model,'native-compositor-white-noise-uniform-cpu-53-v1');assert.deepEqual(op.inputs,{})}
 if(['shared','mixed-white-noise'].includes(row.route)){const op=program.ops.at(-1);assert.equal(op.source.nodeType,'ShaderNodeCombineXYZ');assert.equal(op.type,'VECTOR');for(const[name,index]of[['X',0],['Y',1],['Z',0]])assert.deepEqual(op.inputs[name].value,{kind:'ref',type:'VALUE',node:program.ops[index].id})}
 return program
}
export function assertQualification(q){
 assert.equal(q.schemaVersion,1);assert.equal(q.status,browserProofContract.nativeStatus);assert.deepEqual(q.version,[5,3,0]);assert.equal(q.build,'02f0899d78e3');assert.equal(q.device,'CPU');assert.equal(q.sceneEngine,'CYCLES');assert.equal(q.resultPrecision,'CPU_FLOAT32');assert.equal(q.wordDifferences,0);assert.equal(q.nativeRenders,cases.length+extents.length+1);assert.equal(q.finalCredit,0);assert.equal(q.browserCredit,0)
 assert.ok(q.sourceHashes&&typeof q.sourceHashes==='object');for(const pin of Object.values(q.sourceHashes))sha(pin)
 assert.deepEqual(q.cases.map(r=>r.case),cases.map(r=>r.case));assert.equal(new Set(q.cases.map(r=>r.case)).size,cases.length)
 for(let i=0;i<cases.length;i++){const row=q.cases[i];for(const[key,expected]of Object.entries(cases[i]))assert.deepEqual(row[key],expected);assert.equal(row.sourceOwnershipPreserved,true);for(const kind of['program','pixel','input']){assert.equal(row[kind+'File'],row.case+({program:'.program.json',pixel:'.rgba32f',input:'.input32f'})[kind]);sha(row[kind+'Sha256'])}assert.equal(!!row.sourceFile,row.saved);if(row.saved){assert.equal(row.sourceFile,row.case+'.blend');sha(row.sourceSha256)}}
 assert.deepEqual(q.coordinateControls.map(r=>[r.case,r.width,r.height]),extents.map(([w,h])=>[w+'x'+h+'-raw-uniform',w,h]));for(const row of q.coordinateControls){assert.equal(row.pixelFile,row.case+'.rgba32f');sha(row.pixelSha256)}
 const domain=q.fieldDomainControl;assert.equal(domain.case,'13x9-native-wave-image-info-field-domain');assert.equal(domain.width,13);assert.equal(domain.height,9);assert.equal(domain.pixelFile,domain.case+'.rgba32f');sha(domain.pixelSha256);assert.deepEqual(domain.dimensions,[13,9]);assert.equal(domain.sourceExtractionStatus,'unsupported')
 return q
}
export function assertFinal(record,q,{built,nativeSha256}){
 assert.equal(record.status,browserProofContract.finalStatus);assert.equal(built,true);assert.equal(record.exporter,'built');assert.equal(record.nativeQualificationSha256,nativeSha256);assert.equal(record.sourcePreserved,true);assert.deepEqual(record.rows.map(r=>r.case),expectedFinalCases().map(r=>r.case));assert.deepEqual(record.provenance,expectedFinalProvenance(q));assert.equal(new Set(record.rows.map(r=>r.moduleExport)).size,expectedFinalCases().length)
 for(const row of record.rows){const original=q.cases.find(r=>r.case===row.case);assert.equal(row.sourceFile,original.sourceFile);assert.equal(row.sourceSha256,original.sourceSha256);for(const key of['manifestSha256','glbSha256','presentationSha256','moduleSha256'])sha(row[key]);assert.match(row.moduleExport,/^[A-Za-z_$][A-Za-z0-9_$]*$/);assert.ok(row.modulePath);assert.ok(row.presentationPointer?.url);assert.ok(Number.isInteger(row.presentationPointer.bytes)&&row.presentationPointer.bytes>0)}
 return record
}
export function assertBrowserRows(report,q,f,{profile,final}){
 assert.equal(report.status,browserProofContract.browserStatus);assert.equal(report.built,true);assert.equal(report.final,final);assert.equal(report.profile,profile);assert.equal(report.sourceDevice,'CPU');assert.deepEqual(report.rows.map(r=>r.backend),['webgpu','webgl2']);assert.equal(report.missingAdapterControl.refused,true);assert.match(report.missingAdapterControl.error,/actual WebGPU adapter/)
 for(const api of report.rows){
  assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
  assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.uncaptured,[])
  assert.equal(api.savedDispose?.physicalDestroys,1);assert.equal(api.savedDispose.externalDevice,api.backend==='webgpu');assert.equal(api.savedDispose.remainingOwnedTextures,0);assert.equal(api.savedDispose.idempotentDisposal,true);assert.equal(api.savedDispose.ownerRoute,'buildSourceCompositor')
  assert.match(api.savedDispose.error,/Wave axis: (renderer.*(?:epoch|lost)|actual available renderer\/device\/context required)/)
  assert.deepEqual(api.savedDispose.bindingControls.map(row=>row.kind),['value','reference','uv'])
  for(const control of api.savedDispose.bindingControls){assert.match(control.error,/Wave axis.*binding/);assert.equal(control.borrowedUploads,0);assert.equal(control.borrowedDisposals,0)}
  assert.deepEqual(api.negatives.map(r=>r.kind),['wave-source-profile','field-invalid-viewport','field-invalid-resize','field-constant-terminal-guard','field-owned-schema','field-owned-version'])
  for(const row of api.negatives){assert.equal(typeof row.error,'string');assert.match(row.error,/Wave axis/)}
  assert.deepEqual(api.rows.map(r=>r.case),(final?f.rows:q.cases).map(r=>r.case))
  for(const row of api.rows){const native=q.cases.find(r=>r.case===row.case);for(const k of['width','height','pixelRatio','route'])assert.equal(row[k],native[k]);assert.equal(row.exactWordMismatches,0);assert.equal(row.contractViolations,0);assert.equal(row.comparedWords,native.width*native.height*4);assert.equal(row.exactControlWords,row.comparedWords);assert.equal(row.portOwnedTextures,expectedTables(native));assert.equal(row.remainingRenderTargets,0);assert.equal(row.resizeFrames,resizeCount(native));assert.deepEqual(row.resizeResults.map(r=>r.case),native.resizeCases)
   assert.equal(row.rowTableBindings,expectedTables(native));assert.equal(row.maximumRowBytes,expectedMaximumRowBytes(native));assert.equal(row.unchangedExtentUploads,0);assert.equal(row.additionalPortPasses,0)
   assert.equal(row.passMeasurement,'owned-row-render-target-allocations');assert.ok(Number.isInteger(row.observedFrameDrawCalls)&&row.observedFrameDrawCalls>0)
   for(const frame of row.resizeResults){const target=q.cases.find(r=>r.case===frame.case);assert.ok(target);for(const k of['width','height','pixelRatio'])assert.equal(frame[k],target[k]);assert.equal(frame.comparedWords,target.width*target.height*4);assert.equal(frame.exactWordMismatches,0);assert.equal(frame.contractViolations,0);assert.equal(frame.rowUploads,expectedTables(native));assert.equal(frame.repeatUploads,0)}
   assert.ok(row.animationFrames.every(id=>Number.isSafeInteger(id)&&id>0));for(let i=1;i<row.animationFrames.length;i++)assert.ok(row.animationFrames[i]>row.animationFrames[i-1]);assert.ok(row.animationFrames.length>=2)
   if(final){
    assert.equal(row.cancelledPreparationRejected,true);assert.equal(row.preparedCancellationRestored,true);assert.equal(row.installer,'startThreeCompiledScenePreparation.commit')
    assert.equal(row.installationCycles.length,3)
    for(const measured of[row,...row.installationCycles])for(const[phase,keys]of[['preparation',['rowAllocations','rowUploads']],['commit',['rowAllocations','rowUploads']],['live',['rowAllocations','initialRowUploads']]]){
     assert.deepEqual(Object.keys(measured[phase]).sort(),[...keys].sort())
     for(const key of keys)assert.ok(Number.isSafeInteger(measured[phase][key])&&measured[phase][key]>=0,'Invalid measured '+phase+' '+key)
    }
    for(const phase of['preparation','commit','live'])assert.deepEqual(row[phase],row.installationCycles[0][phase],'Initial installation metrics must remain observed, not overwritten by reapply')
    assert.equal(row.ownershipScope,'caller-owned-mesh-material-geometry-and-render-callbacks');assert.ok(Number.isSafeInteger(row.hostBeforeCalls)&&row.hostBeforeCalls>0);assert.ok(Number.isSafeInteger(row.hostAfterCalls)&&row.hostAfterCalls>0);assert.equal(row.hostIdentityRestored,true);assert.equal(row.rendererCallbacksRestored,true)
    assert.equal(row.pinRejected,true);assert.ok(row.meshCount>0);assert.equal(row.pipeline,'blender-compositor');assert.equal(row.sourceMaterialsPreserved,true);assert.equal(row.lifecycleCycles,3);assert.equal(row.baselineCacheRestored,true);assert.ok(row.baselineSceneDrawCalls>0);assert.ok(row.baselineCache.length<=1);assert.equal(row.remainingTextures,row.baselineCache.length);for(const t of row.baselineCache){assert.equal(t.name,'DFG_LUT');assert.equal(t.width,16);assert.equal(t.height,16)}
   }else assert.equal(row.remainingTextures,0)
  }
 }
 return report
}
