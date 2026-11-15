import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
export const variant=process.env.SCENETOWEB_SWITCH_VARIANT??'static'
assert.ok(['static','mono-view','integer-vector3','finite-image-info'].includes(variant),'Unknown static selection proof variant')
export const contexts=variant!=='static'?['CPU']:['shader','CPU','GPU']
export const expectedSavedFinalCount=variant!=='static'?8:30
// Version 1 shares the frozen report vocabulary between this family's runner and reader.
export const browserProofContract=Object.freeze({schemaVersion:1,family:'static-selection',nativeStatus:'CAPTURED_STATIC_SELECTION',finalStatus:'PUBLISHED_STATIC_SELECTION',browserStatus:'PASSED_STATIC_SELECTION_BUILT_PROOF'})
const legacyExpectedCases=['calibration',...['switch','index','menu'].flatMap(f=>['float','int','boolean','vector','rgba'].flatMap(m=>[0,1].map(c=>`${f}-${m}-${c}`))),...['switch','index','menu'].flatMap(f=>['field','inactive','group'].flatMap(k=>[0,1].map(c=>`${f}-${k}-${c}`))),...['switch','index'].flatMap(f=>[0,1].map(c=>`${f}-typed-${c}`)),...[0,1].flatMap(c=>[1,2].map(o=>`menu-mask-${c}-${o}`)),...['not','xor','or','imply'].map(o=>'switch-bool-'+o),...['index','menu'].flatMap(f=>['three-items','reordered'].map(k=>`${f}-${k}`)),...['direct','reroute','group'].flatMap(r=>[0,1].map(c=>`menu-source-${r}-${c}`))]
export const viewCases=JSON.parse(readFileSync(new URL('./view-cases.json',import.meta.url)))
export const integerVectorCases=JSON.parse(readFileSync(new URL('./int-vector3-cases.json',import.meta.url)))
export const finiteImageInfoCases=variant==='finite-image-info'?JSON.parse(readFileSync(new URL('../compositor-finite-image-info/cases.json',import.meta.url))):[]
export const exactWordVariant=['integer-vector3','finite-image-info'].includes(variant)
export const exactWordCases=variant==='finite-image-info'?finiteImageInfoCases:integerVectorCases
export const expectedCases=variant==='finite-image-info'?finiteImageInfoCases.map(row=>row.case):variant==='integer-vector3'?integerVectorCases.map(row=>row.case):variant==='mono-view'?viewCases.map(row=>row.case):legacyExpectedCases
export function assertQualification(q){
 assert.equal(q.status,browserProofContract.nativeStatus);assert.deepEqual(q.version,[5,3,0]);assert.equal(q.build,'02f0899d78e3');assert.ok(contexts.includes(q.context));assert.equal(q.sourcePreserved,true);assert.equal(q.width,8);assert.equal(q.height,8)
 if(variant!=='static')assert.deepEqual(q.nativeBackend,{evaluator:'native-cpu-compositor',requestedCompositorDevice:'CPU',gpuInitialized:false,gpuEvaluationCredit:false})
 assert.deepEqual(q.cases.map(x=>x.case).sort(),[...expectedCases].sort());assert.equal(q.cases.filter(x=>x.sourceFile).length,expectedSavedFinalCount)
 if(exactWordVariant)assert.equal(q.pythonGpuInitializationCalls,0)
 for(const row of q.cases){if(variant!=='static'){const spec=(exactWordVariant?exactWordCases:viewCases).find(x=>x.case===row.case);for(const[k,v]of Object.entries(spec))assert.deepEqual(row[k],v)}assert.equal(row.sourcePreserved,true);assert.equal(row.context,q.context);for(const key of ['programSha256','pixelSha256'])assert.match(row[key],/^[a-f0-9]{64}$/)}return q
}
export function assertFinal(f,q,pin){assert.equal(f.status,browserProofContract.finalStatus);assert.equal(f.context,q.context);assert.equal(f.sourcePreserved,true);assert.equal(f.nativeQualificationSha256,pin);assert.deepEqual(f.rows.map(x=>x.case).sort(),q.cases.filter(x=>x.sourceFile).map(x=>x.case).sort());return f}
export function assertBrowserReport(r,q,f,{profile,final}){
 assert.equal(r.status,browserProofContract.browserStatus);assert.equal(r.built,true);assert.equal(r.final,final);assert.equal(r.profile,profile);assert.equal(r.sourceContext,q.context);assert.deepEqual(r.rows.map(x=>x.backend).sort(),['webgl2','webgpu']);assert.equal(r.missingAdapterControl.refused,true);assert.match(r.missingAdapterControl.error,/actual WebGPU adapter/)
 const expected=(final?f.rows:q.cases).map(x=>x.case)
 for(const api of r.rows){
 if(variant==='finite-image-info'){assert.equal(api.finiteFrameGuard?.case,'blank-group');assert.equal(api.finiteFrameGuard.refused,true);assert.equal(api.finiteFrameGuard.recovered,true);assert.match(api.finiteFrameGuard.error,/Blank Image.*full-frame/);for(const key of['creations','uploads','physicalHandles','sampledTextureBindings'])assert.ok(Number.isInteger(api.payloadCostCanary?.[key])&&api.payloadCostCanary[key]>0)}
 assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
 assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.errors,[]);assert.deepEqual(api.rows.map(x=>x.case),expected)
 for(const row of api.rows){if(variant==='finite-image-info')assertFinitePayloadCost(row.payloadCost,finiteImageInfoCases.find(entry=>entry.case===row.case),final);if(variant!=='static'){assert.equal(row.comparedWords,256);assert.equal(row.lifecycleCycles,final?2:1)}assert.equal(row.wordMismatches,0);assert.equal(row.remainingTextures,0);assert.equal(row.finalBindings,final);assert.equal(row.ownershipPreserved,true);assert.equal(row.pinRejected,final?true:null);if(exactWordVariant){assert.deepEqual(row.readbacks.map(x=>x.phase),final?['primary','repeat','reinstalled']:['primary','repeat']);for(const readback of row.readbacks){assert.equal(readback.comparedWords,256);assert.equal(typeof readback.rowFlip,'boolean');assert.equal(readback.wordFile,'readbacks/'+api.backend+'-'+row.case+'-'+readback.phase+'.u32');assert.match(readback.wordSha256,/^[a-f0-9]{64}$/)}}}}return r
}

