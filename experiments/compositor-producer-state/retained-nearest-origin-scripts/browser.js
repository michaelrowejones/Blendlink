/* SPDX-License-Identifier: MIT */
import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {textureLoad,ivec2,uv,vec2,vec4} from 'three/tsl'
import {startThreeCompiledScenePreparation} from '@runtime'
import {ThreeWebgpuPostPipelineService} from '@pipeline'
import {buildSourceCompositor} from '@compositor'
import {statuses,exactMetric,displayMetric,failurePacket} from './browser-contract.mjs'
import {sampleInstalledFrame} from './same-frame.mjs'
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
const pinned=async(url,pin)=>{const response=await fetch(url);if(!response.ok)throw Error('Missing Displace asset '+url);const bytes=await response.arrayBuffer();if(await sha(bytes)!==pin)throw Error('Changed Displace asset '+url);return bytes}
const sameSet=(a,b)=>a.size===b.size&&[...a].every(item=>b.has(item))
const sameWords=(a,b)=>a.length===b.length&&a.every((word,i)=>word===b[i])
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item)
window.runDisplaceProof=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),adapter=wanted==='webgl2'?null:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(wanted==='webgpu'&&!adapter)throw Error('An actual WebGPU adapter is required')
 const device=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:wanted==='webgl2',antialias:false,...device?{device}:{}})
 await renderer.init();renderer.info.autoReset=false;device?.pushErrorScope('validation')
 const savedOriginalDispose=renderer.dispose.bind(renderer)
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2'
 if(backend!==wanted)throw Error('Displace API fallback')
 const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=adapter?{api:'WebGPU',...Object.fromEntries(['vendor','architecture','description','device'].map(k=>[k,adapter.info[k]]))}:{api:'WebGL2',renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 const errors=[],uncaptured=[],rows=[],controls=[],hostGeometryControls=[],live=new Set(),allocations=[],destructions=[]
 let ending=false,rowFlip=false,activePipeline,failureFrame
 const remember=(role,words)=>{if(failureFrame)failureFrame.buffers.push({role,words})}
 renderer.debug.onShaderError=(context,p)=>errors.push(context.getProgramInfoLog(p))
 device?.addEventListener('uncapturederror',event=>uncaptured.push(String(event.error)))
 device?.lost.then(info=>{if(!ending)uncaptured.push('Device lost '+info.message)})
 const create=renderer.backend.createTexture.bind(renderer.backend),destroy=renderer.backend.destroyTexture.bind(renderer.backend)
 renderer.backend.createTexture=(texture,...args)=>{const value=create(texture,...args);live.add(texture);allocations.push({texture,width:texture.image?.width??0,height:texture.image?.height??0});return value}
 renderer.backend.destroyTexture=(texture,...args)=>{const value=destroy(texture,...args);live.delete(texture);destructions.push(texture);return value}
 // Observe the REAL factory result used by the public installer; never replace
 // its pipeline, resolver, scene pass, shader, lifecycle, or source presentation.
 const actualCreate=ThreeWebgpuPostPipelineService.create
 ThreeWebgpuPostPipelineService.create=async function(...args){const result=await actualCreate.apply(this,args);activePipeline=result;return result}
 const target=(width,height,type=THREE.FloatType)=>{const value=new THREE.RenderTarget(width,height,{type,depthBuffer:false});value.texture.colorSpace=THREE.NoColorSpace;return value}
 const output=target(13,9),warm=target(13,9,THREE.HalfFloatType)
 const outside=()=>new Set([...live].filter(t=>!output.textures.includes(t)&&!warm.textures.includes(t)))
 const extent=frame=>{renderer.setPixelRatio(frame.pixelRatio);renderer.setSize(frame.width/frame.pixelRatio,frame.height/frame.pixelRatio);output.setSize(frame.width,frame.height);renderer.setRenderTarget(output)}
 const frame=draw=>new Promise((resolve,reject)=>renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{const before=renderer.info.render.drawCalls;draw();resolve({frame:renderer._nodes.nodeFrame.frameId,draws:renderer.info.render.drawCalls-before})}catch(error){reject(error)}}).catch(reject))
 const material=node=>{const value=new NodeMaterial();value.fragmentNode=node;value.blending=THREE.NoBlending;return value}
 const drawNode=async node=>{const m=material(node);try{return await frame(()=>new QuadMesh(m).render(renderer))}finally{m.dispose()}}
 const probeNode=node=>{const m=material(node);try{const before=renderer.info.render.drawCalls;new QuadMesh(m).render(renderer);return renderer.info.render.drawCalls-before}finally{m.dispose()}}
 const load=(node,w,h)=>textureLoad(node,ivec2(uv().mul(vec2(w,h))))
 const read=async(w,h)=>{
  const pixels=await renderer.readRenderTargetPixelsAsync(output,0,0,w,h),padded=Math.ceil(w*16/256)*256/16,stride=pixels.length===w*h*4?w:backend==='webgpu'&&[4*(padded*(h-1)+w),4*padded*h].includes(pixels.length)?padded:0
  if(!(pixels instanceof Float32Array)||!stride)throw Error('Expected padded RGBA32F readback')
  const words=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length),result=new Uint32Array(w*h*4)
  for(let y=0;y<h;y++)result.set(words.subarray(y*stride*4,(y*stride+w)*4),(rowFlip?h-1-y:y)*w*4)
  return result
 }
 const snapshot=scene=>({children:[...scene.children],background:scene.background,backgroundNode:scene.backgroundNode,environment:scene.environment,backgroundIntensity:scene.backgroundIntensity,backgroundBlurriness:scene.backgroundBlurriness,environmentIntensity:scene.environmentIntensity,clearAlpha:renderer.getClearAlpha(),clearColor:renderer.getClearColor(new THREE.Color()).toArray()})
 const restored=(scene,before)=>Object.entries(before).every(([key,value])=>key==='children'?scene.children.length===value.length&&scene.children.every((child,i)=>child===value[i]):key==='clearAlpha'?renderer.getClearAlpha()===value:key==='clearColor'?canonical(renderer.getClearColor(new THREE.Color()).toArray())===canonical(value):scene[key]===value)
 const rendererSnapshot=()=>({target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),viewport:renderer.getViewport(new THREE.Vector4()).toArray(),scissor:renderer.getScissor(new THREE.Vector4()).toArray(),scissorTest:renderer.getScissorTest(),autoClear:renderer.autoClear})
 const sameRenderer=(a,b)=>Object.keys(a).every(k=>Array.isArray(a[k])?canonical(a[k])===canonical(b[k]):a[k]===b[k])
 const sourceSnapshot=installed=>{const values=[];installed.root.traverse(object=>{if(object.isMesh)values.push({object,material:object.material,before:object.onBeforeRender,after:object.onAfterRender,geometry:object.geometry})});return values}
 const sourceRestored=values=>values.every(v=>v.object.material===v.material&&v.object.onBeforeRender===v.before&&v.object.onAfterRender===v.after&&v.object.geometry===v.geometry)
 renderer.setPixelRatio(1);renderer.setSize(13,9);renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const describe=texture=>({name:texture.name,width:texture.image?.width,height:texture.image?.height,type:texture.type,format:texture.format,depth:!!texture.isDepthTexture})
 let baseline,baselineGeometry
 const assertBaseline=scene=>{const actual=outside(),expectedGeometry=scene?hostRecords.get(scene).warmedBaseline:baselineGeometry;if(renderer.info.memory.geometries!==expectedGeometry)throw Error('Displace retained geometry after disposal');if(!sameSet(actual,baseline))throw Error('Displace texture identities not restored '+JSON.stringify({actual:[...actual].map(describe),expected:[...baseline].map(describe)}))}
 const hostRecords=new WeakMap()
 const hostIntact=scene=>{const record=hostRecords.get(scene);return !record||(record.mesh.material===record.material&&record.mesh.geometry===record.geometry&&record.mesh.onBeforeRender===record.before&&record.mesh.onAfterRender===record.after&&record.disposals===0)}
 const makeHost=async label=>{
  const scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(1,1),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material)
  const record={mesh,geometry,material,disposals:0,geometryDisposals:0,materialDisposals:0,beforeCalls:0,afterCalls:0}
  const before=()=>{record.beforeCalls++},after=()=>{record.afterCalls++};Object.assign(record,{before,after})
  mesh.name='Caller-owned mesh';mesh.position.x=1000;mesh.onBeforeRender=before;mesh.onAfterRender=after;scene.add(mesh)
  geometry.addEventListener('dispose',()=>{record.disposals++;record.geometryDisposals++});material.addEventListener('dispose',()=>{record.disposals++;record.materialDisposals++})
  hostRecords.set(scene,record)
  // Initialize the actual caller asset independently, before any preparation.
  // The existing shared Quad cache is already warm; caller geometry is neither
  // an installation leak nor an asset the installer is permitted to destroy.
  const manager=renderer._geometries,registered=manager._geometryDisposeListeners.has(geometry),beforeCount=renderer.info.memory.geometries
  if(registered||beforeCount!==baselineGeometry)throw Error('Caller geometry was not independently cold at shared baseline')
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.set(1000,0,2)
  const previous=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel()
  try{renderer.setRenderTarget(warm);await frame(()=>renderer.render(scene,camera))}finally{renderer.setRenderTarget(previous,face,mip)}
  record.warmedBaseline=renderer.info.memory.geometries
  if(record.warmedBaseline!==baselineGeometry+1||!manager._geometryDisposeListeners.has(geometry)||record.beforeCalls<1||record.afterCalls<1||!sameSet(outside(),baseline))throw Error('Independent caller geometry warm-up changed an unexpected resource')
  record.proof={case:label,geometryId:geometry.id,geometryUuid:geometry.uuid,sharedBaseline:baselineGeometry,warmedBaseline:record.warmedBaseline,registeredBeforeWarm:false,registeredAfterWarm:true,warmBeforeCalls:record.beforeCalls,warmAfterCalls:record.afterCalls,cycles:[]}
  hostGeometryControls.push(record.proof);return scene
 }
 const observeHostCycle=(scene,cycle)=>{
  const record=hostRecords.get(scene);assertBaseline(scene)
  if(!hostIntact(scene)||!renderer._geometries._geometryDisposeListeners.has(record.geometry))throw Error('Installer changed caller geometry ownership')
  record.proof.cycles.push({cycle,geometryId:record.mesh.geometry.id,geometries:renderer.info.memory.geometries,geometryDisposals:record.geometryDisposals,materialDisposals:record.materialDisposals,sameGeometry:record.mesh.geometry===record.geometry,registered:true})
 }
 const cleanupHost=scene=>{
  if(!hostIntact(scene))throw Error('Caller geometry/material/callback ownership changed')
  const record=hostRecords.get(scene);record.geometry.dispose();record.material.dispose();assertBaseline()
  Object.assign(record.proof,{geometryDisposals:record.geometryDisposals,materialDisposals:record.materialDisposals,afterCallerCleanup:renderer.info.memory.geometries,registeredAfterCleanup:renderer._geometries._geometryDisposeListeners.has(record.geometry)})
  if(record.geometryDisposals!==1||record.materialDisposals!==1||record.proof.registeredAfterCleanup)throw Error('Caller fixture failed to retire its own geometry/material')
 }
 const prepare=async(entry,scene)=>{
  const module=await import(/* @vite-ignore */entry.moduleUrl),descriptor=module[entry.moduleExport]
  if(!descriptor?.sourcePresentation)throw Error('Actual generated Final descriptor missing')
  const before=snapshot(scene),rendererBefore=rendererSnapshot();activePipeline=undefined
  const task=startThreeCompiledScenePreparation({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl,prewarm:true,onWarning:message=>{throw Error('Displace fallback '+message)}})
  const prepared=await task.promise
  if(!restored(scene,before)||!sameRenderer(rendererBefore,rendererSnapshot()))throw Error('Detached preparation changed caller ownership')
  const beforeDraws=renderer.info.render.drawCalls,installed=prepared.commit(),commitDraws=renderer.info.render.drawCalls-beforeDraws,pipeline=activePipeline
  const expected=JSON.parse(new TextDecoder().decode(await pinned(entry.presentationUrl,entry.presentationSha256)))
  if(canonical(pipeline?.options?.sourcePresentation?.compositor)!==canonical(expected.compositor))throw Error('Actual public pipeline installed different source IR')
  if(commitDraws!==0||!pipeline?.sourceCompositor||!pipeline.scenePass||!installed.components.postprocessingOrder.includes('blender-compositor')||!installed.components.postprocessingOrder.includes('blender-display-transform'))throw Error('Actual default Final did not install Displace/display')
  return{task,prepared,installed,pipeline,before,commitDraws}
 }
 try{
  // Independent data orientation and real renderer PBR-cache controls.
  const input=new Float32Array(13*9*4);for(let i=0;i<input.length;i++)input[i]=i/1024
  const data=new THREE.DataTexture(input,13,9,THREE.RGBAFormat,THREE.FloatType);data.needsUpdate=true
  renderer.setRenderTarget(output);await drawNode(load(data,13,9))
  if(!sameWords(await read(13,9),new Uint32Array(input.buffer))){rowFlip=true;if(!sameWords(await read(13,9),new Uint32Array(input.buffer)))throw Error('Independent row orientation failed')}
  data.dispose()
  const cacheScene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2,2),pbr=new THREE.MeshPhysicalMaterial(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10)
  camera.position.z=2;cacheScene.add(new THREE.Mesh(geometry,pbr),new THREE.DirectionalLight(0xffffff,1));renderer.setRenderTarget(warm);await frame(()=>renderer.render(cacheScene,camera));geometry.dispose();pbr.dispose()
  baseline=outside();baselineGeometry=renderer.info.memory.geometries;if(baseline.size>1||[...baseline].some(t=>t.name!=='DFG_LUT'||t.image?.width!==16||t.image?.height!==16))throw Error('Unexpected actual no-Displace baseline '+JSON.stringify([...baseline].map(describe)))
  for(const entry of proof.sources){
   const bytes=await pinned(entry.presentationUrl,entry.presentationSha256),presentation=JSON.parse(new TextDecoder().decode(bytes)),program=presentation.compositor,originalProgram=canonical(program)
   if(presentation.display.view!=='Raw'||presentation.display.ops.length||program.ops.find(op=>op.source.nodeType==='CompositorNodeDisplace')?.properties.displace_model!=='native-displace-single-domain-cpu-53-v1')throw Error('Wrong actual saved Displace source')
   const scene=await makeHost(entry.case),byId=new Map()
   const cycles=proof.phase==='baseline'?1:3
   for(let cycle=0;cycle<cycles;cycle++){
    extent(entry.frames[0]);const owner=await prepare(entry,scene),source=sourceSnapshot(owner.installed)
    try{
     for(const size of entry.frames){
      const {width:w,height:h,pixelRatio:dpr}=size,id=[proof.profile,backend,entry.case,w+'x'+h+'@'+dpr].join('--')
      failureFrame={id,case:entry.case,width:w,height:h,pixelRatio:dpr,cycle,buffers:[]}
      extent(size);owner.installed.resize(w/dpr,h/dpr);renderer.setRenderTarget(output)
      await drawNode(load(owner.pipeline.scenePass.getTextureNode(),w,h));const input=await read(w,h);remember('actual-input',input)
      if(owner.pipeline.scenePass.renderTarget.texture.type!==THREE.HalfFloatType||owner.pipeline.scenePass.renderTarget.samples!==0)throw Error('Actual installed scene-pass precision/MSAA drift')
      await drawNode(load(owner.pipeline.scenePass.getTextureNode(),w,h));const repeatedInput=await read(w,h);remember('repeated-input',repeatedInput);if(!sameWords(input,repeatedInput))throw Error('Actual installed input frame is not stable')
      if(!sourceRestored(source))throw Error('Source materials/geometry/callbacks changed during frame')
      if(proof.phase==='baseline'){
       rows.push({id,case:entry.case,...size,scenePassType:'HalfFloatType',scenePassSamples:0,baselinePixels:Array.from(input),baselineWords:input.length,sourcePreserved:true,installedProgramPreserved:true,hostRestored:true,textureBaselineRestored:true})
       continue
      }
      const reference=proof.references.find(row=>row.id===id);if(!reference)throw Error('Missing exact native frame '+id)
      const expectedInput=new Uint32Array(await pinned(reference.baselineUrl,reference.baselineSha256)),linear=new Uint32Array(await pinned(reference.linearUrl,reference.linearSha256)),display=new Uint32Array(await pinned(reference.displayUrl,reference.displaySha256))
      if(!sameWords(input,expectedInput))throw Error('Fresh actual Final input drift '+id)
      let row=byId.get(id)
      if(!row){
       const direct=buildSourceCompositor(program,()=>owner.pipeline.scenePass.getTextureNode(),{resolvePassExtent:()=>[w,h]})
       let got;try{await drawNode(direct.node);got=await read(w,h);remember('direct',got)}finally{direct.dispose()}
       const metric={...exactMetric(got,linear),sha256:await sha(got.buffer)}
       if(metric.wordDifferences)throw Error('Direct Displace/native mismatch '+id+' '+JSON.stringify(metric))
       row={id,case:entry.case,...size,scenePassType:'HalfFloatType',scenePassSamples:0,baselineStable:true,sourcePreserved:true,installedProgramPreserved:true,hostRestored:true,textureBaselineRestored:true,direct:metric,cycles:[],buffers:[{role:'direct',words:Array.from(got)}]};byId.set(id,row)
      }
      const sample=()=>sampleInstalledFrame({frame,render:()=>owner.installed.render(),read:()=>read(w,h),probe:()=>probeNode(owner.pipeline.sourceCompositor.node),frameId:()=>renderer._nodes.nodeFrame.frameId,drawCalls:()=>renderer.info.render.drawCalls})
      const {installedDraw,display:actualDisplay,linear:actualLinear,probeDraws,probeFrame}=await sample();remember('display-'+cycle,actualDisplay);remember('installed-'+cycle,actualLinear)
      const {installedDraw:repeatedDraw,display:repeatedDisplay,linear:repeatedLinear,probeDraws:repeatedProbeDraws,probeFrame:repeatedProbeFrame}=await sample();remember('repeatedDisplay-'+cycle,repeatedDisplay);remember('repeated-'+cycle,repeatedLinear)
      const measured={cycle,commitDraws:owner.commitDraws,preparationHostRestored:true,sourceMaterialsPreserved:sourceRestored(source),textureBaselineRestored:true,installed:{...exactMetric(actualLinear,linear),sha256:await sha(actualLinear.buffer)},repeated:{...exactMetric(repeatedLinear,linear),sha256:await sha(repeatedLinear.buffer)},display:{...displayMetric(actualDisplay,display),sha256:await sha(actualDisplay.buffer)},repeatedDisplay:{...displayMetric(repeatedDisplay,display),sha256:await sha(repeatedDisplay.buffer)},installedDraws:installedDraw.draws,repeatedDraws:repeatedDraw.draws,probeDraws,repeatedProbeDraws,installedFrame:installedDraw.frame,repeatedFrame:repeatedDraw.frame,probeFrame,repeatedProbeFrame}
      if(installedDraw.draws>16||repeatedDraw.draws>16||probeDraws!==(entry.source==='render-layer'?2:1)||repeatedProbeDraws!==(entry.source==='render-layer'?2:1)||probeFrame!==installedDraw.frame||repeatedProbeFrame!==repeatedDraw.frame)throw Error('Actual Displace pass budget or same-frame probe changed '+JSON.stringify(measured))
      if(measured.installed.wordDifferences||measured.repeated.wordDifferences||!measured.display.projectionAccepted||!measured.repeatedDisplay.projectionAccepted)throw Error('Actual installed Displace/native mismatch '+id+' '+JSON.stringify(measured))
      row.cycles.push(measured)
      for(const[role,words]of Object.entries({installed:actualLinear,repeated:repeatedLinear,display:actualDisplay,repeatedDisplay}))row.buffers.push({role:role+'-'+cycle,words:Array.from(words)})
     }
    }finally{owner.installed.dispose();owner.prepared.dispose();owner.installed.dispose();if(!restored(scene,owner.before)||!hostIntact(scene))throw Error('Public installer failed caller restoration');observeHostCycle(scene,cycle)}
    if(canonical(program)!==originalProgram)throw Error('Published source IR mutated')
   }
   if(proof.phase==='compare')rows.push(...byId.values());cleanupHost(scene)
  }
  failureFrame=undefined
  if(false){
   const entry=proof.sources.find(row=>row.source==='render-layer'&&row.setting==='fractional'),presentation=JSON.parse(new TextDecoder().decode(await pinned(entry.presentationUrl,entry.presentationSha256))),program=presentation.compositor
   // Guard-only producer control: a constant resolver is deliberately not
   // numerical/native-source credit. It tests callback retention before RTTs.
   for(const kind of['pixel-budget-before-rtt','mismatched-target','offset-target','scissor-target']){
    extent(entry.frames[0]);const owner=buildSourceCompositor(program,()=>vec4(.25,.5,1,1),{resolvePassExtent:(_pass,r)=>{const s=r.getDrawingBufferSize(new THREE.Vector2());return[s.x,s.y]}})
    const createdAt=allocations.length
    if(kind==='pixel-budget-before-rtt')renderer.setSize(2049,2048)
    else if(kind==='mismatched-target')output.setSize(12,9)
    else if(kind==='offset-target')output.viewport.x=1
    else output.scissorTest=true
    let error;try{await drawNode(owner.node)}catch(reason){error=String(reason)}
    const grewPastBudget=allocations.slice(createdAt).some(row=>row.width*row.height>4194304)
    if(!/Displace.*(pixel budget|full-frame|zero-origin)/i.test(error)||grewPastBudget)throw Error('Displace guard was lost or allocated past budget '+JSON.stringify({kind,error,grewPastBudget}))
    output.viewport.set(0,0,13,9);output.scissorTest=false;extent(entry.frames[0]);await drawNode(owner.node);owner.dispose();owner.dispose();assertBaseline()
    controls.push({case:kind,passed:true,error,hostRestored:true,textureBaselineRestored:true,allocationPastPixelBudget:false,recovered:true,numericalCredit:0})
   }
   const scene=await makeHost('detached-cancellation');extent(entry.frames[0]);const generated=await import(/* @vite-ignore */entry.moduleUrl),descriptor=generated[entry.moduleExport],before=snapshot(scene)
   const detached=await startThreeCompiledScenePreparation({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl,prewarm:true}).promise
   detached.dispose();detached.dispose();if(!restored(scene,before))throw Error('Detached disposal changed caller');observeHostCycle(scene,0);controls.push({case:'detached-dispose',passed:true,hostRestored:true,textureBaselineRestored:true})
   const task=startThreeCompiledScenePreparation({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl,prewarm:true});task.cancel();task.cancel();let cancelled
   try{await task.promise}catch(reason){cancelled=reason}
   if(cancelled?.name!=='AbortError'||!restored(scene,before))throw Error('Cancellation accepted a Ready scene or changed caller');observeHostCycle(scene,1);controls.push({case:'cancel-before-ready',passed:true,hostRestored:true,textureBaselineRestored:true});cleanupHost(scene)
   // Actual resources, original saved renderer.dispose, then the genuine
   // retained root validator: no new draw on an already-disposed renderer.
   const owner=buildSourceCompositor(program,()=>vec4(.25,.5,1,1),{resolvePassExtent:()=>[13,9]})
   extent(entry.frames[0]);await drawNode(owner.node)
   const owned=[...outside()].filter(texture=>!baseline.has(texture))
   if(owned.length!==3)throw Error('Fractional Displace must realize one RTT and two mapping tables')
   const counts=owned.map(()=>0),handles=owned.map(texture=>{if(!renderer.backend.has(texture))throw Error('Missing actual owned physical texture');const physical=renderer.backend.get(texture);return backend==='webgpu'?physical.texture:physical.textureGPU})
   if(handles.some(handle=>!handle)||new Set(handles).size!==3)throw Error('Saved-dispose physical handle census changed')
   if(backend==='webgpu')handles.forEach((handle,index)=>{const original=handle.destroy.bind(handle);handle.destroy=()=>{counts[index]++;original()}})
   else{const original=gl.deleteTexture.bind(gl);gl.deleteTexture=handle=>{const index=handles.indexOf(handle);if(index>=0)counts[index]++;original(handle)}}
   renderer.setRenderTarget(null);output.dispose();warm.dispose();ending=true;savedOriginalDispose()
   let error;try{owner.node.update({renderer})}catch(reason){error=String(reason)}
   owner.dispose();owner.dispose()
   if(!/Displace.*(?:available renderer\/device\/context|allocation epoch changed)/.test(error)||counts.some(count=>count!==1))throw Error('Saved renderer disposal lost ownership/refusal '+JSON.stringify({error,counts}))
   controls.push({case:'saved-original-dispose',passed:true,error,ownedTextures:3,physicalDestroys:counts,hostRestored:true,textureBaselineRestored:true})
   const order=['pixel-budget-before-rtt','mismatched-target','offset-target','scissor-target','saved-original-dispose','detached-dispose','cancel-before-ready'];controls.sort((a,b)=>order.indexOf(a.case)-order.indexOf(b.case))
  }
  if(device){await device.queue.onSubmittedWorkDone();const validation=await device.popErrorScope();if(validation)errors.push(validation.message)}
  if(errors.length||uncaptured.length)throw Error(JSON.stringify({errors,uncaptured}))
  return{status:proof.phase==='baseline'?statuses.baseline:statuses.browser,phase:proof.phase,profile:proof.profile,backend,gpu,rows,controls,hostGeometryControls,errors,uncaptured,supportCredit:0}
 }catch(error){return failurePacket(error,{phase:proof.phase,profile:proof.profile,backend,gpu,rows,controls,hostGeometryControls,errors,uncaptured},failureFrame)}finally{ThreeWebgpuPostPipelineService.create=actualCreate;ending=true;renderer.setAnimationLoop(null);renderer.setRenderTarget(null);output.dispose();warm.dispose();renderer.dispose();device?.destroy()}
}
