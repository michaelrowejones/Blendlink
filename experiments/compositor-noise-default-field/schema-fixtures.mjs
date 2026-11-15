/* SPDX-License-Identifier: MIT */
// Synthetic host schema controls. Never numerical or native evidence.
import {cases,extents,defaults,model,profile,kernel,browserProofContract,expectedFinalCases,expectedFinalProvenance} from './protocol.mjs'
const pin='a'.repeat(64)
export function noiseGroupTraceFixture(){
 const endpoint=(tree,node,nodeType,socket)=>({tree,node,nodeType,socket})
 return {rootTree:'Compositor',groupTree:'OwnedChild',instance:'OwnedGroup',noise:'Noise0',reroute:'Reroute',links:[
  {from:endpoint('OwnedChild','Noise0','ShaderNodeTexNoise','Color'),to:endpoint('OwnedChild','Reroute','NodeReroute','Input')},
  {from:endpoint('OwnedChild','Reroute','NodeReroute','Output'),to:endpoint('OwnedChild','Output','NodeGroupOutput','Socket_0')},
  {from:endpoint('Compositor','OwnedGroup','CompositorNodeGroup','Socket_0'),to:endpoint('Compositor','Output','NodeGroupOutput','Socket_0')}
 ]}
}

export function noiseProgramFixture(row=cases[0]){
 const ops=[],path=row.route==='group-reroute'?['Compositor','OwnedGroup']:['Compositor']
 const ref=op=>({kind:'ref',node:op.id,type:op.type}),input=(op,name)=>({name,socketType:op.type,value:ref(op)})
 const constant=(value,name)=>({name,socketType:'VALUE',value:{kind:'constant',type:'VALUE',value}})
 const push=op=>{op.id='n'+ops.length;ops.push(op);return op}
 const noise=(output,physical)=>push({kind:'noise-texture',type:output==='Fac'?'VALUE':'RGBA',source:{path:[...path],node:'Noise'+physical,nodeType:'ShaderNodeTexNoise',output},
  inputs:Object.fromEntries(Object.entries(defaults).map(([name,value])=>[name,{name,socketType:'VALUE',value:{kind:'constant',type:'VALUE',value}}])),
  properties:{noise_model:model,noise_profile:profile,noise_kernel:kernel,noise_version:[5,3,0],noise_build:'02f0899d78e3',noise_evaluator:'CPU-MF',evaluation_device:'CPU',single_value_device:'CPU',noise_dimensions:2,noise_type:'FBM',noise_normalize:true,noise_coordinate_model:'exact-uniform-r32f-axes-v1',noise_reference_model:'full-frame-context-zero-offset-v1',noise_export_extent:[row.width,row.height],noise_precision:'CPU_FLOAT32',noise_requested_precision:'FULL',noise_fixed_sources:[{tree:row.route==='group-reroute'?'OwnedChild':'Compositor',node:'Noise'+physical,nodeType:'ShaderNodeTexNoise'},...(row.route==='group-reroute'?[{tree:'Compositor',node:'OwnedGroup',nodeType:'CompositorNodeGroup'}]:[])]}})
 const separate=(source,channel)=>push({kind:'separate-color',type:'VALUE',source:{path:['Compositor'],node:'Separate'+ops.length,nodeType:'CompositorNodeSeparateColor',output:channel},properties:{mode:'RGB'},inputs:{Image:input(source,'Image')}})
 const math=(operation,a,b)=>push({kind:'math',type:'VALUE',source:{path:['Compositor'],node:'Math'+ops.length,nodeType:'ShaderNodeMath',output:'Value'},properties:{operation,use_clamp:false},inputs:{Value:input(a,'Value'),Value_001:typeof b==='number'?constant(b,'Value'):input(b,'Value')}})
 const combine=channels=>push({kind:'combine-color',type:'RGBA',source:{path:['Compositor'],node:'Combine',nodeType:'CompositorNodeCombineColor',output:'Image'},properties:{mode:'RGB'},inputs:{Red:input(channels[0],'Red'),Green:input(channels[1],'Green'),Blue:input(channels[2],'Blue'),Alpha:constant(1,'Alpha')}})
 let output
 if(row.route==='shared-fac-color'){const fac=noise('Fac',0),color=noise('Color',0);output=combine([fac,separate(color,'Green'),separate(color,'Blue')])}
 else if(row.route==='two-color'){const a=noise('Color',0),b=noise('Color',1);output=combine([separate(a,'Red'),separate(b,'Green'),separate(b,'Blue')])}
 else if(row.route==='six-fac'){const channels=[];for(let i=0;i<3;i++){const a=noise('Fac',i*2),b=noise('Fac',i*2+1);channels.push(math('MULTIPLY',math('ADD',a,b),.5))}output=combine(channels)}
 else output=noise(row.output,0)
 return {status:'extracted',ops,passes:[],output:row.route==='direct'&&row.output==='Fac'?{kind:'convert',fromType:'VALUE',type:'RGBA',input:ref(output)}:ref(output)}
}
export function noiseNativeFixture(){
 return {schemaVersion:1,status:browserProofContract.nativeStatus,version:[5,3,0],build:'02f0899d78e3',device:'CPU',sceneEngine:'CYCLES',resultPrecision:'CPU_FLOAT32',nativeRenders:41,wordDifferences:0,pythonGpuInitializationCalls:0,finalCredit:0,browserCredit:0,
 sourceHashes:{'packages/blendlink/blender/compositor_noise.py':pin,'packages/blender-addon/static_selection.py':pin},
 cases:cases.map(row=>({...row,sourceOwnershipPreserved:true,...(row.route==='group-reroute'?{groupTrace:noiseGroupTraceFixture()}:{}),programFile:row.case+'.program.json',programSha256:pin,pixelFile:row.case+'.rgba32f',pixelSha256:pin,inputFile:row.case+'.input32f',inputSha256:pin,...(row.saved?{sourceFile:row.case+'.blend',sourceSha256:pin}:{})})),
 coordinateControls:extents.map(([width,height])=>({case:width+'x'+height+'-raw-uniform',width,height,pixelFile:width+'x'+height+'-raw-uniform.rgba32f',pixelSha256:pin})),
 fieldDomainControls:[[13,9],[5,5]].map(([width,height])=>({case:width+'x'+height+'-native-image-info-field-domain',width,height,dimensions:[width,height],sourceExtractionStatus:'unsupported',pixelFile:width+'x'+height+'-native-image-info-field-domain.rgba32f',pixelSha256:pin})),
 endpointControls:['Fac','Color'].map(output=>({case:'13x9-scale-zero-'+output.toLowerCase(),width:13,height:9,output,pixelFile:'13x9-scale-zero-'+output.toLowerCase()+'.rgba32f',pixelSha256:pin}))}
}
export function noiseFinalFixture(q=noiseNativeFixture()){
 return {status:browserProofContract.finalStatus,exporter:'built',sourcePreserved:true,nativeQualificationSha256:pin,provenance:expectedFinalProvenance(q),rows:expectedFinalCases().map((row,index)=>({...row,sourceFile:row.case+'.blend',sourceSha256:pin,manifestSha256:pin,glbSha256:pin,presentationSha256:pin,moduleSha256:pin,modulePath:'/actual/noise'+index+'.ts',moduleExport:'noise'+index,presentationPointer:{url:'/source.json',hash:'b'.repeat(16),bytes:123}}))}
}

