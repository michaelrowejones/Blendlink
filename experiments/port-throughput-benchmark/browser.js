import*as THREE from'three'
import{WebGPURenderer,NodeMaterial,QuadMesh}from'three/webgpu'
import{screenCoordinate,vec4,uniform,uint,ivec2,textureLoad}from'three/tsl'
import{validatePlan,workloads,pairedOrder,distribution,performanceDecision,assertComparable,assertAccuracyRecord,classifyNative64Words,verifyNative64Words,normalizeWords}from'./metrics.mjs'
import{timerCapability,webglGpuSample}from'./gpu-timer.mjs'
const now=()=>performance.now()
const limit=async(promise,ms)=>{let t;try{return await Promise.race([promise,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error('Declared time budget exceeded')),ms)})])}finally{clearTimeout(t)}}
function wordsFromPixels(pixels,width,height){
 if(!(pixels instanceof Float32Array))throw Error('Actual Float32 readback required')
 const tight=width*height*4,padded=Math.ceil(width*16/256)*64,stride=pixels.length===tight?width*4:pixels.length===(height-1)*padded+width*4?padded:0
 if(!stride)throw Error('Unknown readback byte layout')
 const raw=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length),words=[]
 for(let y=0;y<height;y++)for(let x=0;x<width*4;x++)words.push(raw[y*stride+x]);return words
}
async function drain(renderer){if(renderer.backend.device)await renderer.backend.device.queue.onSubmittedWorkDone();else renderer.backend.gl.finish()}
const target=(w,h)=>{const t=new THREE.RenderTarget(w,h,{type:THREE.FloatType,format:THREE.RGBAFormat,samples:0,depthBuffer:false});t.texture.colorSpace=THREE.NoColorSpace;return t}
function material(node){const m=new NodeMaterial();m.fragmentNode=node;m.blending=THREE.NoBlending;m.depthTest=false;m.depthWrite=false;return m}
window.portThroughputBenchmark=async config=>{
 const plan=validatePlan(config.plan),start=now(),result={status:'running',backend:config.backend,profile:config.profile,rows:[],errors:[],supportCredit:0,nativeParityCredit:0},renderer=new WebGPURenderer({forceWebGL:config.backend==='webgl2',antialias:false,trackTimestamp:false})
 window.portThroughputFailure=result
 let bridge,inputTextureOwned
 try{
  await renderer.init();const actual=renderer.backend.isWebGPUBackend?'webgpu':'webgl2';if(actual!==config.backend)throw Error('Actual API fallback')
  const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),info=renderer.backend.device?.adapterInfo
  result.gpu={api:actual==='webgpu'?'WebGPU':'WebGL2',...(gl?{vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}:{vendor:info?.vendor,architecture:info?.architecture,description:info?.description,device:info?.device})}
  renderer.debug.onShaderError=(g,p,v,f)=>result.errors.push([g.getProgramInfoLog(p),g.getShaderInfoLog(v),g.getShaderInfoLog(f)].filter(Boolean).join('\n'))
  renderer.backend.device?.addEventListener('uncapturederror',e=>result.errors.push(String(e.error)))
  renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;renderer.setPixelRatio(1)
  const adapter=await import(config.adapterUrl),oracle=await import(config.oracleUrl),hand=config.handUrl?await import(config.handUrl):null,production=config.productionUrl?await import(config.productionUrl):null
  const handBuilder=hand?.buildHandTsl??(production?adapter.makeHandTsl(production,config.handOptions):adapter.buildHandTsl)
  bridge=await adapter.makeBridge(config.module,{...config.adapterOptions,buildHandTsl:handBuilder})
  const timer=timerCapability(renderer);result.gpuTimer={kind:timer.kind,reason:timer.reason};result.compileScope='sourceBuildMs=Three debug source generation; pipelineCompileAwaitMs=compileAsync wall time, not isolated GPU compiler duration; firstRenderCompletionMs includes submission and completion'
  const phase=uniform(0,'uint'),index=uint(screenCoordinate.y).mod(8).mul(8).add(uint(screenCoordinate.x).mod(8)).add(phase).mod(64),inputTexture=new THREE.DataTexture(new Float32Array(new Uint32Array(config.inputWords).buffer),8,8,THREE.RGBAFormat,THREE.FloatType)
  inputTextureOwned=inputTexture;inputTexture.colorSpace=THREE.NoColorSpace;inputTexture.minFilter=THREE.NearestFilter;inputTexture.magFilter=THREE.NearestFilter;inputTexture.generateMipmaps=false;inputTexture.flipY=false;inputTexture.needsUpdate=true
  const rawInput=textureLoad(inputTexture,ivec2(index.mod(8),index.div(8))),vector=rawInput.xyz
  result.inputContract=plan.inputModel;result.inputControls=[]
  const controlMaterial=material(rawInput),controlQuad=new QuadMesh(controlMaterial),controlTarget=target(8,8)
  let rowFlip
  try{renderer.setRenderTarget(controlTarget);for(const p of plan.accuracyPhases){phase.value=p;controlQuad.render(renderer);const pixels=await renderer.readRenderTargetPixelsAsync(controlTarget,0,0,8,8),words=wordsFromPixels(pixels,8,8);if(rowFlip===undefined)rowFlip=classifyNative64Words(words,config.inputWords,p).rowFlip;verifyNative64Words(words,config.inputWords,p,rowFlip);result.inputControls.push({width:8,height:8,phase:p,rowFlip,words})}}finally{renderer.setRenderTarget(null);controlTarget.dispose();controlMaterial.dispose()}
  const annotate=(item,mode)=>({...item.metadata,outputContract:(item.metadata.outputContract??item.metadata.parameterContract?.output)+'|projection='+config.projection,kernelSourceSha256:item.metadata.kernelSourceSha256??config.modeSourceSha256[mode]})
  for(const[index,scenario]of workloads(plan,config.kinds,{shapes:config.shapes??plan.shapes,projection:config.projection}).entries()){
   if(now()-start>plan.maximumLeaseMs)throw Error('Lease budget exceeded')
   if(!bridge.availableKinds.includes(scenario.kind))throw Error('Adapter kind unavailable: '+scenario.kind)
   const row={...scenario,status:'running',modes:{},pairedOrder:[]};result.rows.push(row)
   const state={},built=[]
   try{
    for(const mode of pairedOrder(index,0)){
     const buildStart=now(),first=await bridge.createVariant({renderer,mode,kind:scenario.kind,inputs:{vector}});built.push(first)
     let node=first.node,second
     if(scenario.projection==='scalar')node=vec4(node.w,node.w,node.w,1)
     const m=material(node),quad=new QuadMesh(m),rt=target(scenario.width,scenario.height),accuracyTarget=target(...plan.accuracyExtent)
     state[mode]={first,second,m,quad,rt,accuracyTarget};const sample=row.modes[mode]={nodeConstructionMs:now()-buildStart,metadata:annotate(first,mode),blocks:[],accuracy:[],gpuSamplesMs:[]}
     if(!node?.isNode)throw Error('Adapter must return an actual TSL node')
     renderer.setSize(scenario.width,scenario.height);renderer.setRenderTarget(rt)
     let t=now();const shaders=await limit(renderer.debug.getShaderAsync(quad,quad.camera,quad),plan.maximumCompileMs);sample.sourceBuildMs=now()-t
     sample.vertexShader=shaders.vertexShader;sample.fragmentShader=shaders.fragmentShader;sample.fragmentBytes=new TextEncoder().encode(shaders.fragmentShader).length
     if(sample.fragmentBytes>plan.maximumFragmentBytes)throw Error('Fragment byte budget exceeded')
     t=now();await limit(renderer.compileAsync(quad,quad.camera),plan.maximumCompileMs);sample.pipelineCompileAwaitMs=now()-t
     t=now();quad.render(renderer);await drain(renderer);sample.firstRenderCompletionMs=now()-t
     for(const p of plan.accuracyPhases){phase.value=p;renderer.setRenderTarget(accuracyTarget);quad.render(renderer);const pixels=await renderer.readRenderTargetPixelsAsync(accuracyTarget,0,0,...plan.accuracyExtent),words=wordsFromPixels(pixels,...plan.accuracyExtent),record=await oracle.checkAccuracy({mode,scenario,phase:p,words:normalizeWords(words,...plan.accuracyExtent,rowFlip),width:plan.accuracyExtent[0],height:plan.accuracyExtent[1],metadata:sample.metadata,oracleData:config.oracleData,coordinateContract:'native64-repeat-v1'})
      sample.accuracy.push({phase:p,rowFlip,words,record});assertAccuracyRecord(record)
     }
     renderer.setRenderTarget(rt);t=now();await renderer.compileAsync(quad,quad.camera);sample.warmCompileAwaitMs=now()-t
     phase.value=17;quad.render(renderer);const fullPixels=await renderer.readRenderTargetPixelsAsync(rt,0,0,scenario.width,scenario.height),fullWords=new Uint32Array(fullPixels.buffer,fullPixels.byteOffset,fullPixels.length);if(fullWords.length!==scenario.width*scenario.height*4)throw Error('Full target must be tightly packed');const fullRecord=await oracle.checkAccuracy({mode,scenario,phase:17,words:fullWords,width:scenario.width,height:scenario.height,rowFlip,metadata:sample.metadata,oracleData:config.oracleData,coordinateContract:'native64-repeat-v1'});assertAccuracyRecord(fullRecord);const binary=new Uint8Array(fullWords.buffer,fullWords.byteOffset,fullWords.byteLength),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',binary)),v=>v.toString(16).padStart(2,'0')).join(''),file=config.backend+'-'+index+'-'+mode+'-full.u32',url=new URL(config.readbackUrl,location.href);url.search=new URLSearchParams({file}).toString();const response=await fetch(url,{method:'POST',headers:{'content-type':'application/octet-stream','x-benchmark-token':config.readbackToken,'x-benchmark-sha256':digest},body:binary});if(!response.ok)throw Error('Owned full readback archive refused: '+await response.text());const archive=await response.json();if(archive.sha256!==digest||archive.bytes!==binary.byteLength||archive.file!=='readbacks/'+file)throw Error('Full readback archive mismatch');sample.fullFrameAccuracy={phase:17,rowFlip,record:fullRecord,wordArchive:archive}
    }
    assertComparable(row.modes['hand-tsl'].metadata,row.modes['native-generated'].metadata)
    if(scenario.shape==='adapter-composed'&&!state['hand-tsl'].first.metadata.composed)throw Error('Declared composition missing actual adapter graph')
    if(config.profile==='metal')for(let repeat=0;repeat<plan.repetitions;repeat++){
     const order=pairedOrder(index,repeat);row.pairedOrder.push(order)
     for(const mode of order){if(now()-start>plan.maximumLeaseMs)throw Error('Lease budget exceeded');const s=state[mode],sample=row.modes[mode];renderer.setRenderTarget(s.rt)
      for(let frame=0;frame<plan.warmupFramesDiscardedPerBlock;frame++){phase.value=plan.accuracyPhases[frame%plan.accuracyPhases.length];s.quad.render(renderer)}await drain(renderer)
      const block={repeat,orderIndex:order.indexOf(mode),discardedWarmupFrames:plan.warmupFramesDiscardedPerBlock,gpuSamples:[]};sample.blocks.push(block)
      let t=now();for(let frame=0;frame<plan.framesPerSubmissionBatch;frame++){phase.value=plan.accuracyPhases[frame%plan.accuracyPhases.length];s.quad.render(renderer)}block.cpuApiSubmissionMs=now()-t;block.cpuApiSubmissionMsPerFrame=block.cpuApiSubmissionMs/plan.framesPerSubmissionBatch
      t=now();await drain(renderer);block.completionDrainWallMs=now()-t
      t=now();const pixels=await renderer.readRenderTargetPixelsAsync(s.rt,0,0,scenario.width,scenario.height);block.readbackWallMs=now()-t;block.readbackBytes=pixels.byteLength
      // GPU queries are a separate diagnostic phase; no per-frame readback is in submission timing.
      for(let q=0;q<plan.gpuQueriesPerBlock;q++){const value=gl&&timer.extension?await webglGpuSample(gl,timer.extension,()=>{for(let frame=0;frame<plan.drawsPerGpuQuery;frame++){phase.value=plan.accuracyPhases[(repeat+q+frame)%plan.accuracyPhases.length];s.quad.render(renderer)}},{timeoutMs:plan.gpuTimerTimeoutMs}):{gpuMs:null,reason:timer.reason};if(value.gpuMs!==null){const consumeStart=now(),consumed=await renderer.readRenderTargetPixelsAsync(s.rt,0,0,scenario.width,scenario.height);value.consumptionReadbackWallMs=now()-consumeStart;value.consumedBytes=consumed.byteLength;sample.gpuSamplesMs.push(value.gpuMs/plan.drawsPerGpuQuery)}block.gpuSamples.push(value)}
     }
    }
    for(const mode of plan.modes){const sample=row.modes[mode];sample.cpuSubmission=sample.blocks.length?distribution(sample.blocks.map(b=>b.cpuApiSubmissionMsPerFrame)):null;sample.completionDrain=sample.blocks.length?distribution(sample.blocks.map(b=>b.completionDrainWallMs)):null;sample.readback=sample.blocks.length?distribution(sample.blocks.map(b=>b.readbackWallMs)):null;sample.gpu=sample.gpuSamplesMs.length?distribution(sample.gpuSamplesMs):null}
    row.decision=performanceDecision({profile:config.profile,accuracyPassed:true,handGpu:row.modes['hand-tsl'].gpuSamplesMs,nativeGpu:row.modes['native-generated'].gpuSamplesMs,plan});row.status='checked'
   }catch(error){row.status='failed-no-comparison';row.error=String(error);row.decision={status:'accuracy-or-execution-failed-no-comparison'};throw error}
   finally{renderer.setRenderTarget(null);for(const s of Object.values(state)){s.m.dispose();s.rt.dispose();s.accuracyTarget.dispose()}for(const item of built.reverse())item.dispose?.()}
  }
  if(result.errors.length)throw Error('Actual shader/device diagnostics')
  result.status='BOUNDED_BENCHMARK_CAPTURE_COMPLETE';return result
 }finally{result.elapsedWallMs=now()-start;inputTextureOwned?.dispose();bridge?.dispose?.();renderer.dispose()}
}
