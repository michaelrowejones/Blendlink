import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {buildSourceCompositor} from '@pixel-compositor'
import {CompositorExactAxes} from '@field-axes'
import {startThreeCompiledScenePreparation} from '@field-runtime'
import {loadSourcePresentation} from '@pixel-source-display'
import {textureLoad,ivec2,uv,vec2} from 'three/tsl'
const AXIS='SceneToWeb exact compositor Uniform axes'
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
const pinned=async(url,pin)=>{const r=await fetch(url);if(!r.ok)throw Error('Missing pinned asset '+url);const bytes=await r.arrayBuffer();if(await hash(bytes)!==pin)throw Error('Pinned bytes changed '+url);return bytes}
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)
window.runWhiteNoiseDefaultFieldProof=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),adapter=wanted==='webgl2'?null:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(wanted==='webgpu'&&!adapter)throw Error('White Noise field proof requires an actual WebGPU adapter')
 const supplied=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:wanted==='webgl2',antialias:false,...(supplied?{device:supplied}:{})});const savedOriginalDispose=renderer.dispose.bind(renderer);await renderer.init();renderer.info.autoReset=false
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2';if(backend!==wanted)throw Error('Requested API fallback')
 const device=renderer.backend.device,gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=adapter?{api:'WebGPU',...Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]]))}:{api:'WebGL2',renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const live=new Set(),allocations=[],uploads=[],errors=[],uncaptured=[],rows=[],negatives=[];let phase='setup',ending=false
 renderer.debug.onShaderError=(g,p)=>errors.push(g.getProgramInfoLog(p));device?.addEventListener('uncapturederror',e=>uncaptured.push(String(e.error)));device?.lost.then(e=>{if(!ending)uncaptured.push('device lost '+e.message)})
 const create=renderer.backend.createTexture.bind(renderer.backend),destroy=renderer.backend.destroyTexture.bind(renderer.backend),upload=renderer.backend.updateTexture.bind(renderer.backend)
 renderer.backend.createTexture=(texture,...args)=>{const value=create(texture,...args);live.add(texture);if(texture.name===AXIS)allocations.push({phase,texture,width:texture.image.width,height:texture.image.height,bytes:texture.image.data.byteLength,renderTarget:!!texture.isRenderTargetTexture});return value}
 renderer.backend.destroyTexture=(texture,...args)=>{const value=destroy(texture,...args);live.delete(texture);return value}
 renderer.backend.updateTexture=(texture,...args)=>{const value=upload(texture,...args);if(texture.name===AXIS)uploads.push({phase,texture,width:texture.image.width,height:texture.image.height,bytes:texture.image.data.byteLength});return value}
 const counts=()=>({axisAllocations:allocations.length,axisUploads:uploads.length}),difference=(a,b)=>({axisAllocations:b.axisAllocations-a.axisAllocations,axisUploads:b.axisUploads-a.axisUploads})
 let target=new THREE.RenderTarget(13,9,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
 const outside=()=>new Set([...live].filter(t=>!target.textures.includes(t))),same=(a,b)=>a.size===b.size&&[...a].every(t=>b.has(t))
 let lastDrawCalls=0
 const draw=action=>new Promise((resolve,reject)=>renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{renderer.setRenderTarget(target);const before=renderer.info.render.drawCalls;action();lastDrawCalls=renderer.info.render.drawCalls-before;resolve(renderer._nodes.nodeFrame.frameId)}catch(e){reject(e)}}).catch(reject))
 const read=async(width,height)=>{const p=await renderer.readRenderTargetPixelsAsync(target,0,0,width,height),pad=Math.ceil(width*16/256)*256/16,stride=p.length===width*height*4?width:backend==='webgpu'&&[4*(pad*(height-1)+width),4*pad*height].includes(p.length)?pad:0;if(!(p instanceof Float32Array)||!stride)throw Error('Actual padded Float32 readback required');const words=new Uint32Array(width*height*4),raw=new Uint32Array(p.buffer,p.byteOffset,p.length);for(let y=0;y<height;y++)words.set(raw.subarray(y*stride*4,(y*stride+width)*4),y*width*4);return words}
 const extent=(entry,installed)=>{renderer.setPixelRatio(entry.pixelRatio);renderer.setSize(entry.width/entry.pixelRatio,entry.height/entry.pixelRatio);target.setSize(entry.width,entry.height);installed?.resize(entry.width/entry.pixelRatio,entry.height/entry.pixelRatio);renderer.setRenderTarget(target)}
 const calibrate=async entry=>{const bytes=await pinned(entry.inputUrl,entry.inputSha256),input=new THREE.DataTexture(new Float32Array(bytes),entry.width,entry.height,THREE.RGBAFormat,THREE.FloatType);input.needsUpdate=true;const material=new NodeMaterial();material.fragmentNode=textureLoad(input,ivec2(uv().mul(vec2(entry.width,entry.height))));try{await draw(()=>new QuadMesh(material).render(renderer));const actual=await read(entry.width,entry.height),expected=new Uint32Array(bytes);const matches=flip=>{for(let y=0;y<entry.height;y++)for(let x=0;x<entry.width;x++)for(let c=0;c<4;c++)if(actual[(y*entry.width+x)*4+c]!==expected[((flip?entry.height-1-y:y)*entry.width+x)*4+c])return false;return true};const a=matches(false),b=matches(true);if(a===b)throw Error('Independent image orientation control failed');return b}finally{material.dispose();input.dispose()}}
 const compare=async(entry,flip)=>{const actual=await read(entry.width,entry.height),expected=new Uint32Array(await pinned(entry.pixelUrl,entry.pixelSha256));let differences=0,worst;for(let y=0;y<entry.height;y++)for(let x=0;x<entry.width;x++)for(let c=0;c<4;c++){const a=actual[(y*entry.width+x)*4+c],b=expected[((flip?entry.height-1-y:y)*entry.width+x)*4+c];if(a!==b){differences++;worst??={x,y,c,actualWord:a,expectedWord:b}}}if(differences)throw Error('White Noise field exact-word gate '+entry.case+' '+differences+' '+JSON.stringify(worst));return{exactWordMismatches:0,contractViolations:0,maxUlps:0,maxAbsoluteError:0,exactControlWords:actual.length,comparedWords:actual.length}}
 let baseline=new Set(),baselineSceneDrawCalls=0
 // A real no-compositor draw establishes the exact renderer-owned DFG cache.
 if(proof.final){const scene=new THREE.Scene(),geo=new THREE.PlaneGeometry(2,2),mat=new THREE.MeshPhysicalMaterial(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=2;scene.add(new THREE.Mesh(geo,mat),new THREE.DirectionalLight(0xffffff,1));renderer.setSize(13,9);await draw(()=>renderer.render(scene,camera));baselineSceneDrawCalls=lastDrawCalls;geo.dispose();mat.dispose();baseline=outside();if(baseline.size>1||[...baseline].some(t=>t.name!=='DFG_LUT'||t.image.width!==16||t.image.height!==16))throw Error('Unknown no-compositor cache')}
 const sceneState=scene=>({children:[...scene.children],background:scene.background,environment:scene.environment}),restored=(scene,before)=>scene.children.length===before.children.length&&scene.children.every((c,i)=>c===before.children[i])&&scene.background===before.background&&scene.environment===before.environment
 try{
  device?.pushErrorScope('validation')
  for(const entry of proof.cases){
   const program=JSON.parse(new TextDecoder().decode(await pinned(entry.programUrl,entry.programSha256)));let descriptor,pinRejected=false
   if(proof.final){
    const manifest=JSON.parse(new TextDecoder().decode(await pinned(entry.manifestUrl,entry.manifestSha256)));await pinned(entry.glbUrl,entry.glbSha256);const bytes=await pinned(entry.presentationUrl,entry.presentationSha256),presentation=JSON.parse(new TextDecoder().decode(bytes));if(bytes.byteLength!==manifest.sourcePresentation.bytes||(await hash(bytes)).slice(0,16)!==manifest.sourcePresentation.hash)throw Error('Actual presentation pin mismatch')
    for(const k of['status','ops','passes','output'])if(canonical(program[k])!==canonical(presentation.compositor[k]))throw Error('Actual Final IR differs '+k)
    try{await loadSourcePresentation({...manifest.sourcePresentation,hash:'0'.repeat(16)})}catch(e){pinRejected=/hash differs/.test(String(e))};if(!pinRejected)throw Error('Bad actual presentation pin accepted')
    const generated=await import(/* @vite-ignore */entry.moduleUrl);descriptor=generated[entry.moduleExport];if(!descriptor?.sourcePresentation)throw Error('Actual generated descriptor missing')
   }
   extent(entry);let rowFlip=await calibrate(entry),built,material,quad,installed,prepared,scene=new THREE.Scene(),installMetrics,meshCount=0
   const installationCycles=[],hostGeometry=new THREE.PlaneGeometry(2,2),hostMaterial=new THREE.MeshBasicMaterial({color:0x204060}),hostMesh=new THREE.Mesh(hostGeometry,hostMaterial),hostCamera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);hostCamera.position.z=2
   let hostBeforeCalls=0,hostAfterCalls=0,hostMaterialDisposals=0;const hostBefore=()=>{hostBeforeCalls++},hostAfter=()=>{hostAfterCalls++};hostMesh.onBeforeRender=hostBefore;hostMesh.onAfterRender=hostAfter;hostMaterial.addEventListener('dispose',()=>hostMaterialDisposals++);scene.add(hostMesh)
   const host=sceneState(scene),rendererRender=renderer.render,rendererObjectFunction=renderer.getRenderObjectFunction?.()
   const assertHost=(allowRendererWrapper=false)=>{if(hostMesh.parent!==scene||hostMesh.geometry!==hostGeometry||hostMesh.material!==hostMaterial||hostMesh.onBeforeRender!==hostBefore||hostMesh.onAfterRender!==hostAfter||hostMaterialDisposals||!allowRendererWrapper&&(renderer.render!==rendererRender||renderer.getRenderObjectFunction?.()!==rendererObjectFunction))throw Error('Caller-owned host material/geometry/render callbacks changed')}
   if(proof.final){await draw(()=>renderer.render(scene,hostCamera));if(!hostBeforeCalls||!hostAfterCalls)throw Error('Caller-owned host callbacks were not exercised')}
   const createOwner=async()=>{
    assertHost()
    if(!proof.final){built=buildSourceCompositor(program,()=>{throw Error('White Noise has no image dependency')});material=new NodeMaterial();material.fragmentNode=built.node;quad=new QuadMesh(material);return}
    const before=counts();phase='preparation';prepared=await startThreeCompiledScenePreparation({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl,viewport:{width:entry.width/entry.pixelRatio,height:entry.height/entry.pixelRatio},onWarning:m=>{throw Error('Production installation warning '+m)}}).promise;assertHost();const afterPreparation=counts();phase='commit';installed=prepared.commit();assertHost(true);const afterCommit=counts();phase='live'
    if(!installed.components.postprocessingOrder.includes('blender-compositor'))throw Error('Actual default install bypassed compositor')
    installed.root.traverse(o=>{if(o.isMesh)meshCount++});if(!meshCount)throw Error('No actual installed mesh')
    installMetrics={preparation:difference(before,afterPreparation),commit:difference(afterPreparation,afterCommit),live:{axisAllocations:0,initialAxisUploads:0},beforeLive:afterCommit}
   }
   const disposeOwner=()=>{if(proof.final){installed?.dispose();prepared?.dispose();installed=prepared=undefined;if(!restored(scene,host))throw Error('Actual install changed host scene after dispose');assertHost();if(installMetrics){if(installMetrics.beforeLive)throw Error('Installation cycle lacks measured live frame');installationCycles.push(installMetrics);installMetrics=undefined}}else{built?.dispose();built?.dispose();material?.dispose();built=material=quad=undefined}}
   const render=async()=>{const frame=await draw(()=>proof.final?installed.render():quad.render(renderer));if(proof.final&&installMetrics?.beforeLive){const observed=difference(installMetrics.beforeLive,counts());installMetrics.live={axisAllocations:observed.axisAllocations,initialAxisUploads:observed.axisUploads};delete installMetrics.beforeLive}return frame}
   await createOwner();phase='live';const startCounts=counts(),animationFrames=[await render()],mismatch=await compare(entry,rowFlip),firstCounts=counts();animationFrames.push(await render());await compare(entry,rowFlip)
   if(uploads.length!==firstCounts.axisUploads)throw Error('Same-extent warm draw uploaded axis data')
   const axis=[...outside()].filter(t=>t.name===AXIS);if(axis.length!==1)throw Error('Active pipeline did not own one shared axis binding')
   const axisIdentity=axis[0];let maximumAxisBytes=axisIdentity.image.data.byteLength;const initialPasses=lastDrawCalls
   const resizeResults=[]
   for(const name of entry.resizeCases){const other=proof.resizeCases.find(r=>r.case===name);if(!other)throw Error('Missing exact native resize reference');extent(other,installed);rowFlip=await calibrate(other);const before=uploads.length;animationFrames.push(await render());const measured=await compare(other,rowFlip),after=uploads.length;animationFrames.push(await render());await compare(other,rowFlip);if(after-before!==1||uploads.length!==after)throw Error('Resize upload census mismatch');const current=[...outside()].filter(t=>t.name===AXIS);if(current.length!==1||current[0]!==axisIdentity)throw Error('Resize replaced shared logical table');maximumAxisBytes=Math.max(maximumAxisBytes,current[0].image.data.byteLength);resizeResults.push({case:name,width:other.width,height:other.height,pixelRatio:other.pixelRatio,...measured,axisUploads:1,repeatUploads:0})}
   extent(entry,installed);rowFlip=await calibrate(entry);await render();await compare(entry,rowFlip)
   if(negatives.length===0){
    const forged=structuredClone(program);forged.ops.find(op=>op.kind==='white-noise-texture').properties.white_noise_model='unknown-field';let profileError;try{buildSourceCompositor(forged,()=>null)}catch(e){profileError=String(e)};if(!profileError?.includes('White Noise'))throw Error('Forged field source accepted');negatives.push({kind:'white-noise-source-profile',error:profileError})
    const refuse=async(kind,change,restore,pattern)=>{change();let error;try{await render()}catch(e){error=String(e)}finally{restore()};if(!error||!pattern.test(error))throw Error('Missing field refusal '+kind+' '+error);negatives.push({kind,error})}
    const beforeInvalid=uploads.length;await refuse('field-invalid-viewport',()=>target.viewport.x=1,()=>target.viewport.x=0,/White Noise.*zero-origin/);await render();await compare(entry,rowFlip)
    await refuse('field-invalid-resize',()=>extent({width:3,height:3,pixelRatio:1},installed),()=>extent(entry,installed),/White Noise.*physical extents/);if(uploads.length!==beforeInvalid)throw Error('Invalid resize uploaded');await render();await compare(entry,rowFlip)
    const constant=structuredClone(program);constant.output={kind:'constant',type:'RGBA',value:[0,0,0,1]};const owner=buildSourceCompositor(constant,()=>null),m=new NodeMaterial();m.fragmentNode=owner.node;const q=new QuadMesh(m);extent({width:3,height:3,pixelRatio:1});let error;try{await draw(()=>q.render(renderer))}catch(e){error=String(e)}finally{owner.dispose();m.dispose();extent(entry,installed)};if(!/White Noise.*physical extents/.test(error))throw Error('Constant terminal lost field guard '+error);negatives.push({kind:'field-constant-terminal-guard',error});await render();await compare(entry,rowFlip)
    await refuse('field-owned-schema',()=>axisIdentity.type=THREE.HalfFloatType,()=>axisIdentity.type=THREE.FloatType,/White Noise.*schema/);await render();await compare(entry,rowFlip)
    await refuse('field-owned-version',()=>axisIdentity.needsUpdate=true,()=>{},/White Noise.*schema/)
   }
   disposeOwner();if(!same(outside(),baseline))throw Error('Disposed owner retained texture identities')
   if(proof.final)for(let cycle=1;cycle<3;cycle++){await createOwner();extent(entry,installed);rowFlip=await calibrate(entry);await render();await compare(entry,rowFlip);disposeOwner();if(!same(outside(),baseline))throw Error('Reapply retained texture identities')}
   if(errors.length||uncaptured.length)throw Error(JSON.stringify({errors,uncaptured}))
   renderer.setRenderTarget(null);target.dispose();const remainingRenderTargets=renderer.info.memory.renderTargets;if(remainingRenderTargets!==0)throw Error('Disposed field owner retained render targets')
   const additionalPortPasses=allocations.slice(startCounts.axisAllocations).filter(row=>row.renderTarget).length;if(additionalPortPasses!==0)throw Error('Axis helper allocated a render target')
   rows.push({case:entry.case,width:entry.width,height:entry.height,pixelRatio:entry.pixelRatio,route:entry.route,...mismatch,rowFlip,resizeFrames:resizeResults.length,resizeResults,animationFrames,axisTableBindings:1,maximumAxisBytes,unchangedExtentUploads:0,additionalPortPasses,passMeasurement:'owned-axis-render-target-allocations',observedFrameDrawCalls:initialPasses,portOwnedTextures:1,remainingRenderTargets,remainingTextures:outside().size,...(proof.final?{pinRejected,meshCount,pipeline:'blender-compositor',sourceMaterialsPreserved:true,ownershipScope:'caller-owned-mesh-material-geometry-and-render-callbacks',hostBeforeCalls,hostAfterCalls,hostIdentityRestored:true,rendererCallbacksRestored:true,lifecycleCycles:3,baselineCacheRestored:true,baselineSceneDrawCalls,baselineCache:[...baseline].map(t=>({name:t.name,width:t.image.width,height:t.image.height})),installer:'startThreeCompiledScenePreparation.commit',...installationCycles[0],installationCycles}: {})})
   scene.remove(hostMesh);hostGeometry.dispose();hostMaterial.dispose()
   target=new THREE.RenderTarget(13,9,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
  }
  // Separate destructive ownership control: no numerical/case credit. Observe
  // the genuine owner while forwarding the original production validator.
  const entry=proof.cases[0],program=JSON.parse(new TextDecoder().decode(await pinned(entry.programUrl,entry.programSha256)))
  extent(entry);const owner=buildSourceCompositor(program,()=>null),material=new NodeMaterial();material.fragmentNode=owner.node
  const originalValidate=CompositorExactAxes.prototype.validate;let axes
  CompositorExactAxes.prototype.validate=function(actual){axes=this;return originalValidate.call(this,actual)}
  try{await draw(()=>new QuadMesh(material).render(renderer))}finally{CompositorExactAxes.prototype.validate=originalValidate}
  if(device)await device.queue.onSubmittedWorkDone();else gl.finish()
  if(!axes)throw Error('Actual SourceCompositor owner was not observed')
  const textures=[...outside()].filter(t=>t.name===AXIS);if(textures.length!==1)throw Error('Saved-dispose control requires one actual axis binding')
  const owned=textures[0],physical=renderer.backend.get(owned),handle=backend==='webgpu'?physical.texture:physical.textureGPU
  let physicalDestroys=0
  if(backend==='webgpu'){const destroy=handle.destroy.bind(handle);handle.destroy=()=>{physicalDestroys++;destroy()}}
  else{const remove=gl.deleteTexture.bind(gl);gl.deleteTexture=value=>{if(value===handle)physicalDestroys++;remove(value)}}
  material.dispose();renderer.setRenderTarget(null);target.dispose();savedOriginalDispose()
  let staleError;try{axes.validate(renderer)}catch(error){staleError=String(error)}
  if(!/White Noise exact axes: (renderer.*epoch|actual available renderer\/device\/context required)/.test(staleError))throw Error('Saved original dispose did not revoke actual owner '+staleError)
  owner.dispose();owner.dispose();if(physicalDestroys!==1)throw Error('Saved original dispose did not destroy owned handle exactly once '+physicalDestroys)
  const savedDispose={error:staleError,physicalDestroys,externalDevice:!!supplied,remainingOwnedTextures:physicalDestroys===1?0:1,idempotentDisposal:true,ownerRoute:'buildSourceCompositor'}
  const validation=await device?.popErrorScope();if(validation)errors.push(validation.message);if(errors.length||uncaptured.length)throw Error(JSON.stringify({errors,uncaptured}))
  return{backend,gpu,rows,negatives,savedDispose,errors,uncaptured}
 }finally{ending=true;renderer.setAnimationLoop(null);renderer.setRenderTarget(null);target.dispose();renderer.dispose();supplied?.destroy()}
}