export function noiseBrowserFixture({profile='metal',final=false,q=noiseNativeFixture(),f=noiseFinalFixture(q)}={}){
 const metrics=row=>({comparedWords:row.width*row.height*4,wordDifferences:0,contractViolations:0,maxUlps:0,maxAbsoluteError:0,alphaDifferences:0,latticeControls:0,latticeDifferences:0,facBroadcastDifferences:0,rowFlip:false,actualFile:row.case+'.rgba32f',actualSha256:pin})
 const cycle=()=>({preparation:{axisAllocations:0,axisUploads:0},commit:{axisAllocations:0,axisUploads:0},live:{axisAllocations:1,initialAxisUploads:1}})
 return {status:browserProofContract.browserStatus,built:true,final,profile,sourceDevice:'CPU',missingAdapterControl:{refused:true,error:'actual WebGPU adapter required'},rows:['webgpu','webgl2'].map(backend=>({
  backend,gpu:backend==='webgpu'?{api:'WebGPU',description:profile==='metal'?'Apple Metal':'SwiftShader'}:{api:'WebGL2',renderer:profile==='metal'?'Apple Metal':'SwiftShader'},errors:[],pageErrors:[],uncaptured:[],
  coordinateControls:q.coordinateControls.map(row=>({...row,comparedWords:row.width*row.height*4,exactWordMismatches:0,rowFlip:false,actualFile:row.pixelFile,actualSha256:pin})),
  savedDispose:{physicalDestroys:1,externalDevice:backend==='webgpu',remainingOwnedTextures:0,idempotentDisposal:true,ownerRoute:'buildSourceCompositor',error:'White Noise exact axes: renderer epoch changed',bindingControls:['value','reference','uv'].map(kind=>({kind,error:'binding changed',borrowedUploads:0,borrowedDisposals:0}))},
  negatives:['noise-source-profile','field-invalid-viewport','field-invalid-resize','field-disconnected-output-admission','field-owned-schema','field-owned-version'].map(kind=>({kind,error:'White Noise exact axes refusal'})),
  rows:(final?f.rows:q.cases).map(selected=>{
   const row=q.cases.find(r=>r.case===selected.case)
   return {...row,...metrics(row),portOwnedTextures:1,axisTableBindings:1,maximumAxisBytes:65536,remainingRenderTargets:0,unchangedExtentUploads:0,additionalPortPasses:0,passMeasurement:'owned-axis-render-target-allocations',observedFrameDrawCalls:1,resizeFrames:row.resizeCases.length,resizeResults:row.resizeCases.map(label=>{const target=q.cases.find(r=>r.case===label);return {...target,...metrics(target),axisUploads:1,repeatUploads:0}}),animationFrames:[1,2],remainingTextures:0,...(final?{
    installer:'startThreeCompiledScenePreparation.commit',installationCycles:[cycle(),cycle(),cycle()],...cycle(),cancelledPreparationRejected:true,preparedCancellationRestored:true,ownershipScope:'caller-owned-mesh-material-geometry-and-render-callbacks',hostBeforeCalls:1,hostAfterCalls:1,hostIdentityRestored:true,rendererCallbacksRestored:true,pinRejected:true,meshCount:1,pipeline:'blender-compositor',sourceMaterialsPreserved:true,lifecycleCycles:3,baselineCacheRestored:true,baselineSceneDrawCalls:1,baselineCache:[]
   }:{})}
  })
 }))}
}
