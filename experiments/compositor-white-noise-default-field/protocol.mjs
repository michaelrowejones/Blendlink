import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
export const browserProofContract=Object.freeze({schemaVersion:1,family:'compositor-white-noise-default-field',nativeStatus:'CAPTURED_COMPOSITOR_WHITE_NOISE_DEFAULT_FIELD',finalStatus:'PUBLISHED_COMPOSITOR_WHITE_NOISE_DEFAULT_FIELD',browserStatus:'PASSED_WHITE_NOISE_DEFAULT_FIELD_BUILT_PROOF'})
export const cases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'))
assert.equal(cases.length,54);assert.equal(cases.filter(row=>row.saved).length,8)
export const expectedCases=()=>structuredClone(cases)
export const expectedFinalCases=()=>structuredClone(cases.filter(row=>row.saved))
export const resizeCount=row=>row.resizeCases.length
export function expectedFinalProvenance(q){
 return Object.entries(q.sourceHashes).filter(([path])=>/^packages\/blendlink\/blender\/[^/]+\.py$/.test(path)||/^packages\/blender-addon\/[^/]+\.(py|json)$/.test(path))
  .map(([source,sha256])=>({source,artifact:source.startsWith('packages/blendlink/blender/')?source.replace('/blender/','/dist/blender/'):source.replace('packages/blender-addon/','packages/blendlink/dist/addon/'),sha256}))
  .sort((a,b)=>a.source<b.source?-1:a.source>b.source?1:0)
}
export const extents=Object.freeze([[13,9],[9,13],[16,8],[8,8],[127,65],[65,127],[8192,4],[4,8192]])
const sha=value=>assert.match(value,/^[a-f0-9]{64}$/)
const word=value=>new Uint32Array(new Float32Array([value]).buffer)[0]
export function uniformAxisWords(size,maximum){
 const f=Math.fround
 return Array.from({length:size},(_,i)=>word(f(f(f(f(i+.5)-f(size/2))/maximum)*2)))
}
// Independent source-derived Jenkins arithmetic; no runtime shader invocation.
export function hashWords(words){
 const rotate=(x,n)=>((x<<n)|(x>>>(32-n)))>>>0
 let a=(0xdeadbeef+(words.length<<2)+13)>>>0,b=a,c=a
 a=(a+words[0])>>>0;if(words.length>1)b=(b+words[1])>>>0;if(words.length>2)c=(c+words[2])>>>0
 if(words.length===4){a=((a-c)^rotate(c,4))>>>0;c=(c+b)>>>0;b=((b-a)^rotate(a,6))>>>0;a=(a+c)>>>0;c=((c-b)^rotate(b,8))>>>0;b=(b+a)>>>0;a=((a-c)^rotate(c,16))>>>0;c=(c+b)>>>0;b=((b-a)^rotate(a,19))>>>0;a=(a+c)>>>0;c=((c-b)^rotate(b,4))>>>0;b=(b+a)>>>0;a=(a+words[3])>>>0}
 c=((c^b)-rotate(b,14))>>>0;a=((a^c)-rotate(c,11))>>>0;b=((b^a)-rotate(a,25))>>>0;c=((c^b)-rotate(b,16))>>>0;a=((a^c)-rotate(c,4))>>>0;b=((b^a)-rotate(a,14))>>>0;c=((c^b)-rotate(b,24))>>>0
 return c
}
export function expectedFieldRgbaWords(row,axes){
 const unit=seed=>word(Math.fround(hashWords(seed))/Math.fround(0xffffffff)),[x,y,z]=axes,w=row.seedWWord
 if(row.route==='multi')return[unit([x,y]),unit([x,y,z,w]),unit([x,y]),word(1)]
 const seed=row.dimensions===2?[x,y]:row.dimensions===3?[x,y,z]:[x,y,z,w]
 if(row.output==='Value'){const value=unit(seed);return[value,value,value,word(1)]}
 const seeds=row.dimensions===4?[seed,[z,x,w,y],[w,z,y,x]]:[seed,[...seed,word(1)],[...seed,word(2)]]
 return[...seeds.map(unit),word(1)]
}
export const fieldPolicyPositive=[...['AUTO','FULL'].flatMap(p=>['2D','3D','4D'].flatMap(d=>['Value','Color'].map(o=>d+'-'+o+'-'+p))),'implicit-ignores-stored-vector-default','1D-fixed-unchanged','W-positive-zero','W-min-normal','W-negative-min-normal','W-maximum-normal','presentation-shared-table-source','source-addon-package-alias']
export const fieldPolicyRefusals=['W-negative-zero','W-subnormal','W-nan','border','crop-border','pixel-aspect','small-extent','large-extent','GPU','linked-group-implicit-still-refuses','spatial-CompositorNodeFlip','spatial-CompositorNodeBlur','animated-tree']
export const fixedPolicyRefusals=['raw-refusal-0x80000000','raw-refusal-0x1','raw-refusal-0x80000001','raw-refusal-0x7fffff','stored-nonfinite-0x7fc12345','combine-subnormal-0','combine-subnormal-1','combine-subnormal-2','animated-source','computed-source','implicit-vector-cast','unqualified-gpu-authored-source','group-default-subnormal','group-default-negative-zero','source-depth-budget']
export const interfaceDefaultControls=[{case:'vector-UNIFORM_IMAGE_COORDINATES',nativeAvailable:true,status:'unsupported'},{case:'vector-linked-override',nativeAvailable:true,status:'extracted'},...['NORMALIZED_IMAGE_COORDINATES','PIXEL_IMAGE_COORDINATES'].map(n=>({case:'vector-'+n,nativeAvailable:false})),{case:'vector-single-value',nativeAvailable:true,status:'extracted'},{case:'float-value-default',nativeAvailable:true,status:'extracted'},{case:'float-SCENE_FRAME',nativeAvailable:true,status:'unsupported'},...['SCENE_TIME','SCENE_SECONDS'].map(n=>({case:'float-'+n,nativeAvailable:false})),...['unknown-default','unknown-structure','field-structure','identifier-mismatch','output-direction','type-mismatch'].map(n=>({case:n,privateSchemaBoundary:true,status:'unsupported'}))]
export const defaultFieldControls=[{case:'implicit-default-field-model',status:'extracted',model:'native-compositor-white-noise-uniform-cpu-53-v1',profile:'darwin-arm64-53-white-noise-uniform-cpu-v1',coordinateModel:'exact-uniform-r32f-axes-v1',dimension:4,authoredInputs:['W'],isField:true,fieldNumericCredit:0}]
export function assertPolicy(value){
 assert.equal(value.status,'WHITE_NOISE_DEFAULT_FIELD_SOURCE_POLICY_PASSED');assert.deepEqual(value.field.positive,fieldPolicyPositive);assert.deepEqual(value.field.refusals,fieldPolicyRefusals)
 for(const row of[value,value.field])for(const k of['renders','gpuInitializationCalls','portCredit'])assert.equal(row[k],0)
 assert.equal(value.fixed.status,'WHITE_NOISE_SOURCE_POLICY_PASSED');assert.equal(value.fixed.positiveControls.length,18);assert.deepEqual(value.fixed.namedRefusals,fixedPolicyRefusals);assert.deepEqual(value.fixed.interfaceDefaultControls.map(({setterRefusal,...row})=>row),interfaceDefaultControls);assert.deepEqual(value.fixed.defaultFieldControls,defaultFieldControls)
 for(const row of value.fixed.interfaceDefaultControls)if(row.nativeAvailable===false){assert.equal(typeof row.setterRefusal,'string');assert.match(row.setterRefusal,/not found/)}
 for(const key of['renders','gpuInitializationCalls','portCredit'])assert.equal(value.fixed[key],0)
 return value
}
export function assertProgram(program,row){
 assert.equal(program.status,'extracted');assert.deepEqual(program.passes,[])
 const noise=program.ops.filter(op=>op.kind==='white-noise-texture')
 assert.deepEqual(program.ops.map(op=>op.kind),row.route==='multi'?['white-noise-texture','white-noise-texture','combine-vector']:['white-noise-texture'])
 assert.deepEqual(noise.map(op=>op.properties.noise_dimensions),row.route==='multi'?[2,4]:[row.dimensions])
 for(const op of noise){const p=op.properties,d=p.noise_dimensions
  assert.equal(op.source.nodeType,'ShaderNodeTexWhiteNoise');assert.equal(op.source.output,row.route==='multi'?'Value':row.output);assert.equal(op.type,op.source.output==='Color'?'RGBA':'VALUE')
  assert.equal(p.white_noise_model,'native-compositor-white-noise-uniform-cpu-53-v1');assert.equal(p.white_noise_profile,'darwin-arm64-53-white-noise-uniform-cpu-v1');assert.deepEqual(p.white_noise_version,[5,3,0]);assert.equal(p.white_noise_build,'02f0899d78e3');assert.equal(p.white_noise_evaluator,'CPU-MF');assert.equal(p.evaluation_device,'CPU');assert.equal(p.single_value_device,'CPU')
  assert.equal(p.white_noise_coordinate_model,'exact-uniform-r32f-axes-v1');assert.equal(p.white_noise_reference_model,'full-frame-context-zero-offset-v1');assert.deepEqual(p.white_noise_export_extent,[row.width,row.height]);assert.equal(p.white_noise_precision,'CPU_FLOAT32');assert.ok(['AUTO','FULL'].includes(p.white_noise_requested_precision));assert.equal(p.white_noise_normalization,'u32-rne-integer-mantissa-v1')
  assert.deepEqual(Object.keys(op.inputs),d===4?['W']:[])
  if(d===4){const input=op.inputs.W;assert.equal(input.socketType,'VALUE');assert.equal(input.value.kind,'constant');assert.equal(input.value.type,'VALUE');assert.equal(word(input.value.value),row.seedWWord)}
 }
 if(row.route==='group-w'){
  const types=new Set(noise[0].properties.white_noise_fixed_sources.map(source=>source.nodeType))
  for(const kind of['CompositorNodeGroup','NodeGroupInput','NodeReroute'])assert.ok(types.has(kind),'Missing actual group/reroute W binding '+kind)
 }
 if(row.route==='multi'){
  const combine=program.ops[2];assert.equal(combine.source.nodeType,'ShaderNodeCombineXYZ');assert.equal(combine.type,'VECTOR')
  assert.deepEqual(Object.keys(combine.inputs),['X','Y','Z'])
  for(const[name,index]of[['X',0],['Y',1],['Z',0]]){const input=combine.inputs[name];assert.equal(input.socketType,'VALUE');assert.deepEqual(input.value,{kind:'ref',type:'VALUE',node:noise[index].id})}
 }
 return program
}
export function assertQualification(q){
 assert.equal(q.schemaVersion,1);assert.equal(q.status,browserProofContract.nativeStatus);assert.deepEqual(q.version,[5,3,0]);assert.equal(q.build,'02f0899d78e3');assert.equal(q.device,'CPU');assert.equal(q.sceneEngine,'CYCLES');assert.equal(q.resultPrecision,'CPU_FLOAT32');assert.equal(q.wordDifferences,0);assert.equal(q.nativeRenders,63);assert.equal(q.finalCredit,0);assert.equal(q.browserCredit,0)
 assert.ok(q.sourceHashes&&typeof q.sourceHashes==='object'&&!Array.isArray(q.sourceHashes));assert.ok(Object.keys(q.sourceHashes).length>0);for(const value of Object.values(q.sourceHashes))sha(value)
 assert.deepEqual(q.cases.map(r=>r.case),cases.map(r=>r.case));assert.equal(new Set(q.cases.map(r=>r.case)).size,cases.length)
 for(const[row,index]of q.cases.map((r,i)=>[r,i])){
  for(const[key,value]of Object.entries(cases[index]))assert.deepEqual(row[key],value)
  for(const kind of['program','pixel','input']){assert.equal(row[kind+'File'],row.case+({program:'.program.json',pixel:'.rgba32f',input:'.input32f'})[kind]);sha(row[kind+'Sha256'])}
  assert.equal(!!row.sourceFile,row.saved);if(row.saved){assert.equal(row.sourceFile,row.case+'.blend');sha(row.sourceSha256)}
 }
 assert.deepEqual(q.coordinateControls.map(r=>[r.case,r.width,r.height]),extents.map(([w,h])=>[w+'x'+h+'-raw-uniform',w,h]))
 for(const row of q.coordinateControls){assert.equal(row.pixelFile,row.case+'.rgba32f');sha(row.pixelSha256)}
 const domain=q.fieldDomainControl;assert.equal(domain.case,'13x9-native-image-info-field-domain');assert.equal(domain.width,13);assert.equal(domain.height,9);assert.equal(domain.pixelFile,domain.case+'.rgba32f');sha(domain.pixelSha256);assert.deepEqual(domain.dimensions,[13,9]);assert.equal(domain.sourceExtractionStatus,'unsupported')
 return q
}
export function assertFinal(value,q,{built,nativeSha256}){
 assert.equal(value.status,browserProofContract.finalStatus);assert.equal(built,true);assert.equal(value.exporter,'built');assert.equal(value.nativeQualificationSha256,nativeSha256);assert.equal(value.sourcePreserved,true);assert.deepEqual(value.rows.map(r=>r.case),expectedFinalCases().map(r=>r.case))
 assert.deepEqual(value.provenance,expectedFinalProvenance(q),'Final packaged Python/source registry provenance is incomplete or stale')
 assert.equal(new Set(value.rows.map(r=>r.moduleExport)).size,8)
 for(const row of value.rows){const original=q.cases.find(r=>r.case===row.case);assert.equal(row.sourceFile,original.sourceFile);assert.equal(row.sourceSha256,original.sourceSha256);for(const k of['manifestSha256','glbSha256','presentationSha256','moduleSha256'])sha(row[k]);assert.match(row.moduleExport,/^[A-Za-z_$][A-Za-z0-9_$]*$/);assert.ok(row.modulePath);assert.ok(row.presentationPointer?.url);assert.ok(Number.isInteger(row.presentationPointer.bytes)&&row.presentationPointer.bytes>0)}
 return value
}
export function assertBrowserRows(report,q,f,{profile,final}){
 assert.equal(report.status,browserProofContract.browserStatus);assert.equal(report.built,true);assert.equal(report.final,final);assert.equal(report.profile,profile);assert.equal(report.sourceDevice,'CPU');assert.deepEqual(report.rows.map(r=>r.backend),['webgpu','webgl2']);assert.equal(report.missingAdapterControl.refused,true);assert.match(report.missingAdapterControl.error,/actual WebGPU adapter/)
 for(const api of report.rows){
  assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
  assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.uncaptured,[])
  assert.equal(api.savedDispose?.physicalDestroys,1);assert.equal(api.savedDispose.externalDevice,api.backend==='webgpu');assert.equal(api.savedDispose.remainingOwnedTextures,0);assert.equal(api.savedDispose.idempotentDisposal,true);assert.equal(api.savedDispose.ownerRoute,'buildSourceCompositor')
  assert.match(api.savedDispose.error,/White Noise exact axes: (renderer.*(?:epoch|lost)|actual available renderer\/device\/context required)/)
  assert.deepEqual(api.negatives.map(r=>r.kind),['white-noise-source-profile','field-invalid-viewport','field-invalid-resize','field-constant-terminal-guard','field-owned-schema','field-owned-version'])
  for(const row of api.negatives){assert.equal(typeof row.error,'string');assert.match(row.error,/White Noise/)}
  assert.deepEqual(api.rows.map(r=>r.case),(final?f.rows:q.cases).map(r=>r.case))
  for(const row of api.rows){const native=q.cases.find(r=>r.case===row.case);for(const k of['width','height','pixelRatio','route'])assert.equal(row[k],native[k]);assert.equal(row.exactWordMismatches,0);assert.equal(row.contractViolations,0);assert.equal(row.comparedWords,native.width*native.height*4);assert.equal(row.exactControlWords,row.comparedWords);assert.equal(row.portOwnedTextures,1);assert.equal(row.remainingRenderTargets,0);assert.equal(row.resizeFrames,resizeCount(native));assert.deepEqual(row.resizeResults.map(r=>r.case),native.resizeCases)
   assert.equal(row.axisTableBindings,1);assert.ok(Number.isInteger(row.maximumAxisBytes)&&row.maximumAxisBytes>0&&row.maximumAxisBytes<=65536);assert.equal(row.unchangedExtentUploads,0);assert.equal(row.additionalPortPasses,0)
   assert.equal(row.passMeasurement,'owned-axis-render-target-allocations');assert.ok(Number.isInteger(row.observedFrameDrawCalls)&&row.observedFrameDrawCalls>0)
   for(const frame of row.resizeResults){const target=q.cases.find(r=>r.case===frame.case);assert.ok(target);for(const k of['width','height','pixelRatio'])assert.equal(frame[k],target[k]);assert.equal(frame.comparedWords,target.width*target.height*4);assert.equal(frame.exactWordMismatches,0);assert.equal(frame.contractViolations,0);assert.equal(frame.axisUploads,1);assert.equal(frame.repeatUploads,0)}
   for(let i=1;i<row.animationFrames.length;i++)assert.ok(row.animationFrames[i]>row.animationFrames[i-1]);assert.ok(row.animationFrames.length>=2)
   if(final){
    assert.equal(row.installer,'startThreeCompiledScenePreparation.commit')
    assert.equal(row.installationCycles.length,3)
    for(const measured of[row,...row.installationCycles])for(const[phase,keys]of[['preparation',['axisAllocations','axisUploads']],['commit',['axisAllocations','axisUploads']],['live',['axisAllocations','initialAxisUploads']]]){
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
