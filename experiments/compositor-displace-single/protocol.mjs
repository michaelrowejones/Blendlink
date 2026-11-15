/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {statuses,proofModel,exactMetric,displayMetric} from './browser-contract.mjs'
export {statuses,exactMetric,displayMetric}
export const cases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'))
export const browserProofContract=Object.freeze({schemaVersion:1,family:'compositor-displace-single',nativeStatus:statuses.native,finalStatus:statuses.final,browserStatus:statuses.browser})
export const expectedFrames=(profile,backend)=>cases.flatMap(row=>row.frames.map(frame=>({id:[profile,backend,row.case,frame.width+'x'+frame.height+'@'+frame.pixelRatio].join('--'),case:row.case,...frame})))
export const nativeFrames=()=>['metal','software'].flatMap(profile=>['webgpu','webgl2'].flatMap(backend=>expectedFrames(profile,backend)))
export const archiveDirectory=(out,stage)=>{assert.ok(['sources','references'].includes(stage));return join(out,stage+'-archive')}
const keys=(value,names)=>assert.deepEqual(Object.keys(value).sort(),[...names].sort())
const pin=value=>assert.match(value,/^[a-f0-9]{64}$/)
export function assertProgram(program,definition){
 assert.equal(program.status,'extracted');assert.ok(Array.isArray(program.ops));assert.equal(program.ops.length,definition.layout==='rgb'||definition.source==='render-layer'?2:1)
 assert.equal(new Set(program.ops.map(op=>op.id)).size,program.ops.length)
 const op=program.ops.find(op=>op.source.nodeType==='CompositorNodeDisplace');assert.ok(op);assert.equal(op.kind,'translate');assert.equal(op.type,'RGBA');assert.equal(op.source.output,'Image');keys(op.inputs,['Image'])
 assert.equal(op.properties.displace_model,proofModel);assert.equal(op.properties.displace_profile,'darwin-arm64-53-displace-single-cpu-v1');assert.deepEqual(op.properties.displace_words,definition.displacementWords);assert.equal(op.properties.displace_source_kind,definition.source);assert.equal(op.properties.image_interpolation,definition.interpolation);assert.equal(op.properties.image_sampling_model,'modern-cpu-v1');assert.equal(op.properties.displace_requested_precision,'FULL');assert.equal(op.properties.evaluation_device,'CPU');assert.equal(op.properties.displace_max_pixels,4194304)
 const p=op.properties;assert.deepEqual(p.displace_version,[5,3,0]);assert.equal(p.displace_build,'02f0899d78e3');assert.equal(p.single_value_device,'CPU');assert.equal(p.image_domain_model,'native-translation-v2');assert.deepEqual(p.displace_export_extent,[13,9]);assert.deepEqual(p.image_translation,definition.displacementWords.map(word=>new Float32Array(new Uint32Array([word]).buffer)[0]));keys(op.inputs.Image,['name','socketType','value']);assert.equal(op.inputs.Image.name,'Image');assert.equal(op.inputs.Image.socketType,'RGBA')
 assert.deepEqual(program.output,{kind:'ref',node:op.id,type:'RGBA'})
 if(definition.source==='render-layer'){const source=program.ops.find(op=>op.kind==='render-pass');assert.equal(source?.source.nodeType,'CompositorNodeRLayers');assert.equal(source.source.output,'Image');assert.deepEqual(op.inputs.Image.value,{kind:'ref',node:source.id,type:'RGBA'});assert.equal(program.passes.length,1);assert.equal(program.passes[0].pass,'Image');assert.equal(op.properties.displace_image_words,null)}
 else {assert.deepEqual(program.passes,[]);assert.deepEqual(op.properties.displace_image_words,definition.colorWords);if(definition.layout==='rgb'){const rgb=program.ops.find(op=>op.kind==='rgb');assert.equal(rgb?.source.nodeType,'CompositorNodeRGB');assert.deepEqual(op.inputs.Image.value,{kind:'ref',node:rgb.id,type:'RGBA'});assert.deepEqual(new Uint32Array(new Float32Array(rgb.value).buffer),new Uint32Array(definition.colorWords))}else{assert.equal(op.inputs.Image.value.kind,'constant');assert.equal(op.inputs.Image.value.type,'RGBA');assert.deepEqual(new Uint32Array(new Float32Array(op.inputs.Image.value.value).buffer),new Uint32Array(definition.colorWords))}}
 return program
}
export function assertSources(report){
 keys(report,['status','version','build','nativeRenders','gpuInitializations','rows']);assert.equal(report.status,statuses.source);assert.deepEqual(report.version,[5,3,0]);assert.equal(report.build,'02f0899d78e3');assert.equal(report.nativeRenders,0);assert.equal(report.gpuInitializations,0);assert.deepEqual(report.rows.map(row=>row.case),cases.map(row=>row.case))
 for(const[i,row]of report.rows.entries()){keys(row,[...Object.keys(cases[i]),'sourceFile','sourceSha256','programFile','programSha256']);for(const[k,v]of Object.entries(cases[i]))assert.deepEqual(row[k],v);for(const kind of['source','program']){assert.equal(row[kind+'File'],row.case+(kind==='source'?'.blend':'.program.json'));pin(row[kind+'Sha256'])}}
 return report
}
export function expectedFinalProvenance(inputs){
 assert.ok(inputs&&typeof inputs==='object'&&!Array.isArray(inputs))
 const entries=Object.entries(inputs).filter(([source])=>/^packages\/blendlink\/blender\/[^/]+\.py$/.test(source)||/^packages\/blender-addon\/[^/]+\.(py|json)$/.test(source))
 assert.ok(entries.length>0,'Missing primary packaged Python/addon source census')
 return entries.map(([source,sha256])=>{pin(sha256);return{source,artifact:source.startsWith('packages/blendlink/blender/')?source.replace('/blender/','/dist/blender/'):source.replace('packages/blender-addon/','packages/blendlink/dist/addon/'),sha256}}).sort((a,b)=>a.source<b.source?-1:a.source>b.source?1:0)
}
export function assertFinal(report,sources,sourceInputs){
 keys(report,['status','sourcePreserved','provenance','rows']);assert.deepEqual(report.provenance,expectedFinalProvenance(sourceInputs));assert.equal(report.status,browserProofContract.finalStatus);assert.equal(report.sourcePreserved,true);assert.deepEqual(report.rows.map(row=>row.case),cases.map(row=>row.case))
 for(const[i,row]of report.rows.entries()){keys(row,[...Object.keys(sources.rows[i]),'manifestPath','manifestSha256','glbPath','glbSha256','presentationPath','presentationSha256','modulePath','moduleSha256','moduleExport']);for(const[k,v]of Object.entries(sources.rows[i]))assert.deepEqual(row[k],v);assert.equal(row.moduleExport,'displace'+i);for(const kind of['manifest','glb','presentation','module']){assert.equal(typeof row[kind+'Path'],'string');pin(row[kind+'Sha256'])}}
 return report
}
export function assertApi(api,profile){assert.ok(['webgpu','webgl2'].includes(api.backend));assert.equal(api.gpu?.api,api.backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else{assert.equal(profile,'software');assert.match(JSON.stringify(api.gpu),/swiftshader/i)}}
export function assertHostGeometry(api,phase){
 const labels=cases.map(row=>row.case).concat(phase==='compare'?['detached-cancellation']:[])
 assert.deepEqual(api.hostGeometryControls.map(row=>row.case),labels)
 assert.equal(new Set(api.hostGeometryControls.map(row=>row.geometryId)).size,labels.length)
 const shared=api.hostGeometryControls[0].sharedBaseline;assert.ok(Number.isInteger(shared)&&shared>=1)
 for(const row of api.hostGeometryControls){
  assert.ok(Number.isInteger(row.geometryId)&&row.geometryId>=0);assert.match(row.geometryUuid,/^[0-9a-f-]{36}$/)
  assert.equal(row.sharedBaseline,shared);assert.equal(row.warmedBaseline,shared+1)
  assert.equal(row.registeredBeforeWarm,false);assert.equal(row.registeredAfterWarm,true);assert.ok(row.warmBeforeCalls>0&&row.warmAfterCalls>0)
  const count=row.case==='detached-cancellation'?2:phase==='compare'?3:1
  assert.deepEqual(row.cycles.map(cycle=>cycle.cycle),Array.from({length:count},(_,i)=>i))
  for(const cycle of row.cycles){assert.equal(cycle.geometryId,row.geometryId);assert.equal(cycle.geometries,row.warmedBaseline);assert.equal(cycle.geometryDisposals,0);assert.equal(cycle.materialDisposals,0);assert.equal(cycle.sameGeometry,true);assert.equal(cycle.registered,true)}
  assert.equal(row.geometryDisposals,1);assert.equal(row.materialDisposals,1);assert.equal(row.afterCallerCleanup,shared);assert.equal(row.registeredAfterCleanup,false)
 }
}
export function assertBaseline(report,profile){
 assert.equal(report.status,statuses.baseline);assert.equal(report.phase,'baseline');assert.equal(report.profile,profile);assert.deepEqual(report.apis.map(api=>api.backend),['webgpu','webgl2'])
 for(const api of report.apis){assertHostGeometry(api,'baseline');assertApi(api,profile);assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.httpErrors,[]);assert.deepEqual(api.uncaptured,[]);const frames=expectedFrames(profile,api.backend);assert.deepEqual(api.rows.map(row=>row.id),frames.map(row=>row.id));for(const[i,row]of api.rows.entries()){for(const[k,v]of Object.entries(frames[i]))assert.equal(row[k],v);assert.equal(row.scenePassType,'HalfFloatType');assert.equal(row.scenePassSamples,0);assert.equal(row.sourcePreserved,true);assert.equal(row.installedProgramPreserved,true);assert.equal(row.baselineFile,'frames/'+row.id+'.rgba32f');pin(row.baselineSha256);assert.equal(row.baselineWords,row.width*row.height*4);assert.equal(row.hostRestored,true);assert.equal(row.textureBaselineRestored,true)}}
 return report
}
const roles=['baseline','copy','linear','display']
export function assertNative(report){
 keys(report,['status','version','build','rows','nativeRenders','sourcePreserved','rawDisplayAudit','gpuInitializations','sourceImageProducerCredit']);assert.equal(report.status,browserProofContract.nativeStatus);assert.deepEqual(report.version,[5,3,0]);assert.equal(report.build,'02f0899d78e3');assert.equal(report.gpuInitializations,0);assert.equal(report.sourceImageProducerCredit,0);assert.equal(report.sourcePreserved,true);assert.equal(report.rawDisplayAudit.model,'cpu-reciprocal-f32-identity-ocio-audit-v1');assert.equal(report.rawDisplayAudit.ocioProcessorIsNoOp,true);pin(report.rawDisplayAudit.primarySourcesSha256);pin(report.rawDisplayAudit.configSha256)
 const frames=nativeFrames();assert.deepEqual(report.rows.map(row=>row.id),frames.map(row=>row.id));assert.equal(report.nativeRenders,frames.length*2)
 for(const[i,row]of report.rows.entries()){keys(row,[...Object.keys(frames[i]),...roles.flatMap(role=>[role+'File',role+'Sha256']),'words','copyDifferences','sourceExtractionStatus']);for(const[k,v]of Object.entries(frames[i]))assert.equal(row[k],v);assert.equal(row.words,row.width*row.height*4);assert.equal(row.copyDifferences,0);const definition=cases.find(c=>c.case===row.case);assert.equal(row.sourceExtractionStatus,definition.source==='render-layer'?'unsupported':'extracted');for(const role of roles){assert.equal(row[role+'File'],role==='baseline'?'frames/'+row.id+'.rgba32f':'native/'+row.id+'.'+role+'.rgba32f');pin(row[role+'Sha256'])}}
 return report
}
export const refusalIds=Object.freeze(['pixel-budget-before-rtt','mismatched-target','offset-target','scissor-target','saved-original-dispose'])
export function assertComparison(report,profile){
 assert.equal(report.status,statuses.browser);assert.equal(report.phase,'compare');assert.equal(report.profile,profile);assert.deepEqual(report.apis.map(api=>api.backend),['webgpu','webgl2'])
 for(const api of report.apis){
  assertHostGeometry(api,'compare');assertApi(api,profile);assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.httpErrors,[]);assert.deepEqual(api.uncaptured,[]);assert.deepEqual(api.controls.map(c=>c.case),[...refusalIds,'detached-dispose','cancel-before-ready']);for(const control of api.controls){assert.equal(control.passed,true);assert.equal(control.hostRestored,true);assert.equal(control.textureBaselineRestored,true);if(control.case==='saved-original-dispose'){assert.equal(control.ownedTextures,3);assert.deepEqual(control.physicalDestroys,[1,1,1]);assert.match(control.error,/Displace.*(?:available renderer\/device\/context|allocation epoch changed)/)}else if(refusalIds.includes(control.case)){assert.match(control.error,/Displace.*(?:pixel budget|full-frame|zero-origin)/i);assert.equal(control.allocationPastPixelBudget,false);assert.equal(control.recovered,true);assert.equal(control.numericalCredit,0)}}
  const frames=expectedFrames(profile,api.backend);assert.deepEqual(api.rows.map(row=>row.id),frames.map(row=>row.id));for(const[i,row]of api.rows.entries()){
   for(const[k,v]of Object.entries(frames[i]))assert.equal(row[k],v);assert.equal(row.sourcePreserved,true);assert.equal(row.installedProgramPreserved,true);assert.equal(row.hostRestored,true);assert.equal(row.textureBaselineRestored,true);assert.equal(row.baselineStable,true);assert.equal(row.scenePassType,'HalfFloatType');assert.equal(row.scenePassSamples,0);assert.equal(row.direct.wordDifferences,0);assert.equal(row.direct.words,row.width*row.height*4);pin(row.direct.sha256)
   assert.deepEqual(row.cycles.map(c=>c.cycle),[0,1,2]);for(const cycle of row.cycles){assert.equal(cycle.commitDraws,0);for(const key of['installedDraws','repeatedDraws'])assert.ok(Number.isInteger(cycle[key])&&cycle[key]>=1&&cycle[key]<=16);const probeDraws=cases.find(c=>c.case===row.case).source==='render-layer'?2:1;assert.equal(cycle.probeDraws,probeDraws);assert.equal(cycle.repeatedProbeDraws,probeDraws);assert.ok(Number.isInteger(cycle.installedFrame)&&Number.isInteger(cycle.repeatedFrame)&&cycle.repeatedFrame>cycle.installedFrame);assert.equal(cycle.probeFrame,cycle.installedFrame);assert.equal(cycle.repeatedProbeFrame,cycle.repeatedFrame);assert.equal(cycle.preparationHostRestored,true);assert.equal(cycle.sourceMaterialsPreserved,true);assert.equal(cycle.textureBaselineRestored,true);for(const key of['installed','repeated']){assert.equal(cycle[key].words,row.width*row.height*4);assert.equal(cycle[key].wordDifferences,0);pin(cycle[key].sha256)}for(const key of['display','repeatedDisplay']){const metric=cycle[key];assert.equal(metric.words,row.width*row.height*4);assert.equal(metric.projectionAccepted,true);assert.equal(metric.projectionContract,'existing-ocio-png-clamp01-3e-5');assert.equal(metric.alphaWordDifferences,0);assert.equal(metric.nonfiniteClassDifferences,0);assert.ok(Number.isFinite(metric.maxClampedAbsoluteError)&&metric.maxClampedAbsoluteError>=0&&metric.maxClampedAbsoluteError<=3e-5);pin(metric.sha256)}}
  }
 }
 return report
}

