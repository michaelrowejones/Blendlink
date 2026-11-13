import * as THREE from 'three'
import {WebGPURenderer} from 'three/webgpu'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'
import {installLoadedThreeCompiledScene} from '@benchmark/runtime'
import {installTslMaterials} from '@benchmark/materials'
import {createRuntimePerformanceMonitor} from '@benchmark/monitor'
import {distribution,resourceSnapshot,resolveWebglTimer,captureOwnership,ownershipRestored,programDrawBindings} from './metrics.mjs'

const raf=()=>new Promise(resolve=>requestAnimationFrame(resolve))
const check=(condition,message)=>{if(!condition)throw new Error(message)}
const clock=async action=>{const start=performance.now();const value=await action();return {value,ms:performance.now()-start}}
function disposeLoaded(root){
 const geometries=new Set(),materials=new Set(),textures=new Set()
 root.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])if(material){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value)}})
 for(const texture of textures)texture.dispose();for(const material of materials)material.dispose();for(const geometry of geometries)geometry.dispose()
}
function cameraFor(root,cameras,width,height){
 if(cameras[0])return {camera:cameras[0],source:'authored'}
 const bounds=new THREE.Box3().setFromObject(root),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3())
 check(!bounds.isEmpty(),'Scene has no renderable finite bounds')
 const camera=new THREE.PerspectiveCamera(50,width/height,.01,Math.max(1000,size.length()*20))
 camera.position.copy(center).add(new THREE.Vector3(1,.7,1).normalize().multiplyScalar(Math.max(.1,size.length())*1.5));camera.lookAt(center)
 return {camera,source:'fit-static'}
}
window.runBenchmark=async request=>{
 const {config,variant,backend}=request,errors=[],warnings=[],phases={},resources={},steady={},start=performance.now()
 let renderer,device,installed,loaded,monitor,firstResources,originals=[],renderScene,programs
 let row={caseId:request.caseId,variant,repeat:request.repeat,backend,gpu:null,phases,steady,resources,materials:{applied:0,skipped:[]},errors,warnings,status:'running'}
 try{
  let adapter
  if(backend==='webgpu'){adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});check(adapter,'Actual WebGPU adapter unavailable');device=await adapter.requestDevice({requiredFeatures:[...adapter.features]});device.addEventListener('uncapturederror',event=>errors.push(String(event.error?.message??event.error)));device.lost.then(info=>{if(info.reason!=='destroyed')errors.push('GPU device lost: '+info.message)})}
  renderer=new WebGPURenderer({forceWebGL:backend==='webgl2',antialias:false,trackTimestamp:backend==='webgpu'&&config.gpuSamples>0,...(device?{device}:{})})
  const initialized=await clock(()=>renderer.init());phases.rendererInitMs=initialized.ms
  check(backend==='webgl2'?renderer.backend.isWebGLBackend:renderer.backend.isWebGPUBackend,'Requested renderer API silently fell back')
  const timestampCapable=backend==='webgpu'&&renderer.backend.trackTimestamp===true
  if(backend==='webgpu')renderer.backend.trackTimestamp=false // Pinned r184 seam: no timestamp instrumentation in steady-state window.
  const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info')
  row.gpu=adapter?{api:'WebGPU',vendor:adapter.info.vendor??null,architecture:adapter.info.architecture??null,device:adapter.info.device??null,description:adapter.info.description??null,isFallbackAdapter:adapter.info.isFallbackAdapter??null,features:[...adapter.features].sort()}
   :{api:'WebGL2',vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),shadingLanguageVersion:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),unmaskedVendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):null,unmaskedRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null}
  renderer.setPixelRatio(config.dpr);renderer.setSize(config.width,config.height);document.body.append(renderer.domElement)
  renderer.debug.onShaderError=(gl,program,vertex,fragment)=>errors.push([gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n'))
  resources.before=resourceSnapshot(renderer)
  const world=new THREE.Scene();world.background=new THREE.Color(.035,.035,.035)
  if(request.micro){
   const material=new THREE.MeshStandardMaterial({color:new THREE.Color(.35,.5,.7),roughness:.5});material.userData.blendlink_source_material='Benchmark'
   const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1.8,1.8),material),root=new THREE.Group();root.add(mesh)
   const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=2
   loaded={scene:root,cameras:[camera],animations:[]};programs=request.microProgram;phases.loadMs=0
  }else{
   const manager=new THREE.LoadingManager();manager.onError=url=>errors.push('Asset load failed: '+url)
   const result=await clock(()=>new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).loadAsync(request.descriptor.url));loaded=result.value;phases.loadMs=result.ms
  }
  check(loaded.scene,'Scene loader returned no root')
  const selected=cameraFor(loaded.scene,loaded.cameras,config.width,config.height);row.cameraSource=selected.source
  const camera=selected.camera
  if(camera.isPerspectiveCamera){camera.aspect=config.width/config.height;camera.updateProjectionMatrix()}
  loaded.scene.traverse(mesh=>{if(mesh.isMesh)originals.push(captureOwnership(mesh))})
  check(originals.length>0,'Benchmark scene has no meshes')
  const install=async()=>{
   if(request.manifestMode){
    const descriptor=structuredClone(request.descriptor);if(variant==='carrier')delete descriptor.materialPrograms
    const handle=await installLoadedThreeCompiledScene(loaded,{renderer,scene:world,descriptor,viewport:{width:config.width,height:config.height},fallbackCamera:camera,onWarning:message=>warnings.push(message)})
    row.pipeline={postprocessingOrder:[...handle.components.postprocessingOrder]}
    check(warnings.length===0,'Authored manifest emitted runtime warnings: '+warnings.join('; '))
    handle.animation?.pause();handle.animation?.seek(0);if(config.animation==='fixed-step')handle.animation?.playAll()
    return {handle,materials:handle.tslMaterials??{applied:0,skipped:[]},render:delta=>{handle.update(delta);handle.render(delta)},camera:handle.camera,dispose:()=>handle.dispose()}
   }
   if(!loaded.scene.parent)world.add(loaded.scene)
   let hasLight=false;world.traverse(child=>{if(child.isLight)hasLight=true})
   if(!hasLight){const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,4,5);world.add(new THREE.HemisphereLight(0xffffff,0x777777,.7),light)}
   const handle=variant==='program'?await installTslMaterials({root:loaded.scene,descriptor:request.descriptor,...(request.micro?{loadPrograms:async()=>programs}:{})}):{applied:0,skipped:[],dispose(){}}
   return {materials:handle,render:()=>renderer.render(world,camera),camera,dispose:()=>handle.dispose()}
  }
  const applied=await clock(install);installed=applied.value;phases.installMs=applied.ms
  row.viewport={cssWidth:renderer.domElement.clientWidth,cssHeight:renderer.domElement.clientHeight,devicePixelRatio:window.devicePixelRatio,rendererPixelRatio:renderer.getPixelRatio(),drawingBuffer:renderer.getDrawingBufferSize(new THREE.Vector2()).toArray()}
  row.environment={visibilityState:document.visibilityState,crossOriginIsolated:window.crossOriginIsolated,hardwareConcurrency:navigator.hardwareConcurrency}
  row.materials={applied:installed.materials.applied,skipped:[...installed.materials.skipped]}
  check(row.materials.skipped.length===0,'A production material program was skipped')
  if(variant==='program')check(row.materials.applied>0,'No production material program was applied')
  resources.installed=resourceSnapshot(renderer)
  const compile=await clock(()=>renderer.compileAsync(world,installed.camera));phases.compileMs=compile.ms
  phases.compileScope='world-scene materials; authored post-pipeline can compile lazily in firstFrameMs'
  const delta=config.animation==='paused'?0:config.fixedDeltaSeconds
  const first=await clock(()=>installed.render(delta));phases.firstFrameMs=first.ms;phases.firstFrameMeaning='CPU submission wall time, not GPU completion/presentation';await raf()
  const programBindings=programDrawBindings(originals.map(item=>item.mesh)),programMeshes=[...programBindings.keys()],drawnMeshes=new Set(),drawnMaterials=new Set(),callbacks=[]
  try{
   for(const mesh of programMeshes){const callback=mesh.onBeforeRender;callbacks.push({mesh,callback});mesh.onBeforeRender=function(...args){callback.apply(this,args);if(programBindings.get(mesh).has(args[4])){drawnMeshes.add(mesh.uuid);drawnMaterials.add(args[4].uuid)}}}
   installed.render(delta);await raf()
  }finally{for(const{mesh,callback}of callbacks)mesh.onBeforeRender=callback}
  row.drawCoverage={validationFrames:1,programMeshBindings:programMeshes.length,drawnProgramMeshes:drawnMeshes.size,drawnProgramMaterials:drawnMaterials.size,method:'untimed onBeforeRender with installed NodeMaterial argument identity; wrappers removed before warmup/measurement'}
  if(variant==='program')check(drawnMeshes.size>0&&drawnMaterials.size>0,'No visible production program material was drawn; this is not a port workload')
  const warm=performance.now();for(let frame=0;frame<config.warmupFrames;frame++){await raf();installed.render(delta)}phases.warmupMs=performance.now()-warm
  renderer.info.autoReset=false
  monitor=createRuntimePerformanceMonitor({enableGpuTiming:false,frameSampleCapacity:config.measuredFrames+1});monitor.start()
  const cpu=[],intervals=[];let previous
  const measuredStart=performance.now()
  for(let frame=0;frame<config.measuredFrames;frame++){
   const stamp=await raf();if(previous!==undefined)intervals.push(stamp-previous);previous=stamp
   renderer.info.reset();const begin=performance.now();installed.render(delta);cpu.push(performance.now()-begin)
   monitor.sample({info:renderer.info},null,stamp)
  }
  steady.windowMs=performance.now()-measuredStart;steady.cpuSubmission=distribution(cpu)
  steady.rafInterval=intervals.length?distribution(intervals):null;steady.rafMeaning='requestAnimationFrame cadence of this instrumented static/fixed-step host; not GPU time or uncapped throughput'
  steady.monitor=await monitor.finish({info:renderer.info});monitor.dispose();monitor=null
  resources.steady=resourceSnapshot(renderer)
  const gpuSamples=[],gpuReasons=[]
  if(config.gpuSamples>0){
   if(backend==='webgpu'&&timestampCapable&&resources.steady.render.frameCalls===1){
    renderer.backend.trackTimestamp=true
    for(let sample=0;sample<config.gpuSamples;sample++){await raf();installed.render(delta);const ms=await renderer.resolveTimestampsAsync('render');if(Number.isFinite(ms)&&ms>=0)gpuSamples.push(ms);else gpuReasons.push('Three timestamp resolver returned no current numeric result')}
    renderer.backend.trackTimestamp=false
   }else if(backend==='webgl2'){
    const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2')
    if(ext)for(let sample=0;sample<config.gpuSamples;sample++){
     await raf();const query=gl.createQuery();check(query,'GPU timer query allocation failed');gl.beginQuery(ext.TIME_ELAPSED_EXT,query);installed.render(delta);gl.endQuery(ext.TIME_ELAPSED_EXT);gl.flush()
     const result=await resolveWebglTimer(gl,ext,query);if(result.value===null)gpuReasons.push(result.reason);else gpuSamples.push(result.value)
    }else gpuReasons.push('EXT_disjoint_timer_query_webgl2 unavailable')
   }else gpuReasons.push(!timestampCapable?'WebGPU timestamp-query feature unavailable':'Multi-call app frame: public Three timestamp resolver does not establish whole-app GPU duration')
  }else gpuReasons.push('GPU timestamp capture disabled by configuration')
  steady.gpuTimestamp={available:gpuSamples.length>0,reason:gpuReasons.length?gpuReasons.join('; '):null,distribution:gpuSamples.length?distribution(gpuSamples):null,rejectedSamples:gpuReasons.length,measurement:'separate serial timestamp-query pass; resolver wait excluded from CPU submission samples'}
  window.__benchmarkCaptureReady=true
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Host did not capture/release benchmark canvas')),30000);window.__benchmarkCaptureDone=()=>{clearTimeout(timeout);resolve()}}) // Screenshots occur after timing, before disposal.
  installed.dispose();installed=null
  row.sourceRestored=ownershipRestored(originals)
  check(row.sourceRestored,'Installation disposal changed caller material/draw callback ownership')
  resources.afterDispose=resourceSnapshot(renderer)
  const reapply=await clock(install);installed=reapply.value;phases.reapplyMs=reapply.ms
  installed.render(delta);await raf();installed.dispose();installed=null
  check(ownershipRestored(originals),'Repeated apply/dispose changed caller ownership')
  resources.afterReapplyDispose=resourceSnapshot(renderer)
  disposeLoaded(loaded.scene);world.clear();resources.afterSceneDispose=resourceSnapshot(renderer)
  renderer.dispose();resources.afterRendererDispose=resourceSnapshot(renderer);renderer=null;device?.destroy();device=null
  check(errors.length===0,errors.join('\n'));row.status='measured';row.totalMs=performance.now()-start
  return row
 }catch(error){row.status='failed';row.error=String(error?.stack??error);row.totalMs=performance.now()-start;return row}
 finally{monitor?.dispose();try{installed?.dispose()}catch(error){errors.push(String(error))}try{if(renderer&&loaded?.scene)disposeLoaded(loaded.scene)}catch{}renderer?.dispose();device?.destroy()}
}
window.__benchmarkReady=true
