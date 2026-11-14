import{vec4}from'three/tsl'
import * as THREE from'three'
import{WebGPURenderer,PMREMGenerator,NodeMaterial,QuadMesh}from'three/webgpu'
import{installThreeCompiledScene,startThreeCompiledScenePreparation}from'@world-runtime'
const word=v=>new Uint32Array(new Float32Array([v]).buffer)[0]
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
const pinned=async(url,pin)=>{const response=await fetch(url);if(!response.ok)throw Error('Missing World asset');const bytes=await response.arrayBuffer();if(await sha(bytes)!==pin)throw Error('World asset pin mismatch');return bytes}
window.runWorldProof=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),adapter=wanted==='webgl2'?null:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});if(wanted==='webgpu'&&!adapter)throw Error('No actual WebGPU adapter');const device=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:wanted==='webgl2',antialias:false,...(device?{device}:{})});await renderer.init();renderer.info.autoReset=false
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2';if(backend!==wanted)throw Error('API fallback');const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=adapter?{api:'WebGPU',...Object.fromEntries(['vendor','architecture','description','device'].map(k=>[k,adapter.info[k]]))}:{api:'WebGL2',renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 const errors=[],uncaptured=[],live=new Set(),created=[],createdObjects=[],rows=[],controls=[],adoptions=[],pmremRecords=[],stagingEnvironments=[],geometryCreations=[],colorOwnership=[],testReadbackTextures=new WeakSet(),testBaselineTextures=new WeakSet();let disposing=false
 renderer.debug.onShaderError=(g,p)=>errors.push(g.getProgramInfoLog(p));device?.addEventListener('uncapturederror',e=>uncaptured.push(String(e.error)));device?.lost.then(e=>{if(!disposing)uncaptured.push('device lost '+e.message)})
 const create=renderer.backend.createTexture.bind(renderer.backend),destroy=renderer.backend.destroyTexture.bind(renderer.backend)
 const fact=texture=>{const first=Array.isArray(texture.image)?texture.image[0]:texture.image,image=first?.isDataTexture?first.image:first;return{role:testReadbackTextures.has(texture)?'test-readback-target':testBaselineTextures.has(texture)?'test-baseline-target':texture.name.startsWith('SceneToWeb Preview World')?'source-world':texture.name==='DFG_LUT'?'renderer-cache':'installation-or-derivative',name:texture.name,width:image?.width??0,height:image?.height??0,type:texture.type,format:texture.format,dataTexture:!!texture.isDataTexture,cpuBytes:image?.data?.byteLength??null,cube:!!texture.isCubeTexture,faces:Array.isArray(texture.image)?texture.image.length:1,renderTarget:!!texture.isRenderTargetTexture}}
 renderer.backend.createTexture=(texture,...args)=>{const result=create(texture,...args);live.add(texture);created.push(fact(texture));createdObjects.push(texture);return result};renderer.backend.destroyTexture=(texture,...args)=>{const result=destroy(texture,...args);live.delete(texture);return result}
 renderer.setPixelRatio(1);renderer.setSize(13,9);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const target=new THREE.RenderTarget(13,9,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace;for(const texture of target.textures)testReadbackTextures.add(texture)
 const warm=new THREE.RenderTarget(16,16,{type:THREE.HalfFloatType,depthBuffer:false});warm.texture.colorSpace=THREE.NoColorSpace;for(const texture of warm.textures)testBaselineTextures.add(texture)
 const outside=()=>new Set([...live].filter(texture=>!target.textures.includes(texture)&&!warm.textures.includes(texture))),sameSet=(a,b)=>a.size===b.size&&[...a].every(value=>b.has(value))
 // Forward public operations unchanged. Observe the actual temporary source,
 // generated target and shared staging environment rather than inventing an
 // environment DataTexture that no longer survives the prepared installer.
 const fromPmrem=PMREMGenerator.prototype.fromEquirectangular,disposePmrem=PMREMGenerator.prototype.dispose,compile=renderer.compileAsync,initGeometry=renderer._geometries.initGeometry
 renderer._geometries.initGeometry=function(object){geometryCreations.push({geometry:object.geometry,objectName:object.object?.name??''});return initGeometry.call(this,object)}
 PMREMGenerator.prototype.fromEquirectangular=function(source,destination){
  const record={generator:this,source,destination,sourceDisposals:0,targetDisposals:0,generatorDisposals:0,createdStart:createdObjects.length}
  pmremRecords.push(record);source.addEventListener('dispose',()=>record.sourceDisposals++)
  if(destination)destination.addEventListener('dispose',()=>record.targetDisposals++)
  const result=fromPmrem.call(this,source,destination);record.result=result;record.createdEnd=createdObjects.length
  if(result!==destination)throw Error('Ready PMREM did not use its public owned destination')
  return result
 }
 PMREMGenerator.prototype.dispose=function(){const record=pmremRecords.find(r=>r.generator===this);if(record)record.generatorDisposals++;return disposePmrem.call(this)}
 renderer.compileAsync=function(...args){if(args[0]?.isScene)stagingEnvironments.push(args[0].environment);return compile.apply(this,args)}
 const readySchema=t=>!!t?.isRenderTargetTexture&&t.isPMREMTexture===true&&t.name==='PMREM.cubeUv'&&t.image?.width===336&&t.image?.height===64&&t.type===THREE.HalfFloatType&&t.format===THREE.RGBAFormat&&t.mapping===THREE.CubeUVReflectionMapping&&t.colorSpace===THREE.LinearSRGBColorSpace&&t.minFilter===THREE.LinearFilter&&t.magFilter===THREE.LinearFilter&&!t.generateMipmaps
 const sourceWitness=(record,radiance)=>{
  const t=record.source;if(!t?.isDataTexture||t.name!=='SceneToWeb Preview World'||t.image.width!==64||t.image.height!==32||!(t.image.data instanceof Float32Array)||t.image.data.byteLength!==32768||t.type!==THREE.FloatType||t.format!==THREE.RGBAFormat||t.mapping!==THREE.EquirectangularReflectionMapping||t.colorSpace!==THREE.LinearSRGBColorSpace)throw Error('Transient World source schema changed')
  let comparedWords=0;for(const value of t.image.data){if(word(value)!==word(comparedWords%4===3?1:radiance[comparedWords%4]))throw Error('Transient World radiance changed');comparedWords++}
  return{width:64,height:32,bytes:32768,comparedWords,wordDifferences:0,disposals:record.sourceDisposals}
 }
 const pmremWitness=(record,radiance,scene,stagingStart)=>{
  if(!record||!readySchema(record.result?.texture)||scene.environment!==record.result.texture||!stagingEnvironments.slice(stagingStart).includes(record.result.texture))throw Error('Detached/live World environment is not the same ready owned PMREM')
  const targetTextures=new Set([...record.result.textures,record.result.depthTexture].filter(Boolean)),allocations=createdObjects.slice(record.createdStart,record.createdEnd),scratch=allocations.filter(t=>t!==record.source&&!targetTextures.has(t)&&t.renderTarget!==record.result)
  if(record.sourceDisposals!==1||record.generatorDisposals!==1||record.targetDisposals!==0||live.has(record.source)||!live.has(record.result.texture)||scratch.some(t=>live.has(t)))throw Error('PMREM temporary source/scratch lifetime differs')
  return{source:sourceWitness(record,radiance),ready:{width:336,height:64,type:'HalfFloatType',format:'RGBAFormat',mapping:'CubeUVReflectionMapping',sharedDetachedLive:true,versionUnchanged:true},generatorDisposals:record.generatorDisposals,scratchTextures:scratch.length,scratchRemaining:0,targetDisposals:0}
 }

 const rendererState=()=>{const t=renderer.getRenderTarget();return{target:t,face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),viewport:[...renderer.getViewport(new THREE.Vector4())],scissor:[...renderer.getScissor(new THREE.Vector4())],scissorTest:renderer.getScissorTest(),targetViewport:t?[...t.viewport]:null,targetScissor:t?[...t.scissor]:null,targetScissorTest:t?.scissorTest??null,xr:renderer.xr?.enabled,autoClear:renderer.autoClear}}
 const sameRendererState=(a,b)=>Object.keys(a).every(key=>Array.isArray(a[key])?JSON.stringify(a[key])===JSON.stringify(b[key]):a[key]===b[key])
 const read=async(w,h)=>{const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,w,h),padded=Math.ceil(w*16/256)*256/16,stride=pixels.length===w*h*4?w:backend==='webgpu'&&[4*(padded*(h-1)+w),4*padded*h].includes(pixels.length)?padded:0;if(!(pixels instanceof Float32Array)||!stride)throw Error('Not actual padded Float32 World readback');const out=new Float32Array(w*h*4);for(let y=0;y<h;y++)out.set(pixels.subarray(y*stride*4,(y*stride+w)*4),y*w*4);return out}
 const nativeMetric=(actual,expected,entry)=>{if(actual.length!==expected.length)throw Error('World extent mismatch');let maxAbs=0,wordDifferences=0,violations=0,alphaDifferences=0;for(let i=0;i<actual.length;i++){if(!Number.isFinite(actual[i]))throw Error('Nonfinite World output');if(word(actual[i])!==word(expected[i]))wordDifferences++;if(i%4===3){if(word(actual[i])!==word(1))alphaDifferences++}else{const delta=Math.abs(actual[i]-expected[i]);maxAbs=Math.max(maxAbs,delta);if(delta>2**-10||entry.exactRGB&&word(actual[i])!==word(expected[i]))violations++}}if(violations||alphaDifferences)throw Error(JSON.stringify({case:entry.case,maxAbs,violations,alphaDifferences,first:[...actual.slice(0,4)],native:[...expected.slice(0,4)]}));return{words:actual.length,maxAbs,wordDifferences,violations,alphaDifferences}}
 const renderInstalled=installed=>new Promise((resolve,reject)=>renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{installed.render();resolve()}catch(error){reject(error)}}))
 const snapshot=scene=>({clearAlpha:renderer.getClearAlpha(),background:scene.background,backgroundNode:scene.backgroundNode,environment:scene.environment,backgroundIntensity:scene.backgroundIntensity,environmentIntensity:scene.environmentIntensity,backgroundBlurriness:scene.backgroundBlurriness,children:[...scene.children]}),restored=(scene,before)=>Object.is(renderer.getClearAlpha(),before.clearAlpha)&&scene.background===before.background&&scene.backgroundNode===before.backgroundNode&&scene.environment===before.environment&&scene.backgroundIntensity===before.backgroundIntensity&&scene.environmentIntensity===before.environmentIntensity&&scene.backgroundBlurriness===before.backgroundBlurriness&&scene.children.length===before.children.length&&scene.children.every((child,i)=>child===before.children[i])
 try{
  // Independent actual native-PBR draw identifies renderer-owned DFG cache,
  // before any World candidate. Test geometry/material are immediately owned.
  const controlScene=new THREE.Scene(),controlGeometry=new THREE.PlaneGeometry(2,2),controlMaterial=new THREE.MeshPhysicalMaterial(),controlMesh=new THREE.Mesh(controlGeometry,controlMaterial),controlCamera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);controlCamera.position.z=2;controlScene.add(controlMesh,new THREE.DirectionalLight(0xffffff,1));renderer.setRenderTarget(warm);renderer.render(controlScene,controlCamera);controlGeometry.dispose();controlMaterial.dispose()
  // QuadMesh owns one shared fullscreen geometry. Warm that public cache with
  // an independent constant draw before measuring any World installation.
  // Its material is test-owned; the shared geometry is not an install leak.
  const quadMaterial=new NodeMaterial();quadMaterial.fragmentNode=vec4(.125,.25,.5,1);new QuadMesh(quadMaterial).render(renderer);quadMaterial.dispose()
  const baseline=outside();if([...baseline].some(t=>t.name!=='DFG_LUT'||t.image?.width!==16||t.image?.height!==16)||baseline.size>1)throw Error('Unknown actual no-World renderer baseline '+JSON.stringify([...baseline].map(fact)))
  for(const entry of proof.cases){
   const generated=await import(/* @vite-ignore */entry.moduleUrl),descriptor=generated[entry.moduleExport];if(!descriptor?.sourcePresentation||!descriptor.authoringPreview?.world)throw Error('Actual generated World descriptor missing');if(Object.keys(descriptor.authoringPreview.world).sort().join('|')!==Object.keys(entry.world).sort().join('|')||Object.entries(entry.world).some(([key,value])=>JSON.stringify(descriptor.authoringPreview.world[key])!==JSON.stringify(value)))throw Error('Generated World evidence changed')
   const frames=[];for(const frame of entry.frames)frames.push({...frame,pixels:new Float32Array(await pinned(frame.pixelUrl,frame.pixelSha256))})
   const cycles=[],scene=new THREE.Scene();scene.background=new THREE.Color(.03125,.0625,.125);scene.backgroundIntensity=1.25;scene.environmentIntensity=.75;scene.backgroundBlurriness=.375
   for(let cycle=0;cycle<3;cycle++){
    const before=snapshot(scene),createdAt=created.length,geometryAt=geometryCreations.length,geometryBefore=renderer.info.memory.geometries,pmremAt=pmremRecords.length,stagingAt=stagingEnvironments.length;let installed,prepared,pmrem,backgroundNodeWrites=0
    Object.defineProperty(scene,'backgroundNode',{configurable:true,get:()=>before.backgroundNode,set:()=>{backgroundNodeWrites++;throw Error('Source World changed caller backgroundNode')}})
    try{
     const prepareDrawStart=renderer.info.render.drawCalls,rendererBeforePreparation=rendererState()
     prepared=await startThreeCompiledScenePreparation({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl,prewarm:true}).promise
     const preparationDraws=renderer.info.render.drawCalls-prepareDrawStart
     if(!restored(scene,before)||!sameRendererState(rendererBeforePreparation,rendererState()))throw Error('Detached World preparation changed caller scene/renderer state')
     const commitDrawStart=renderer.info.render.drawCalls;installed=prepared.commit();const commitDraws=renderer.info.render.drawCalls-commitDrawStart,installationDraws=preparationDraws+commitDraws
     if(commitDraws!==0)throw Error('Ready World commit performed GPU draws')
     if(!installed.components.postprocessingOrder.includes('blender-display-transform'))throw Error('Actual default Final display chain missing')
     if(pmremRecords.length!==pmremAt+1)throw Error('Expected exactly one shared lighting generation per prepared installation')
     pmrem=pmremRecords[pmremAt];const ownership=pmremWitness(pmrem,entry.radiance,scene,stagingAt)
     const backgroundColor=scene.background,sourceTexture=scene.environment
     if(!backgroundColor?.isColor||scene.backgroundBlurriness!==0||scene.backgroundIntensity!==1||backgroundNodeWrites!==0)throw Error('Actual owned World Color/background-node schema differs')
     const radianceWords=backgroundColor.toArray().map(word)
     if(radianceWords.some((value,i)=>value!==word(entry.radiance[i])))throw Error('World Color changed the authored F32 radiance')
     const version=sourceTexture.version
     const measurements=[]
     for(let index=0;index<frames.length;index++){
      const frame=frames[index],dpr=index===1?2:1;renderer.setPixelRatio(dpr);renderer.setSize(frame.width/dpr,frame.height/dpr);target.setSize(frame.width,frame.height);installed.resize(frame.width/dpr,frame.height/dpr);renderer.setRenderTarget(target);const linearDrawStart=renderer.info.render.drawCalls;renderer.render(scene,installed.camera);const linearDraws=renderer.info.render.drawCalls-linearDrawStart;const linear=nativeMetric(await read(frame.width,frame.height),frame.pixels,entry);renderer.setRenderTarget(target);const drawStart=renderer.info.render.drawCalls;await renderInstalled(installed);const finalDraws=renderer.info.render.drawCalls-drawStart;const final=nativeMetric(await read(frame.width,frame.height),frame.pixels,entry);if(scene.background!==backgroundColor||scene.environment!==sourceTexture||sourceTexture.version!==version||backgroundColor.toArray().some((v,i)=>word(v)!==radianceWords[i])||scene.backgroundBlurriness!==0||backgroundNodeWrites!==0)throw Error('World resized by replacing or uploading its constant texture');measurements.push({width:frame.width,height:frame.height,pixelRatio:dpr,linear,final,linearDraws,finalDraws})
     }
     cycles.push({cycle,installationDraws,preparationDraws,commitDraws,detachedRendererRestored:true,frames:measurements,pmrem:ownership,backgroundColor:{type:'Color',radianceWords,textureAllocations:created.slice(createdAt).filter(t=>t.cube||t.name==='SceneToWeb Preview World Background').length,geometryAllocations:geometryCreations.slice(geometryAt).filter(r=>r.objectName==='Background.mesh').length,backgroundNodeWrites,versionUnchanged:true},createdTextures:created.slice(createdAt),postprocessingOrder:[...installed.components.postprocessingOrder]})
    }finally{installed?.dispose();prepared?.dispose()}
    if(pmrem){const result=cycles.at(-1);if(pmrem.targetDisposals!==1)throw Error('Owned ready PMREM target was not retired once');if(result)result.pmrem.targetDisposals=pmrem.targetDisposals}
    if(renderer.info.memory.geometries!==geometryBefore)throw Error('World installation retained geometry after disposal');cycles.at(-1).geometryCounts={before:geometryBefore,after:renderer.info.memory.geometries};if(!restored(scene,before))throw Error('World install/dispose failed actual host scene restoration');if(!sameSet(outside(),baseline))throw Error('World derivative/target texture identities not restored '+JSON.stringify({expected:[...baseline].map(fact),actual:[...outside()].map(fact)}))
   }
   rows.push({case:entry.case,cycles,hostRestored:true,textureBaselineRestored:true})
  }
  // Actual generated descriptor and same authored source, with explicit host
  // policies supplied through supported API ownership seams only.
  for(const kind of['website-background','source-opt-out','film-transparent']){
   const entry=kind==='source-opt-out'?proof.cases[2]:proof.controls.find(row=>row.controlKind===kind),generated=await import(/* @vite-ignore */entry.moduleUrl),descriptor=generated[entry.moduleExport]
   const scene=new THREE.Scene();scene.background=kind==='film-transparent'?null:new THREE.Color(.03125,.0625,.125);renderer.setClearColor(0,0);const before=snapshot(scene);let installed
   try{installed=await installThreeCompiledScene({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl,...(kind==='source-opt-out'?{useSourcePresentation:false}:{})});if(scene.background?.isTexture)throw Error('Ownership control improperly installed source World background');const size=16;renderer.setPixelRatio(1);renderer.setSize(size,size);installed.resize(size,size);target.setSize(size,size);renderer.setRenderTarget(target);await renderInstalled(installed);const actual=await read(size,size),expected=kind==='website-background'?[.25,.5,.75,1]:kind==='source-opt-out'?[.03125,.0625,.125,1]:[0,0,0,0];let differences=0;for(let i=0;i<actual.length;i++)if(word(actual[i])!==word(expected[i%4]))differences++;if(differences)throw Error('World ownership pixels changed '+JSON.stringify({kind,differences,first:[...actual.slice(0,4)],expected}));controls.push({case:kind,words:actual.length,differences,sourceBackgroundOmitted:true})}finally{installed?.dispose()}
   if(!restored(scene,before)||!sameSet(outside(),baseline))throw Error('World ownership control failed restoration '+JSON.stringify({kind,propertiesRestored:restored(scene,before),textureSetRestored:sameSet(outside(),baseline),before:{clearAlpha:before.clearAlpha,background:before.background?.isColor?before.background.toArray():before.background?.uuid??null,environment:before.environment?.uuid??null,backgroundIntensity:before.backgroundIntensity,environmentIntensity:before.environmentIntensity,backgroundBlurriness:before.backgroundBlurriness,children:before.children.map(o=>({name:o.name,uuid:o.uuid}))},after:{clearAlpha:renderer.getClearAlpha(),background:scene.background?.isColor?scene.background.toArray():scene.background?.uuid??null,environment:scene.environment?.uuid??null,backgroundIntensity:scene.backgroundIntensity,environmentIntensity:scene.environmentIntensity,backgroundBlurriness:scene.backgroundBlurriness,children:scene.children.map(o=>({name:o.name,uuid:o.uuid}))},expectedTextures:[...baseline].map(fact),actualTextures:[...outside()].map(fact)}))
  }
  // Later caller ownership is explicit: retain the live ready target until
  // that caller disposes its ordinary public Texture, then retire all targets.
  for(const kind of['intensity','background']){
   const entry=proof.cases[2],generated=await import(/* @vite-ignore */entry.moduleUrl),descriptor=generated[entry.moduleExport],scene=new THREE.Scene(),at=pmremRecords.length
   let installed,texture,record
   try{
    installed=await installThreeCompiledScene({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl});texture=scene.environment;record=pmremRecords[at]
    if(pmremRecords.length!==at+1||!readySchema(texture)||record.result.texture!==texture)throw Error('Adoption ready PMREM source differs')
    if(kind==='intensity')scene.environmentIntensity=.875
    else{scene.background=texture;scene.environment=null}
    installed.dispose();installed=undefined
    if(record.targetDisposals!==0||!live.has(texture)||(kind==='intensity'?scene.environment!==texture:scene.background!==texture))throw Error('Caller-adopted PMREM was prematurely disposed')
    texture.dispose();texture.dispose()
    if(record.targetDisposals!==1||!sameSet(outside(),baseline))throw Error('Caller disposal did not retire ready PMREM target exactly once')
    adoptions.push({case:kind,preservedUntilCallerDispose:true,targetDisposals:1,textureBaselineRestored:true})
   }finally{installed?.dispose();texture?.dispose()}
  }
  // Color backgrounds use the authored clear radiance; Three applies later
  // backgroundIntensity only to textures. Prove this observed behavior and
  // preserve the later caller, without claiming old-cube intensity equivalence.
  let intensityAudit
  {
   const entry=proof.cases[2],generated=await import(/* @vite-ignore */entry.moduleUrl),descriptor=generated[entry.moduleExport],scene=new THREE.Scene();let installed
   try{
    installed=await installThreeCompiledScene({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl});const ownedColor=scene.background
    if(!ownedColor?.isColor)throw Error('Color intensity control did not receive Color')
    renderer.setPixelRatio(1);renderer.setSize(16,16);installed.resize(16,16);target.setSize(16,16);renderer.setRenderTarget(target);renderer.render(scene,installed.camera);const initial=await read(16,16)
    scene.backgroundIntensity=.5;renderer.render(scene,installed.camera);const changed=await read(16,16)
    let wordDifferences=0,textureIntensityCounterfactualMaxAbs=0;for(let i=0;i<initial.length;i++){if(word(initial[i])!==word(changed[i]))wordDifferences++;if(i%4!==3)textureIntensityCounterfactualMaxAbs=Math.max(textureIntensityCounterfactualMaxAbs,Math.abs(changed[i]-initial[i]*.5))}
    if(wordDifferences!==0||textureIntensityCounterfactualMaxAbs<=0)throw Error('Color later-intensity semantics changed')
    installed.dispose();installed=undefined
    if(scene.background!==ownedColor||scene.backgroundIntensity!==.5||!sameSet(outside(),baseline))throw Error('Later Color intensity ownership was not preserved')
    intensityAudit={comparedWords:1024,wordDifferences,observedColorIgnoresLaterIntensity:true,textureIntensityCounterfactualMaxAbs,oldCubeIntensityEquivalenceCredit:0,callerColorPreserved:true,textureBaselineRestored:true}
   }finally{installed?.dispose()}
  }
  {
   const entry=proof.cases[2],generated=await import(/* @vite-ignore */entry.moduleUrl),descriptor=generated[entry.moduleExport],scene=new THREE.Scene();let installed
   try{installed=await installThreeCompiledScene({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl});const later=new THREE.Color(.03125,.0625,.125);scene.background=later;scene.backgroundIntensity=.75;installed.dispose();installed=undefined;if(scene.background!==later||scene.backgroundIntensity!==.75||!sameSet(outside(),baseline))throw Error('Caller Color replacement was not preserved');colorOwnership.push({case:'caller-color-replacement',identityPreserved:true,textureBaselineRestored:true})}finally{installed?.dispose()}
  }
  if(errors.length||uncaptured.length)throw Error(JSON.stringify({errors,uncaptured}));return{backend,gpu,cases:rows,controls,shaderErrors:errors,uncaptured,rendererBaseline:[...baseline].map(fact),resourceAbi:'ready-owned-pmrem-color-v2',adoptions,colorOwnership,intensityAudit,sourceRadianceOnly:true,iblCredit:0}
 }finally{PMREMGenerator.prototype.fromEquirectangular=fromPmrem;PMREMGenerator.prototype.dispose=disposePmrem;renderer.compileAsync=compile;renderer._geometries.initGeometry=initGeometry;disposing=true;target.dispose();warm.dispose();renderer.dispose();device?.destroy()}
}