export function assertSourcePolicy(report){
 assert.equal(report.status,'PASSED_DISPLACE_SOURCE_ONLY');assert.equal(report.supportCredit,0)
 const positive=['constant','field'].flatMap((source,s)=>['Nearest','Bilinear'].flatMap((mode,m)=>Array.from({length:4},(_,i)=>source+'-'+mode+'-'+(s*8+m*4+i)))).concat(['rerouted-output','native-RGB-copy','whole-node-group'])
 const refusals=['raw-word-0x80000000','raw-word-0x1','raw-word-0x7fffff','raw-word-0x7fc12345','menu-Interpolation-Bicubic','menu-Interpolation-Anisotropic','menu-Extension X-Repeat','menu-Extension Y-Extend','linked-displacement','below-minimum','above-maximum','downstream-transform','GPU-authoring','pixel-budget','late-menu-Interpolation','late-menu-Extension X','late-menu-Extension Y','late-group-mute','late-reroute-relink','animated-source']
 assert.deepEqual(report.policy.positive,positive);assert.deepEqual(report.policy.refusals,refusals);assert.deepEqual(report.policy.omissions,['disabled-root']);assert.deepEqual(report.policy.blockedPolicyCalls,{gpu:0,render:0});assert.deepEqual(report.policy.guardsProved,['gpu.init','render-operator-call']);assert.equal(report.policy.nativeRenders,0);assert.equal(report.policy.gpuInitializations,0)
 return report
}
