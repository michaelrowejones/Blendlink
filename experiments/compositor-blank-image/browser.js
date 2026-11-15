import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {buildSourceCompositor} from '@pixel-compositor'
import {ThreeWebgpuPostPipelineService} from '@blank-pipeline'
import {startThreeCompiledScenePreparation} from '@field-runtime'
import {loadSourcePresentation} from '@pixel-source-display'
import {textureLoad,ivec2,uv,vec2} from 'three/tsl'
const isRow=t=>t.isDataTexture&&t.image?.width===256&&t.image?.height===32&&t.image?.data instanceof Float32Array&&t.image.data.length===32768
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
const pinned=async(url,pin)=>{const r=await fetch(url);if(!r.ok)throw Error('Missing pinned asset '+url);const bytes=await r.arrayBuffer();if(await hash(bytes)!==pin)throw Error('Pinned bytes changed '+url);return bytes}
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)
window.runBlankImageProof=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),adapter=wanted==='webgl2'?null:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(wanted==='webgpu'&&!adapter)throw Error('Blank Image proof requires an actual WebGPU adapter')
 const supplied=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:wanted==='webgl2',antialias:false,...(supplied?{device:supplied}:{})});const savedOriginalDispose=renderer.dispose.bind(renderer);await renderer.init();renderer.info.autoReset=false
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2';if(backend!==wanted)throw Error('Requested API fallback')
 const device=renderer.backend.device,gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=adapter?{api:'WebGPU',...Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]]))}:{api:'WebGL2',renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const live=new Set(),allUploads=new WeakMap(),allocations=[],uploads=[],errors=[],uncaptured=[],rows=[],negatives=[];let phase='setup',ending=false
 renderer.debug.onShaderError=(g,p)=>errors.push(g.getProgramInfoLog(p));device?.addEventListener('uncapturederror',e=>uncaptured.push(String(e.error)));device?.lost.then(e=>{if(!ending)uncaptured.push('device lost '+e.message)})
 const create=renderer.backend.createTexture.bind(renderer.backend),destroy=renderer.backend.destroyTexture.bind(renderer.backend),upload=renderer.backend.updateTexture.bind(renderer.backend)
 renderer.backend.createTexture=(texture,...args)=>{const value=create(texture,...args);live.add(texture);if(isRow(texture))allocations.push({phase,texture,width:texture.image.width,height:texture.image.height,bytes:texture.image.data.byteLength,renderTarget:!!texture.isRenderTargetTexture});return value}
 renderer.backend.destroyTexture=(texture,...args)=>{const value=destroy(texture,...args);live.delete(texture);return value}
 renderer.backend.updateTexture=(texture,...args)=>{const value=upload(texture,...args);allUploads.set(texture,(allUploads.get(texture)??0)+1);if(isRow(texture))uploads.push({phase,texture,width:texture.image.width,height:texture.image.height,bytes:texture.image.data.byteLength});return value}
 const counts=()=>({rowAllocations:allocations.length,rowUploads:uploads.length}),difference=(a,b)=>({rowAllocations:b.rowAllocations-a.rowAllocations,rowUploads:b.rowUploads-a.rowUploads})
 let target=new THREE.RenderTarget(13,9,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
 const outside=()=>new Set([...live].filter(t=>!target.textures.includes(t))),same=(a,b)=>a.size===b.size&&[...a].every(t=>b.has(t))
 let lastDrawCalls=0
 const draw=action=>new Promise((resolve,reject)=>renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{renderer.setRenderTarget(target);const before=renderer.info.render.drawCalls;action();lastDrawCalls=renderer.info.render.drawCalls-before;resolve(renderer._nodes.nodeFrame.frameId)}catch(e){reject(e)}}).catch(reject))
 const read=async(width,height)=>{const p=await renderer.readRenderTargetPixelsAsync(target,0,0,width,height),pad=Math.ceil(width*16/256)*256/16,stride=p.length===width*height*4?width:backend==='webgpu'&&[4*(pad*(height-1)+width),4*pad*height].includes(p.length)?pad:0;if(!(p instanceof Float32Array)||!stride)throw Error('Actual padded Float32 readback required');const words=new Uint32Array(width*height*4),raw=new Uint32Array(p.buffer,p.byteOffset,p.length);for(let y=0;y<height;y++)words.set(raw.subarray(y*stride*4,(y*stride+width)*4),y*width*4);return words}
 const extent=(entry,installed)=>{renderer.setPixelRatio(entry.pixelRatio);renderer.setSize(entry.width/entry.pixelRatio,entry.height/entry.pixelRatio);target.setSize(entry.width,entry.height);installed?.resize(entry.width/entry.pixelRatio,entry.height/entry.pixelRatio);renderer.setRenderTarget(target)}
 const calibrate=async entry=>{const bytes=await pinned(entry.inputUrl,entry.inputSha256),input=new THREE.DataTexture(new Float32Array(bytes),entry.width,entry.height,THREE.RGBAFormat,THREE.FloatType);input.needsUpdate=true;const material=new NodeMaterial();material.fragmentNode=textureLoad(input,ivec2(uv().mul(vec2(entry.width,entry.height))));material.blending=THREE.NoBlending;try{await draw(()=>new QuadMesh(material).render(renderer));const actual=await read(entry.width,entry.height),expected=new Uint32Array(bytes);const matches=flip=>{for(let y=0;y<entry.height;y++)for(let x=0;x<entry.width;x++)for(let c=0;c<4;c++)if(actual[(y*entry.width+x)*4+c]!==expected[((flip?entry.height-1-y:y)*entry.width+x)*4+c])return false;return true};const a=matches(false),b=matches(true);if(a===b)throw Error('Independent image orientation control failed');return b}finally{material.dispose();input.dispose()}}
 const failureSnapshot={backend,gpu,rows,negatives,activeCase:null,activeSamples:[],currentComparison:null};window.blankImageFailureSnapshot=failureSnapshot
 let installedPipeline,activeSamples,activeCycle=0
 const projection=(got,expected)=>{const a=new Float32Array(got.buffer),b=new Float32Array(expected.buffer);let wordDifferences=0,maxAbsoluteError=0,alphaWordDifferences=0,nonfiniteClassDifferences=0,maxClampedAbsoluteError=0;for(let i=0;i<got.length;i++){if(got[i]!==expected[i])wordDifferences++;if(i%4===3){if(got[i]!==expected[i])alphaWordDifferences++;continue}if(Number.isFinite(a[i])!==Number.isFinite(b[i]))nonfiniteClassDifferences++;maxAbsoluteError=Math.max(maxAbsoluteError,Math.abs(a[i]-b[i]));maxClampedAbsoluteError=Math.max(maxClampedAbsoluteError,Math.abs(Math.min(1,Math.max(0,a[i]))-Math.min(1,Math.max(0,b[i]))))}return{words:got.length,wordDifferences,maxAbsoluteError,alphaWordDifferences,nonfiniteClassDifferences,maxClampedAbsoluteError,contract:'existing-ocio-png-clamp01-3e-5'}}
 const compare=async(entry,flip,record=true)=>{
  const expected=new Uint32Array(await pinned(entry.pixelUrl,entry.pixelSha256));let displayAudit,displayWords
  if(proof.final){const display=await read(entry.width,entry.height),oriented=new Uint32Array(display.length);for(let y=0;y<entry.height;y++)oriented.set(display.subarray(y*entry.width*4,(y+1)*entry.width*4),(flip?entry.height-1-y:y)*entry.width*4);displayWords=oriented;displayAudit=projection(oriented,expected);failureSnapshot.currentComparison={case:entry.case,stage:'display',displayWords:Array.from(oriented),pixelSha256:entry.pixelSha256,displayAudit};if(displayAudit.alphaWordDifferences||displayAudit.nonfiniteClassDifferences||displayAudit.maxClampedAbsoluteError>3e-5)throw Error('Blank Raw display audit failed '+entry.case+' '+JSON.stringify(displayAudit));const node=installedPipeline?.sourceCompositor?.node;if(!node)throw Error('Actual public installed compositor node unavailable');const material=new NodeMaterial();material.fragmentNode=node;material.blending=THREE.NoBlending;try{new QuadMesh(material).render(renderer)}finally{material.dispose()}}
  const actual=await read(entry.width,entry.height),oriented=new Uint32Array(actual.length);for(let y=0;y<entry.height;y++)oriented.set(actual.subarray(y*entry.width*4,(y+1)*entry.width*4),(flip?entry.height-1-y:y)*entry.width*4)
  let differences=0,worst;for(let i=0;i<actual.length;i++)if(oriented[i]!==expected[i]){differences++;worst??={index:i,actualWord:oriented[i],expectedWord:expected[i]}}
  failureSnapshot.currentComparison={case:entry.case,stage:'linear',words:Array.from(oriented),...(displayWords?{displayWords:Array.from(displayWords)}:{}),pixelSha256:entry.pixelSha256,exactWordMismatches:differences,displayAudit}
  if(differences)throw Error('Blank Image exact-word gate '+entry.case+' '+differences+' '+JSON.stringify(worst))
  if(record)activeSamples.push({index:activeSamples.length,case:entry.case,cycle:activeCycle,words:Array.from(oriented),...(displayWords?{displayWords:Array.from(displayWords)}:{}),exactWordMismatches:0,displayAudit})
  return{exactWordMismatches:0,contractViolations:0,maxUlps:0,maxAbsoluteError:0,exactControlWords:actual.length,comparedWords:actual.length,displayAudit}
 }
 let observedPipeline
 const createPipeline=ThreeWebgpuPostPipelineService.create
 ThreeWebgpuPostPipelineService.create=async function(...args){const pipeline=await createPipeline.apply(this,args);observedPipeline=pipeline;return pipeline}

 let baseline=new Set(),baselineSceneDrawCalls=0
 // A real no-compositor draw establishes the exact renderer-owned DFG cache.
 if(proof.final){const scene=new THREE.Scene(),geo=new THREE.PlaneGeometry(2,2),mat=new THREE.MeshPhysicalMaterial(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=2;scene.add(new THREE.Mesh(geo,mat),new THREE.DirectionalLight(0xffffff,1));renderer.setSize(13,9);await draw(()=>renderer.render(scene,camera));baselineSceneDrawCalls=lastDrawCalls;geo.dispose();mat.dispose();baseline=outside();if(baseline.size>1||[...baseline].some(t=>t.name!=='DFG_LUT'||t.image.width!==16||t.image.height!==16))throw Error('Unknown no-compositor cache')}
 const ownershipKeys=['background','environment','backgroundNode','environmentNode','backgroundIntensity','environmentIntensity','backgroundBlurriness']
 const sceneState=scene=>({children:[...scene.children],...Object.fromEntries(ownershipKeys.map(key=>[key,scene[key]]))}),restored=(scene,before)=>scene.children.length===before.children.length&&scene.children.every((c,i)=>c===before.children[i])&&ownershipKeys.every(key=>scene[key]===before[key])
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
   activeSamples=[];activeCycle=0;failureSnapshot.activeCase=entry.case;failureSnapshot.activeSamples=activeSamples;failureSnapshot.currentComparison=null;extent(entry);let rowFlip=await calibrate(entry),built,material,quad,installed,prepared,scene=new THREE.Scene(),installMetrics,meshCount=0
   scene.backgroundIntensity=.625;scene.environmentIntensity=.75;scene.backgroundBlurriness=.375
   const installationCycles=[],hostGeometry=new THREE.PlaneGeometry(2,2),hostMaterial=new THREE.MeshBasicMaterial({color:0x204060}),hostMesh=new THREE.Mesh(hostGeometry,hostMaterial),hostCamera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);hostCamera.position.z=2
   let hostBeforeCalls=0,hostAfterCalls=0,hostMaterialDisposals=0;const hostBefore=()=>{hostBeforeCalls++},hostAfter=()=>{hostAfterCalls++};hostMesh.onBeforeRender=hostBefore;hostMesh.onAfterRender=hostAfter;hostMaterial.addEventListener('dispose',()=>hostMaterialDisposals++);scene.add(hostMesh)
   const host=sceneState(scene),rendererRender=renderer.render,rendererObjectFunction=renderer.getRenderObjectFunction?.()
   const rendererState=()=>({clearColor:renderer.getClearColor(new THREE.Color()).toArray(),clearAlpha:renderer.getClearAlpha(),autoClear:renderer.autoClear,autoClearColor:renderer.autoClearColor,autoClearDepth:renderer.autoClearDepth,autoClearStencil:renderer.autoClearStencil,toneMapping:renderer.toneMapping,toneMappingExposure:renderer.toneMappingExposure,outputColorSpace:renderer.outputColorSpace,shadowEnabled:renderer.shadowMap.enabled,shadowType:renderer.shadowMap.type}),hostRenderer=rendererState()
   const assertHost=(allowRendererWrapper=false)=>{if(hostMesh.parent!==scene||hostMesh.geometry!==hostGeometry||hostMesh.material!==hostMaterial||hostMesh.onBeforeRender!==hostBefore||hostMesh.onAfterRender!==hostAfter||hostMaterialDisposals||!allowRendererWrapper&&(renderer.render!==rendererRender||renderer.getRenderObjectFunction?.()!==rendererObjectFunction))throw Error('Caller-owned host material/geometry/render callbacks changed');if(!allowRendererWrapper&&canonical(rendererState())!==canonical(hostRenderer))throw Error('Caller renderer clear/alpha/tone-mapping/output/shadow state changed')}
   if(proof.final){await draw(()=>renderer.render(scene,hostCamera));if(!hostBeforeCalls||!hostAfterCalls)throw Error('Caller-owned host callbacks were not exercised')}
   let cancelledPreparationRejected=false,preparedCancellationRestored=false
   const createOwner=async()=>{
    assertHost()
    if(!proof.final){built=buildSourceCompositor(program,()=>{throw Error('Blank Image has no image dependency')});material=new NodeMaterial();material.fragmentNode=built.node;material.blending=THREE.NoBlending;quad=new QuadMesh(material);return}
    if(!cancelledPreparationRejected){
     const request=startThreeCompiledScenePreparation({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl,viewport:{width:entry.width/entry.pixelRatio,height:entry.height/entry.pixelRatio}});request.cancel();let cancelled=false
     try{const unused=await request.promise;unused.dispose()}catch(error){cancelled=/abort|cancel/i.test(String(error))}
     if(!cancelled||!restored(scene,host))throw Error('Pending public preparation cancellation failed');assertHost();if(!same(outside(),baseline))throw Error('Cancelled preparation retained textures');cancelledPreparationRejected=true
     const unused=await startThreeCompiledScenePreparation({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl,viewport:{width:entry.width/entry.pixelRatio,height:entry.height/entry.pixelRatio}}).promise;unused.dispose();unused.dispose();assertHost()
     if(!restored(scene,host)||!same(outside(),baseline))throw Error('Prepared disposal changed caller scene or retained textures');preparedCancellationRestored=true
    }
    const before=counts();phase='preparation';prepared=await startThreeCompiledScenePreparation({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl,viewport:{width:entry.width/entry.pixelRatio,height:entry.height/entry.pixelRatio},onWarning:m=>{throw Error('Production installation warning '+m)}}).promise;assertHost();const afterPreparation=counts();phase='commit';installed=prepared.commit();installedPipeline=observedPipeline;if(!installedPipeline?.sourceCompositor?.node)throw Error('Public preparation did not produce actual Blank compositor');assertHost(true);const afterCommit=counts();phase='live'
    if(!installed.components.postprocessingOrder.includes('blender-compositor'))throw Error('Actual default install bypassed compositor')
    installed.root.traverse(o=>{if(o.isMesh)meshCount++});if(!meshCount)throw Error('No actual installed mesh')
    installMetrics={preparation:difference(before,afterPreparation),commit:difference(afterPreparation,afterCommit),live:{rowAllocations:0,initialRowUploads:0},beforeLive:afterCommit}
   }
   const disposeOwner=()=>{if(proof.final){installed?.dispose();prepared?.dispose();installed=prepared=undefined;if(!restored(scene,host))throw Error('Actual install changed host scene after dispose');assertHost();if(installMetrics){if(installMetrics.beforeLive)throw Error('Installation cycle lacks measured live frame');installationCycles.push(installMetrics);installMetrics=undefined}}else{built?.dispose();built?.dispose();material?.dispose();built=material=quad=undefined}}
   const render=async()=>{const frame=await draw(()=>proof.final?installed.render():quad.render(renderer));if(proof.final&&installMetrics?.beforeLive){const observed=difference(installMetrics.beforeLive,counts());installMetrics.live={rowAllocations:observed.rowAllocations,initialRowUploads:observed.rowUploads};delete installMetrics.beforeLive}return frame}
   await createOwner();phase='live';const startCounts=counts(),animationFrames=[await render()],mismatch=await compare(entry,rowFlip),firstCounts=counts();animationFrames.push(await render());await compare(entry,rowFlip)
   if(uploads.length!==firstCounts.rowUploads)throw Error('Same-extent warm draw uploaded row data')
   const row=[...outside()].filter(isRow);if(row.length!==entry.tableCount)throw Error('Active pipeline row binding census mismatch '+row.length+' expected '+entry.tableCount)
   const rowIdentities=new Set(row),rowIdentity=row[0];let maximumRowBytes=row.reduce((n,t)=>n+t.image.data.byteLength,0);const initialPasses=lastDrawCalls
   const resizeResults=[]
   for(const name of entry.resizeCases){const other=proof.resizeCases.find(r=>r.case===name);if(!other)throw Error('Missing exact native resize reference');extent(other,installed);rowFlip=await calibrate(other);const before=uploads.length;animationFrames.push(await render());const measured=await compare(other,rowFlip),after=uploads.length;animationFrames.push(await render());await compare(other,rowFlip);if(after-before!==entry.tableCount||uploads.length!==after)throw Error('Resize upload census mismatch');const current=[...outside()].filter(t=>isRow(t));if(!same(new Set(current),rowIdentities))throw Error('Resize replaced shared logical table');maximumRowBytes=Math.max(maximumRowBytes,current.reduce((n,t)=>n+t.image.data.byteLength,0));resizeResults.push({case:name,width:other.width,height:other.height,pixelRatio:other.pixelRatio,...measured,rowUploads:entry.tableCount,repeatUploads:0})}
   extent(entry,installed);rowFlip=await calibrate(entry);await render();await compare(entry,rowFlip)
   if(negatives.length===0){
    const forged=structuredClone(program);forged.ops[0].properties.blank_image_model='unknown';let profileError;try{buildSourceCompositor(forged,()=>null)}catch(e){profileError=String(e)}if(!/Blank Image/.test(profileError))throw Error('Forged Blank source accepted');negatives.push({kind:'source-profile',error:profileError})
    const refuse=async(kind,change,restore,pattern)=>{change();let error;try{await render()}catch(e){error=String(e)}finally{restore()}if(!pattern.test(error))throw Error('Missing Blank refusal '+kind+' '+error);negatives.push({kind,error})}
    const beforeInvalid=uploads.length;await refuse('invalid-viewport',()=>target.viewport.x=1,()=>target.viewport.x=0,/Blank Image.*full-frame/);await render();await compare(entry,rowFlip,false)
    await refuse('pixel-budget',()=>extent({width:8192,height:513,pixelRatio:1},installed),()=>extent(entry,installed),/Blank Image.*4194304/);if(uploads.length!==beforeInvalid)throw Error('Rejected frame uploaded mapping tables');await render();await compare(entry,rowFlip,false)
   }
   disposeOwner();if(!same(outside(),baseline))throw Error('Disposed owner retained texture identities')
   if(proof.final)for(let cycle=1;cycle<3;cycle++){activeCycle=cycle;await createOwner();extent(entry,installed);rowFlip=await calibrate(entry);await render();await compare(entry,rowFlip);disposeOwner();if(!same(outside(),baseline))throw Error('Reapply retained texture identities')}
   if(errors.length||uncaptured.length)throw Error(JSON.stringify({errors,uncaptured}))
   renderer.setRenderTarget(null);target.dispose();const remainingRenderTargets=renderer.info.memory.renderTargets;if(remainingRenderTargets!==0)throw Error('Disposed field owner retained render targets')
   const additionalPortPasses=allocations.slice(startCounts.rowAllocations).filter(row=>row.renderTarget).length;if(additionalPortPasses!==0)throw Error('Row helper allocated a render target')
   rows.push({samples:activeSamples,case:entry.case,width:entry.width,height:entry.height,pixelRatio:entry.pixelRatio,route:entry.route,...mismatch,rowFlip,resizeFrames:resizeResults.length,resizeResults,animationFrames,rowTableBindings:entry.tableCount,maximumRowBytes,unchangedExtentUploads:0,additionalPortPasses,passMeasurement:'owned-row-render-target-allocations',observedFrameDrawCalls:initialPasses,portOwnedTextures:entry.tableCount,remainingRenderTargets,remainingTextures:outside().size,...(proof.final?{cancelledPreparationRejected,preparedCancellationRestored,pinRejected,meshCount,pipeline:'blender-compositor',sourceMaterialsPreserved:true,ownershipScope:'caller-owned-mesh-material-geometry-and-render-callbacks',hostBeforeCalls,hostAfterCalls,hostIdentityRestored:true,rendererCallbacksRestored:true,rendererPropertiesRestored:true,lifecycleCycles:3,baselineCacheRestored:true,baselineSceneDrawCalls,baselineCache:[...baseline].map(t=>({name:t.name,width:t.image.width,height:t.image.height})),installer:'startThreeCompiledScenePreparation.commit',...installationCycles[0],installationCycles:installationCycles.map((metrics,cycle)=>({cycle,...metrics,rawWordMismatches:0,displayAudit:activeSamples.find(sample=>sample.cycle===cycle).displayAudit}))}: {})})
   scene.remove(hostMesh);hostGeometry.dispose();hostMaterial.dispose()
   target=new THREE.RenderTarget(13,9,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
  }
  // Saved original renderer disposal: the two mapping allocations remain
  // owned by their original epoch, even with an externally supplied device.
  const entry=proof.cases[0],program=JSON.parse(new TextDecoder().decode(await pinned(entry.programUrl,entry.programSha256)))
  extent(entry);const owner=buildSourceCompositor(program,()=>null),material=new NodeMaterial();material.fragmentNode=owner.node;material.blending=THREE.NoBlending;await draw(()=>new QuadMesh(material).render(renderer));if(device)await device.queue.onSubmittedWorkDone();else gl.finish()
  const textures=[...outside()].filter(isRow);if(textures.length!==2)throw Error('Saved-dispose requires both actual mapping allocations');const handles=textures.map(t=>{const physical=renderer.backend.get(t);return backend==='webgpu'?physical.texture:physical.textureGPU});if(handles.some(handle=>!handle)||new Set(handles).size!==2)throw Error('Saved-dispose mapping physical handles must be distinct');const perHandleDestroys=[0,0];let physicalDestroys=0
  if(backend==='webgpu')for(const [index,handle]of handles.entries()){const destroy=handle.destroy.bind(handle);handle.destroy=()=>{perHandleDestroys[index]++;physicalDestroys++;destroy()}}
  else{const remove=gl.deleteTexture.bind(gl);gl.deleteTexture=handle=>{const index=handles.indexOf(handle);if(index>=0){perHandleDestroys[index]++;physicalDestroys++}remove(handle)}}
  material.dispose();renderer.setRenderTarget(null);target.dispose();savedOriginalDispose()
  let staleError;try{owner.node.update({renderer})}catch(error){staleError=String(error)}if(!/Blank Image:/.test(staleError))throw Error('Saved renderer disposal failed to revoke Blank root '+staleError)
  owner.dispose();owner.dispose();if(physicalDestroys!==2||perHandleDestroys.some(n=>n!==1))throw Error('Mapping cleanup was not exact once per original handle '+JSON.stringify(perHandleDestroys))
  const savedDispose={error:staleError,physicalDestroys,perHandleDestroys,distinctHandles:new Set(handles).size,externalDevice:!!supplied,remainingOwnedTextures:0,idempotentDisposal:true}
  const validation=await device?.popErrorScope();if(validation)errors.push(validation.message);if(errors.length||uncaptured.length)throw Error(JSON.stringify({errors,uncaptured}))
  return{backend,gpu,rows,negatives,savedDispose,errors,uncaptured}
 }catch(error){failureSnapshot.error=String(error);throw error}finally{ThreeWebgpuPostPipelineService.create=createPipeline;ending=true;renderer.setAnimationLoop(null);renderer.setRenderTarget(null);target.dispose();renderer.dispose();supplied?.destroy()}
}