export function assertMonoProgram(program,entry){
 if(variant!=='mono-view')return
 assert.equal(program.status,'extracted')
 if(entry.kind==='control')return
 assert.equal(program.compileTimeViews?.length,1)
 const view=program.compileTimeViews[0]
 assert.equal(view.model,'native-mono-switch-view-cpu-53-v1');assert.deepEqual(view.nativeVersion,[5,3,0]);assert.equal(view.nativeBuild,'02f0899d78e3');assert.equal(view.sourceContext,'current-mono-CPU');assert.equal(view.selectionKind,'actual-native-input0');assert.equal(view.preservesSelectedDomain,true)
 assert.equal(view.selectedInput,entry.kind==='view-disabled'?'right':entry.kind==='view-renamed'?'Artist right':'left');assert.equal(view.inputIdentifiers[0],view.selectedInput)
 assert.ok(program.ops.every(op=>!['CompositorNodeSwitchView','CompositorNodeSceneTime'].includes(op.source.nodeType)))
 if(entry.kind==='view-image'){assert.deepEqual(program.ops.map(op=>op.kind),['image-input']);assert.equal(program.output.kind,'ref')}
 if(entry.kind==='view-domain')assert.deepEqual(program.ops.map(op=>op.kind).sort(),['image-info','render-pass'])
}

export function assertIntegerVectorProgram(program,entry){
 if(variant!=='integer-vector3')return
 assert.equal(program.status,'extracted');assert.deepEqual(program.passes,[])
 if(entry.kind==='control'){assert.equal(program.ops.length,1);assert.equal(program.ops[0].kind,'rgb');return}
 assert.equal(program.ops.length,1);const op=program.ops[0]
 assert.equal(op.kind,'integer-vector');assert.equal(op.type,'INT_VECTOR3');assert.equal(op.source.nodeType,'FunctionNodeInputIntVector');assert.equal(op.source.output,'Vector');assert.deepEqual(op.inputs,{});assert.deepEqual(op.value,entry.value)
 assert.equal(op.properties.integer_vector_model,'native-int3-constant-53-v1');assert.equal(op.properties.integer_vector_profile,'darwin-arm64-53-int3-cpu-v1');assert.equal(op.properties.integer_vector_build,'02f0899d78e3');assert.deepEqual(op.properties.integer_vector_version,[5,3,0]);assert.equal(op.properties.integer_vector_dimensions,3);assert.equal(op.properties.evaluation_device,'CPU');assert.equal(op.properties.single_value_device,'CPU');assert.equal(op.properties.integer_vector_presentation,'component-rne-f32-alpha-one-v1')
 const ref={kind:'ref',node:op.id,type:'INT_VECTOR3'},inner={kind:'convert',fromType:'INT_VECTOR3',type:entry.route==='vector-group'?'VECTOR':'RGBA',input:ref}
 assert.deepEqual(program.output,entry.route==='vector-group'?{kind:'convert',fromType:'VECTOR',type:'RGBA',input:inner}:inner)
}

export function assertIntegerVectorWords(bytes,entry){
 assert.equal(bytes.byteLength,1024,'Integer Vector readback must contain every RGBA Float32 word')
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
 for(let i=0;i<256;i++)assert.equal(view.getUint32(i*4,true),entry.expectedWords[i%4],entry.case+' independently recomputed word '+i)
 return 256
}

