/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {precision,word} from './numeric-contract.mjs'
export {precision,word,uniformAxisWords,compareNoise,assertRedFac} from './numeric-contract.mjs'

export const browserProofContract=Object.freeze({schemaVersion:1,family:'compositor-noise-default-field',nativeStatus:'CAPTURED_COMPOSITOR_NOISE_DEFAULT_FIELD',finalStatus:'PUBLISHED_COMPOSITOR_NOISE_DEFAULT_FIELD',browserStatus:'PASSED_NOISE_DEFAULT_FIELD_BUILT_PROOF'})
export const cases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'))
export const extents=Object.freeze([[13,9],[9,13],[16,8],[8,8],[5,5],[127,65],[65,127],[8192,4],[4,8192],[257,251],[509,503]])
export const expectedCases=()=>structuredClone(cases)
export const expectedFinalCases=()=>structuredClone(cases.filter(row=>row.saved))
export const resizeCount=row=>row.resizeCases.length
export const fixtureNames=Object.freeze(['browser.js','index.html','numeric-contract.mjs'])
export const model='native-compositor-noise2d-default-fbm-cpu-53-v1'
export const profile='darwin-arm64-53-noise2d-default-fbm-cpu-v1'
export const kernel='staged-bli-fade-perlin-fbm-noise2d-v3'
export const defaults=Object.freeze({Scale:5,Detail:2,Roughness:.5,Lacunarity:2,Distortion:0})
const pin=value=>assert.match(value,/^[a-f0-9]{64}$/)
const exactKeys=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort())
export function assertCasePlan(plan){
 assert.equal(plan.length,26);assert.equal(plan.filter(row=>row.saved).length,8)
 assert.equal(new Set(plan.map(row=>row.case)).size,26)
 const direct=plan.filter(row=>row.route==='direct')
 assert.deepEqual(direct.map(row=>[row.width,row.height,row.output]),extents.flatMap(([w,h])=>['Fac','Color'].map(output=>[w,h,output])))
 assert.deepEqual(plan.slice(22).map(row=>row.route),['group-reroute','shared-fac-color','two-color','six-fac'])
 for(const row of plan){
  assert.match(row.case,/^[A-Za-z0-9-]+$/);assert.ok(['Fac','Color'].includes(row.output));assert.ok([1,2].includes(row.pixelRatio))
  assert.ok(row.width>=4&&row.height>=4&&row.width<=8192&&row.height<=8192)
  assert.equal(row.noiseOperations,row.route==='six-fac'?6:['shared-fac-color','two-color'].includes(row.route)?2:1)
  assert.equal(row.perlinCalls,row.route==='six-fac'||row.route==='two-color'?18:row.route==='shared-fac-color'?12:row.output==='Fac'?3:9)
  assert.ok(Array.isArray(row.resizeCases));assert.equal(new Set(row.resizeCases).size,row.resizeCases.length)
  for(const label of row.resizeCases){const target=plan.find(r=>r.case===label);assert.ok(target);assert.equal(target.route,'direct');assert.equal(target.output,row.output)}
  assert.equal(row.resizeCases.length,row.saved&&row.route==='direct'?11:0)
  if(row.resizeCases.length)assert.equal(row.resizeCases.at(-1),row.case)
 }
 assert.equal(plan.reduce((n,r)=>n+r.resizeCases.length,0),44)
 return plan
}
assertCasePlan(cases)
export function expectedFinalProvenance(q){
 return Object.entries(q.sourceHashes).filter(([path])=>/^packages\/blendlink\/blender\/[^/]+\.py$/.test(path)||/^packages\/blender-addon\/[^/]+\.(py|json)$/.test(path))
  .map(([source,sha256])=>({source,artifact:source.startsWith('packages/blendlink/blender/')?source.replace('/blender/','/dist/blender/'):source.replace('packages/blender-addon/','packages/blendlink/dist/addon/'),sha256}))
  .sort((a,b)=>a.source<b.source?-1:a.source>b.source?1:0)
}
export const policyPositive=Object.freeze(['AUTO-Fac','AUTO-Color','FULL-Fac','FULL-Color','implicit-ignores-stored-vector','native-group-reroute-field','late-unchanged'])
export const policyRefusals=Object.freeze([
 ...['Vector',...Object.keys(defaults)].flatMap(name=>['linked-'+name,'muted-link-'+name]),
 ...Object.keys(defaults).map(name=>'changed-'+name),
 'mode-noise_dimensions-3D','mode-noise_dimensions-4D','mode-noise_type-MULTIFRACTAL','mode-normalize-False','mode-mute-True',
 'context-compositor_device','context-use_border','context-use_crop_to_border','context-pixel_aspect_y','context-resolution_percentage','context-resolution_y',
 'animated',
 ...['multiply-1024','exposure-plus10','gamma-half','map-range-amplification','swapped-channels','mean-quarter'].map(label=>'composition-'+label),
 'late-group-mute','late-reroute-relink','late-root','late-disabled','late-frame','late-scalar-default',
])
assert.equal(policyRefusals.length,41)
export function assertPolicy(value){
 assert.equal(value.status,'NOISE_DEFAULT_FIELD_SOURCE_POLICY_PASSED')
 assert.deepEqual(value.positive,policyPositive);assert.deepEqual(value.refusals,policyRefusals)
 for(const key of ['renders','gpuInitializationCalls','portCredit'])assert.equal(value[key],0)
 assert.equal(value.guardControls.renderRefused,true);assert.equal(value.guardControls.gpuInitializationRefused,true)
 return value
}
export function assertGroupTrace(trace,program){
 exactKeys(trace,['rootTree','groupTree','instance','noise','reroute','links'])
 for(const name of ['rootTree','groupTree','instance','noise','reroute'])assert.ok(typeof trace[name]==='string'&&trace[name].length>0)
 assert.notEqual(trace.rootTree,trace.groupTree)
 assert.equal(trace.links.length,3)
 const endpoint=(tree,node,nodeType,socket)=>({tree,node,nodeType,socket})
 const [first,middle,last]=trace.links
 for(const link of trace.links){exactKeys(link,['from','to']);for(const side of ['from','to'])exactKeys(link[side],['tree','node','nodeType','socket'])}
 assert.deepEqual(first,{from:endpoint(trace.groupTree,trace.noise,'ShaderNodeTexNoise','Color'),to:endpoint(trace.groupTree,trace.reroute,'NodeReroute','Input')})
 assert.deepEqual(middle.from,endpoint(trace.groupTree,trace.reroute,'NodeReroute','Output'))
 assert.equal(middle.to.tree,trace.groupTree);assert.equal(middle.to.nodeType,'NodeGroupOutput');assert.equal(middle.to.socket,'Socket_0');assert.ok(middle.to.node.length>0)
 assert.deepEqual(last.from,endpoint(trace.rootTree,trace.instance,'CompositorNodeGroup','Socket_0'))
 assert.equal(last.to.tree,trace.rootTree);assert.equal(last.to.nodeType,'NodeGroupOutput');assert.equal(last.to.socket,'Socket_0');assert.ok(last.to.node.length>0)
 if(program){
  const op=program.ops.find(op=>op.kind==='noise-texture')
  assert.deepEqual(op.source.path,[trace.rootTree,trace.instance]);assert.equal(op.source.node,trace.noise)
  assert.ok(op.properties.noise_fixed_sources.some(member=>member.tree===trace.groupTree&&member.node===trace.noise&&member.nodeType==='ShaderNodeTexNoise'))
 }
 return trace
}
export function assertProgram(program,row){
 assert.equal(program.status,'extracted');assert.deepEqual(program.passes,[])
 const noise=program.ops.filter(op=>op.kind==='noise-texture')
 assert.equal(noise.length,row.noiseOperations)
 let cost=0
 for(const op of noise){
  const p=op.properties,source=op.source
  exactKeys(source,['path','node','nodeType','output']);assert.equal(source.nodeType,'ShaderNodeTexNoise');assert.ok(source.path.every(v=>typeof v==='string'));assert.equal(typeof source.node,'string')
  assert.ok(['Fac','Color'].includes(source.output));assert.equal(op.type,source.output==='Fac'?'VALUE':'RGBA');cost+=source.output==='Fac'?3:9
  assert.equal(p.noise_model,model);assert.equal(p.noise_profile,profile);assert.equal(p.noise_kernel,kernel)
  assert.deepEqual(p.noise_version,[5,3,0]);assert.equal(p.noise_build,'02f0899d78e3');assert.equal(p.noise_evaluator,'CPU-MF')
  assert.equal(p.evaluation_device,'CPU');assert.equal(p.single_value_device,'CPU');assert.equal(p.noise_dimensions,2);assert.equal(p.noise_type,'FBM');assert.equal(p.noise_normalize,true)
  assert.equal(p.noise_coordinate_model,'exact-uniform-r32f-axes-v1');assert.equal(p.noise_reference_model,'full-frame-context-zero-offset-v1')
  assert.deepEqual(p.noise_export_extent,[row.width,row.height]);assert.equal(p.noise_precision,'CPU_FLOAT32');assert.ok(['AUTO','FULL'].includes(p.noise_requested_precision))
  assert.ok(Array.isArray(p.noise_fixed_sources)&&p.noise_fixed_sources.length>0&&p.noise_fixed_sources.length<=64)
  for(const member of p.noise_fixed_sources){exactKeys(member,['tree','node','nodeType']);for(const key of ['tree','node','nodeType'])assert.equal(typeof member[key],'string')}
  exactKeys(op.inputs,Object.keys(defaults))
  for(const [name,value]of Object.entries(defaults)){
   const input=op.inputs[name];exactKeys(input,['name','socketType','value']);assert.equal(input.name,name);assert.equal(input.socketType,'VALUE')
   exactKeys(input.value,['kind','type','value']);assert.equal(input.value.kind,'constant');assert.equal(input.value.type,'VALUE');assert.equal(typeof input.value.value,'number');assert.ok(Object.is(input.value.value,value))
  }
 }
 assert.equal(cost,row.perlinCalls);assert.ok(cost<=18)
 assert.equal(new Set(program.ops.map(op=>op.id)).size,program.ops.length)
 assert.ok(program.ops.every(op=>['noise-texture','combine-color','separate-color','math'].includes(op.kind)))
 const byId=new Map(program.ops.map(op=>[op.id,op])),used=new Set(),active=new Set()
 const visit=value=>{
  if(value.kind==='constant')return
  if(value===program.output&&row.route==='direct'&&row.output==='Fac'){
   exactKeys(value,['kind','fromType','type','input']);assert.equal(value.kind,'convert');assert.equal(value.fromType,'VALUE');assert.equal(value.type,'RGBA');visit(value.input);return
  }
  exactKeys(value,['kind','node','type']);assert.equal(value.kind,'ref')
  const op=byId.get(value.node);assert.ok(op,'Missing graph dependency');assert.equal(value.type,op.type)
  assert.ok(!active.has(op.id),'Cyclic source graph')
  if(used.has(op.id))return
  active.add(op.id);for(const input of Object.values(op.inputs))visit(input.value);active.delete(op.id);used.add(op.id)
 }
 visit(program.output);assert.equal(used.size,program.ops.length,'Every emitted operation must contribute to the declared output')
 const linked=(op,name,type)=>{
  const input=op.inputs[name];assert.ok(input);assert.equal(input.socketType,type)
  exactKeys(input.value,['kind','node','type']);assert.equal(input.value.kind,'ref');assert.equal(input.value.type,type)
  const source=byId.get(input.value.node);assert.ok(source);assert.equal(source.type,type);return source
 }
 const constant=(op,name,value)=>{
  const input=op.inputs[name];assert.ok(input);assert.equal(input.socketType,'VALUE')
  exactKeys(input.value,['kind','type','value']);assert.equal(input.value.kind,'constant');assert.equal(input.value.type,'VALUE');assert.ok(Object.is(input.value.value,value))
 }
 const samePhysical=(a,b)=>a.source.node===b.source.node&&JSON.stringify(a.source.path)===JSON.stringify(b.source.path)
 if(row.route==='direct'||row.route==='group-reroute'){
  assert.equal(program.ops.length,1);assert.equal(noise[0].source.output,row.output)
  const selected={kind:'ref',node:noise[0].id,type:noise[0].type}
  assert.deepEqual(program.output,row.route==='direct'&&row.output==='Fac'?{kind:'convert',fromType:'VALUE',type:'RGBA',input:selected}:selected)
  if(row.route==='group-reroute'){
   const source=noise[0].source,members=noise[0].properties.noise_fixed_sources
   assert.equal(source.path.length,2,'This case must traverse an actual group instance, beyond its root tree')
   assert.ok(members.some(member=>member.nodeType==='CompositorNodeGroup'&&member.node===source.path[1]&&member.tree===source.path[0]),'Missing actual group-instance ancestry')
   assert.ok(members.some(member=>member.nodeType==='ShaderNodeTexNoise'&&member.node===source.node&&member.tree!==source.path[0]),'Missing actual child Noise ownership')
   // The output-side reroute is transparent in IR. Its actual native builder
   // and saved source are pinned; scalar-input provenance cannot attest it.
  }
 }else{
  assert.equal(program.output.type,'RGBA');assert.equal(program.output.kind,'ref');assert.equal(program.output.node,program.ops.at(-1).id)
  const combined=program.ops.at(-1)
  assert.equal(combined.kind,'combine-color');assert.equal(combined.source.nodeType,'CompositorNodeCombineColor');assert.equal(combined.properties.mode,'RGB')
  exactKeys(combined.inputs,['Red','Green','Blue','Alpha']);constant(combined,'Alpha',1)
  const separate=(name,channel)=>{
   const op=linked(combined,name,'VALUE');assert.equal(op.kind,'separate-color');assert.equal(op.source.nodeType,'CompositorNodeSeparateColor')
   assert.equal(op.source.output,channel);assert.equal(op.properties.mode,'RGB');exactKeys(op.inputs,['Image'])
   const source=linked(op,'Image','RGBA');assert.equal(source.kind,'noise-texture');assert.equal(source.source.output,'Color');return source
  }
  if(row.route==='shared-fac-color'){
   assert.equal(program.ops.length,5);assert.deepEqual(noise.map(op=>op.source.output).sort(),['Color','Fac'])
   const fac=linked(combined,'Red','VALUE');assert.equal(fac.kind,'noise-texture');assert.equal(fac.source.output,'Fac')
   const green=separate('Green','Green'),blue=separate('Blue','Blue');assert.equal(green.id,blue.id);assert.ok(samePhysical(fac,green),'Fac and Color must come from the same actual Noise node')
  }
  if(row.route==='two-color'){
   assert.equal(program.ops.length,6);assert.ok(noise.every(op=>op.source.output==='Color'))
   const red=separate('Red','Red'),green=separate('Green','Green'),blue=separate('Blue','Blue')
   assert.equal(green.id,blue.id);assert.notEqual(red.id,green.id);assert.ok(!samePhysical(red,green),'This case requires two actual Noise instances')
  }
  if(row.route==='six-fac'){
   assert.equal(program.ops.length,13);assert.ok(noise.every(op=>op.source.output==='Fac'));const leaves=[]
   for(const name of ['Red','Green','Blue']){
    const half=linked(combined,name,'VALUE');assert.equal(half.kind,'math');assert.equal(half.source.nodeType,'ShaderNodeMath');assert.equal(half.properties.operation,'MULTIPLY');assert.equal(half.properties.use_clamp,false);exactKeys(half.inputs,['Value','Value_001']);constant(half,'Value_001',.5)
    const sum=linked(half,'Value','VALUE');assert.equal(sum.kind,'math');assert.equal(sum.source.nodeType,'ShaderNodeMath');assert.equal(sum.properties.operation,'ADD');assert.equal(sum.properties.use_clamp,false);exactKeys(sum.inputs,['Value','Value_001'])
    for(const input of ['Value','Value_001']){const leaf=linked(sum,input,'VALUE');assert.equal(leaf.kind,'noise-texture');assert.equal(leaf.source.output,'Fac');leaves.push(leaf)}
   }
   assert.equal(new Set(leaves.map(op=>op.id)).size,6);assert.equal(new Set(leaves.map(op=>JSON.stringify([op.source.path,op.source.node]))).size,6)
  }
 }
 return program
}
export function assertQualification(q){
 assert.equal(q.schemaVersion,1);assert.equal(q.status,browserProofContract.nativeStatus)
 assert.deepEqual(q.version,[5,3,0]);assert.equal(q.build,'02f0899d78e3');assert.equal(q.device,'CPU');assert.equal(q.sceneEngine,'CYCLES');assert.equal(q.resultPrecision,'CPU_FLOAT32')
 assert.equal(q.nativeRenders,41);assert.equal(q.wordDifferences,0);assert.equal(q.finalCredit,0);assert.equal(q.browserCredit,0)
 assert.equal(q.pythonGpuInitializationCalls,0)
 assert.ok(q.sourceHashes&&typeof q.sourceHashes==='object'&&!Array.isArray(q.sourceHashes));assert.ok(Object.keys(q.sourceHashes).length>0);for(const sha of Object.values(q.sourceHashes))pin(sha)
 assert.deepEqual(q.cases.map(r=>r.case),cases.map(r=>r.case))
 for(let i=0;i<cases.length;i++){
  const row=q.cases[i];for(const[key,value]of Object.entries(cases[i]))assert.deepEqual(row[key],value)
  assert.equal(row.sourceOwnershipPreserved,true)
  if(row.route==='group-reroute')assertGroupTrace(row.groupTrace);else assert.equal(row.groupTrace,undefined)
  for(const kind of ['program','pixel','input']){assert.equal(row[kind+'File'],row.case+({program:'.program.json',pixel:'.rgba32f',input:'.input32f'})[kind]);pin(row[kind+'Sha256'])}
  assert.equal(!!row.sourceFile,row.saved);if(row.saved){assert.equal(row.sourceFile,row.case+'.blend');pin(row.sourceSha256)}
 }
 assert.deepEqual(q.coordinateControls.map(r=>[r.case,r.width,r.height]),extents.map(([w,h])=>[w+'x'+h+'-raw-uniform',w,h]))
 for(const row of q.coordinateControls){assert.equal(row.pixelFile,row.case+'.rgba32f');pin(row.pixelSha256)}
 assert.deepEqual(q.fieldDomainControls.map(r=>[r.case,r.width,r.height]),[[13,9],[5,5]].map(([w,h])=>[w+'x'+h+'-native-image-info-field-domain',w,h]))
 for(const row of q.fieldDomainControls){assert.deepEqual(row.dimensions,[row.width,row.height]);assert.equal(row.sourceExtractionStatus,'unsupported');assert.equal(row.pixelFile,row.case+'.rgba32f');pin(row.pixelSha256)}
 assert.deepEqual(q.endpointControls.map(r=>[r.case,r.output,r.width,r.height]),['Fac','Color'].map(output=>['13x9-scale-zero-'+output.toLowerCase(),output,13,9]))
 for(const row of q.endpointControls){assert.equal(row.pixelFile,row.case+'.rgba32f');pin(row.pixelSha256)}
 return q
}
export function assertFinal(record,q,{built,nativeSha256}){
 assert.equal(record.status,browserProofContract.finalStatus);assert.equal(built,true);assert.equal(record.exporter,'built');assert.equal(record.sourcePreserved,true);assert.equal(record.nativeQualificationSha256,nativeSha256)
 assert.deepEqual(record.provenance,expectedFinalProvenance(q));assert.deepEqual(record.rows.map(r=>r.case),expectedFinalCases().map(r=>r.case));assert.equal(new Set(record.rows.map(r=>r.moduleExport)).size,8)
 for(const row of record.rows){const original=q.cases.find(r=>r.case===row.case);assert.equal(row.sourceFile,original.sourceFile);assert.equal(row.sourceSha256,original.sourceSha256)
  for(const key of ['manifestSha256','glbSha256','presentationSha256','moduleSha256'])pin(row[key]);assert.match(row.moduleExport,/^[A-Za-z_$][A-Za-z0-9_$]*$/);assert.ok(row.modulePath);assert.ok(row.presentationPointer?.url);assert.ok(Number.isInteger(row.presentationPointer.bytes)&&row.presentationPointer.bytes>0)
 }
 return record
}
export function assertNumericMetrics(row,native){
 assert.equal(row.comparedWords,native.width*native.height*4)
 assert.ok(Number.isSafeInteger(row.wordDifferences)&&row.wordDifferences>=0&&row.wordDifferences<=row.comparedWords)
 for(const key of ['contractViolations','alphaDifferences','latticeDifferences','facBroadcastDifferences'])assert.equal(row[key],0,key)
 assert.ok(Number.isSafeInteger(row.maxUlps)&&row.maxUlps>=0&&row.maxUlps<=precision.ulpsMax)
 assert.ok(Number.isFinite(row.maxAbsoluteError)&&row.maxAbsoluteError>=0&&row.maxAbsoluteError<=precision.absoluteMax)
 assert.ok(Number.isSafeInteger(row.latticeControls)&&row.latticeControls>=0)
 assert.equal(typeof row.rowFlip,'boolean');assert.equal(typeof row.actualFile,'string');pin(row.actualSha256)
}
export function assertBrowserRows(report,q,finalRecord,{profile:requestedProfile,final}){
 assert.equal(report.status,browserProofContract.browserStatus);assert.equal(report.built,true);assert.equal(report.final,final)
 assert.equal(report.profile,requestedProfile);assert.equal(report.sourceDevice,'CPU')
 assert.deepEqual(report.rows.map(row=>row.backend),['webgpu','webgl2'])
 assert.equal(report.missingAdapterControl.refused,true);assert.match(report.missingAdapterControl.error,/actual WebGPU adapter/i)
 const wanted=final?finalRecord.rows:q.cases
 for(const api of report.rows){
  assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2')
  if(requestedProfile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
  for(const key of ['errors','pageErrors','uncaptured'])assert.deepEqual(api[key],[])
  assert.deepEqual(api.coordinateControls.map(row=>[row.case,row.width,row.height]),extents.map(([w,h])=>[w+'x'+h+'-raw-uniform',w,h]))
  for(const control of api.coordinateControls){assert.equal(control.comparedWords,control.width*control.height*4);assert.equal(control.exactWordMismatches,0);assert.equal(typeof control.rowFlip,'boolean');assert.equal(typeof control.actualFile,'string');pin(control.actualSha256)}
  assert.equal(api.savedDispose?.physicalDestroys,1);assert.equal(api.savedDispose.externalDevice,api.backend==='webgpu')
  assert.equal(api.savedDispose.remainingOwnedTextures,0);assert.equal(api.savedDispose.idempotentDisposal,true);assert.equal(api.savedDispose.ownerRoute,'buildSourceCompositor')
  assert.match(api.savedDispose.error,/White Noise exact axes: (renderer.*(?:epoch|lost)|actual available renderer\/device\/context required)/)
  assert.deepEqual(api.savedDispose.bindingControls.map(row=>row.kind),['value','reference','uv'])
  for(const control of api.savedDispose.bindingControls){assert.match(control.error,/binding/);assert.equal(control.borrowedUploads,0);assert.equal(control.borrowedDisposals,0)}
  assert.deepEqual(api.negatives.map(row=>row.kind),['noise-source-profile','field-invalid-viewport','field-invalid-resize','field-disconnected-output-admission','field-owned-schema','field-owned-version'])
  for(const negative of api.negatives){assert.equal(typeof negative.error,'string');assert.match(negative.error,/Noise|White Noise exact axes/)}
  assert.deepEqual(api.rows.map(row=>row.case),wanted.map(row=>row.case))
  for(const row of api.rows){
   const native=q.cases.find(entry=>entry.case===row.case)
   for(const key of ['width','height','pixelRatio','route'])assert.equal(row[key],native[key])
   assertNumericMetrics(row,native)
   assert.equal(row.portOwnedTextures,1);assert.equal(row.axisTableBindings,1)
   assert.ok(Number.isInteger(row.maximumAxisBytes)&&row.maximumAxisBytes>0&&row.maximumAxisBytes<=65536)
   assert.equal(row.remainingRenderTargets,0);assert.equal(row.unchangedExtentUploads,0);assert.equal(row.additionalPortPasses,0)
   assert.equal(row.passMeasurement,'owned-axis-render-target-allocations');assert.ok(Number.isSafeInteger(row.observedFrameDrawCalls)&&row.observedFrameDrawCalls>0)
   assert.equal(row.resizeFrames,resizeCount(native));assert.deepEqual(row.resizeResults.map(frame=>frame.case),native.resizeCases)
   for(const frame of row.resizeResults){
    const target=q.cases.find(entry=>entry.case===frame.case)
    for(const key of ['width','height','pixelRatio'])assert.equal(frame[key],target[key])
    assertNumericMetrics(frame,target);assert.equal(frame.axisUploads,1);assert.equal(frame.repeatUploads,0)
   }
   assert.ok(Array.isArray(row.animationFrames)&&row.animationFrames.length>=2)
   for(let i=0;i<row.animationFrames.length;i++){assert.ok(Number.isSafeInteger(row.animationFrames[i])&&row.animationFrames[i]>0);if(i)assert.ok(row.animationFrames[i]>row.animationFrames[i-1])}
   if(final){
    assert.equal(row.installer,'startThreeCompiledScenePreparation.commit');assert.equal(row.installationCycles.length,3)
    assert.equal(row.cancelledPreparationRejected,true);assert.equal(row.preparedCancellationRestored,true)
    for(const measured of [row,...row.installationCycles])for(const [phase,keys]of [['preparation',['axisAllocations','axisUploads']],['commit',['axisAllocations','axisUploads']],['live',['axisAllocations','initialAxisUploads']]]){
     exactKeys(measured[phase],keys);for(const key of keys)assert.ok(Number.isSafeInteger(measured[phase][key])&&measured[phase][key]>=0)
    }
    for(const phase of ['preparation','commit','live'])assert.deepEqual(row[phase],row.installationCycles[0][phase])
    assert.equal(row.ownershipScope,'caller-owned-mesh-material-geometry-and-render-callbacks');assert.ok(row.hostBeforeCalls>0&&row.hostAfterCalls>0)
    assert.equal(row.hostIdentityRestored,true);assert.equal(row.rendererCallbacksRestored,true);assert.equal(row.pinRejected,true)
    assert.ok(Number.isSafeInteger(row.meshCount)&&row.meshCount>0);assert.equal(row.pipeline,'blender-compositor');assert.equal(row.sourceMaterialsPreserved,true)
    assert.equal(row.lifecycleCycles,3);assert.equal(row.baselineCacheRestored,true);assert.ok(row.baselineSceneDrawCalls>0)
    assert.ok(Array.isArray(row.baselineCache)&&row.baselineCache.length<=1);assert.equal(row.remainingTextures,row.baselineCache.length)
    for(const texture of row.baselineCache){assert.equal(texture.name,'DFG_LUT');assert.equal(texture.width,16);assert.equal(texture.height,16)}
   }else assert.equal(row.remainingTextures,0)
  }
 }
 return report
}