export function assertFiniteImageInfoProgram(program,entry){
 if(variant!=='finite-image-info')return
 assert.equal(program.status,'extracted');assert.deepEqual(program.passes,[])
 if(entry.kind==='control'){assert.equal(program.ops.length,1);assert.equal(program.ops[0].kind,'rgb');return}
 const source=program.ops.filter(op=>['image-input','blank-image'].includes(op.kind));assert.equal(source.length,1)
 const producer=source[0],size=entry.size.map(n=>Math.max(1,n));assert.equal(producer.kind,entry.producer==='blank'?'blank-image':'image-input');assert.equal(producer.properties.evaluation_device,'CPU')
 assert.equal(producer.source.nodeType,entry.producer==='blank'?'CompositorNodeBlankImage':'CompositorNodeImage');assert.equal(producer.type,'RGBA');assert.equal(producer.source.output,'Image')
 if(entry.producer==='blank'){assert.equal(producer.properties.blank_image_model,'native-compositor-blank-image-cpu-53-v1');assert.deepEqual(producer.properties.blank_image_size,entry.size);assert.deepEqual(producer.properties.blank_image_effective_size,size);assert.equal(program.images,undefined)}
 else{const record=program.images[producer.properties.image_id];assert.equal(Object.keys(program.images).length,1);assert.equal(record.model,'native-cpu-static-image-v1');assert.deepEqual([record.width,record.height],size)}
 const infos=program.ops.filter(op=>op.kind==='image-info');assert.deepEqual(infos.map(op=>op.source.output).sort(),entry.route==='summary'?['Dimensions','Resolution','Rotation','Scale']:[entry.output])
 for(const op of infos){assert.equal(op.type,{Dimensions:'INT_VECTOR2',Resolution:'INT_VECTOR2',Location:'FLOAT_VECTOR2',Rotation:'VALUE',Scale:'FLOAT_VECTOR2'}[op.source.output]);assert.deepEqual(Object.keys(op.inputs),['Image']);assert.equal(op.inputs.Image.name,'Image');assert.equal(op.inputs.Image.socketType,'RGBA');assert.equal(typeof op.properties.image_info_scene,'string');assert.ok(op.properties.image_info_scene);assert.equal(op.source.nodeType,'CompositorNodeImageInfo');assert.equal(op.properties.image_info_model,'finite-identity-image-info-v1');assert.equal(op.properties.image_info_source_profile,'darwin-arm64-53-finite-image-info-v1');assert.deepEqual(op.properties.image_info_native_version,[5,3,0]);assert.equal(op.properties.image_info_reference_model,'finite-image-identity-v1');assert.deepEqual(op.properties.image_info_finite_size,size);assert.equal(op.properties.evaluation_device,'CPU');assert.equal(op.properties.single_value_device,'CPU');assert.deepEqual(op.inputs.Image.value,{kind:'ref',type:'RGBA',node:producer.id})}
 assert.ok(program.ops.every(op=>['image-input','blank-image','image-info','value','math','separate-vector','combine-color'].includes(op.kind)))
 const byId=new Map(program.ops.map(op=>[op.id,op])),used=new Set()
 const walk=value=>{if(value.kind==='convert')return walk(value.input);if(value.kind==='constant')return;if(value.kind!=='ref'||!byId.has(value.node))throw Error('Finite metadata dangling typed edge');if(used.has(value.node))return;used.add(value.node);for(const binding of Object.values(byId.get(value.node).inputs))walk(binding.value)}
 walk(program.output);assert.equal(used.size,program.ops.length,'Every finite metadata operation must contribute')
 if(entry.route==='aspect')assert.equal(program.ops.filter(op=>op.kind==='math'&&op.properties.operation==='DIVIDE').length,1)
}

export function assertFinitePayloadCost(cost,entry,final){
 const count=['png','float'].includes(entry.producer)?(final?2:1):0,bytes=count?entry.size[0]*entry.size[1]*16:0
 assert.equal(cost?.scope,'matched-actual-source-payload-objects-and-backend-bindings');assert.equal(cost.cpuObjects,count);assert.equal(cost.distinctCpuBuffers,count);assert.equal(cost.observedCpuBytes,count*bytes)
 for(const key of['gpuCreations','gpuUploads','physicalGpuHandles','sampledTextureBindings','samplerBindings'])assert.equal(cost[key],0,'Unused finite metadata payload must not allocate/upload/bind a GPU image')
 assert.equal(cost.rows.length,count);assert.equal(new Set(cost.rows.map(row=>row.uuid)).size,count)
 for(const row of cost.rows){assert.equal(typeof row.uuid,'string');assert.ok(row.uuid);assert.deepEqual([row.width,row.height],entry.size);assert.equal(row.observedCpuBytes,bytes);assert.match(row.rawSha256,/^[a-f0-9]{64}$/);for(const key of['creations','uploads','physicalHandles','sampledTextureBindings','samplerBindings'])assert.equal(row[key],0)}
 return cost
}
