// Public package imports; no internal runtime aliases or native pixel answers.
import * as T from 'three'
import { WebGPURenderer, NodeMaterial, MeshStandardNodeMaterial, MeshPhysicalNodeMaterial } from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { vec4, vec3 } from 'three/tsl'
import { installTslMaterials, buildMaterialProgram, buildOptionsFor } from 'scenetoweb/three/tsl-materials'
import { startThreeCompiledScenePreparation } from 'scenetoweb/three'
const assert=(ok,message)=>{if(!ok)throw Error(message)}
const words=raw=>Array.from(new Uint32Array(raw.buffer,raw.byteOffset,raw.byteLength/4))
const difference=(a,b)=>a.reduce((n,x,i)=>n+(x!==b[i]),0)
const nodes=value=>!value||typeof value!=='object'?[]:[...('op'in value?[value]:[]),...Object.values(value).flatMap(nodes)]
window.runBoxInstalled=async proof=>{
 const result={status:'RUNNING',backend:proof.backend,webgpuAvailableAtStart:typeof navigator.gpu!=='undefined',rows:[],controls:[],errors:[],deviceLosses:[],bitmap:{opened:0,closed:0},callerBitmaps:{opened:0,closed:0},resources:[]};window.boxInstalledFailure=result
 const r=new WebGPURenderer({forceWebGL:proof.backend==='webgl2',antialias:false}),target=new T.RenderTarget(64,4,{type:T.FloatType});target.texture.colorSpace=T.NoColorSpace
 const scene=new T.Scene();scene.background=new T.Color(0);const ambient=new T.AmbientLight(0xffffff,Math.PI),light=new T.DirectionalLight(0xffffff,1);light.position.set(2,5,3);scene.add(ambient,light,light.target)
 const callerChildren=scene.children.slice(),realBitmap=window.createImageBitmap;let disposing=false
 window.createImageBitmap=async(...args)=>{const bitmap=await realBitmap.apply(window,args),close=bitmap.close.bind(bitmap);const counts=args[1]?.imageOrientation==='flipY'?result.bitmap:result.callerBitmaps;counts.opened++;let closed=false;bitmap.close=()=>{assert(!closed,'Owned bitmap closed twice');closed=true;counts.closed++;return close()};return bitmap}
 const materials=new Set(),geometries=new Set(),callerTextures=new Set(),closedCallerImages=new WeakSet();let handle,root
 const draw=async(camera,label,id,width,height)=>{
  target.setSize(width,height);r.setSize(width,height);r.setRenderTarget(target)
  await new Promise((done,fail)=>r.setAnimationLoop(()=>{r.setAnimationLoop(null);try{r.render(scene,camera);done()}catch(error){fail(error)}}).catch(fail))
  const raw=await r.readRenderTargetPixelsAsync(target,0,0,width,height);assert(raw instanceof Float32Array&&raw.length===width*height*4,'Unexpected Float32 readback');const row={id,kind:label,width,height,words:words(raw)};result.rows.push(row);return row.words
 }
 const cleanRoot=()=>{handle?.dispose();handle=null;if(root){scene.remove(root);root.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m)}});root=null}for(const m of materials){for(const value of Object.values(m)){if(value?.isTexture)callerTextures.add(value)}m.dispose()}materials.clear();for(const texture of callerTextures){texture.dispose();for(const image of Array.isArray(texture.image)?texture.image:[texture.image]){if(image&&typeof image.close==='function'&&!closedCallerImages.has(image)){image.close();closedCallerImages.add(image)}}}callerTextures.clear();for(const g of geometries)g.dispose();geometries.clear()}
 try{
  await r.init();assert((r.backend.isWebGPUBackend?'webgpu':'webgl2')===proof.backend,'Actual API fallback');result.maximumAnisotropy=r.getMaxAnisotropy();assert(result.maximumAnisotropy>=2,'Native anisotropy2 unavailable')
  const gl=r.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),info=r.backend.device?.adapterInfo
  result.gpu=gl?{renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}:{vendor:info?.vendor,architecture:info?.architecture,description:info?.description}
  r.backend.device?.lost.then(x=>result.deviceLosses.push({reason:x.reason,message:x.message,expected:disposing&&x.reason==='destroyed'}));r.backend.device?.addEventListener('uncapturederror',e=>result.errors.push(String(e.error)));r.debug.onShaderError=(g,p)=>result.errors.push(g.getProgramInfoLog(p))
  r.outputColorSpace=T.LinearSRGBColorSpace;r.toneMapping=T.NoToneMapping;r.setClearColor(0,1)
  const warmCamera=new T.OrthographicCamera(-1,1,1,-1,.1,10);warmCamera.position.z=2;const warmGeometry=new T.PlaneGeometry(),warmMaterial=new MeshPhysicalNodeMaterial(),warmMesh=new T.Mesh(warmGeometry,warmMaterial);scene.add(warmMesh);await draw(warmCamera,'warm','warm',64,4);result.rows.pop();scene.remove(warmMesh);warmGeometry.dispose();warmMaterial.dispose();const baseline={...r.info.memory}
  for(const entry of proof.entries){
   const loaded=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(entry.glbUrl);root=loaded.scene;scene.add(root);scene.updateMatrixWorld(true);const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push(o)});assert(meshes.length===1&&loaded.cameras.length===1,'Expected one actual exported primitive/camera');const mesh=meshes[0],original=mesh.material,camera=loaded.cameras[0],extras=mesh.userData.blendlink_tsl_runtime
   assert(extras?.requiresNodeRenderer?.programs?.some(p=>p.op==='texture_box_ref'&&p.model==='eevee-metal-box-color-mips-v1'),'Actual primitive declaration missing')
   const stock=await draw(camera,'stock',entry.id,128,8)
   const descriptor={materialPrograms:{...entry.materialPointer,url:entry.materialUrl}},before=performance.now();handle=await installTslMaterials({root,descriptor});result.controls.push({id:entry.id,kind:'preparation',milliseconds:performance.now()-before,applied:handle.applied,skipped:handle.skipped.length});assert(handle.applied===1&&handle.skipped.length===0,'Actual color channels skipped')
   const actual=mesh.material;assert(actual.isNodeMaterial&&actual.colorNode&&actual.opacityNode&&actual.completeProgramColor===true,'Original Base Color/Alpha ownership incomplete')
   const source=actual.userData.blendlink_source_material,program=entry.programs.materials[source],box=nodes(program.channels['Base Color']).find(n=>n.op==='texture_box_ref');assert(box,'Actual published BOX expression absent')
   const mapped=buildMaterialProgram({'Base Color':{tslIr:{schemaVersion:1,model:'blendlink-tsl-ir-v1',output:box.vector}}},buildOptionsFor(extras)).nodes.colorNode
   assert(mapped,'Public Mapping builder failed')
   for(const[width,height]of[[64,4],[128,8]]){
    for(const[kind,node]of[['mask',vec4(1)],['mapping',vec4(mapped.mul(.03125).add(.5),1)],['color',vec4(actual.colorNode,actual.opacityNode)],['alpha',vec4(vec3(actual.opacityNode),1)]]){
     const observer=new NodeMaterial();observer.fragmentNode=node;observer.side=actual.side;observer.blending=T.NoBlending;observer.toneMapped=false;mesh.material=observer;try{await draw(camera,kind,entry.id,width,height)}finally{mesh.material=actual;observer.dispose()}
    }
   }
   const first=await draw(camera,'actual',entry.id,128,8);assert(difference(stock,first)>0,'Stock carrier negative control insensitive');const repeat=await draw(camera,'repeat',entry.id,128,8);assert(difference(first,repeat)===0,'Actual material self-repeat differs')
   // Keep the caller geometry untouched and dispose the poison attribute while
   // it remains attached to its owned geometry, so renderer cache release sees
   // it. Deleting an uploaded attribute before geometry.dispose leaks its cache.
   const previousGeometry=mesh.geometry,poisonGeometry=previousGeometry.clone(),previousVertexColors=actual.vertexColors,poison=new Float32Array(previousGeometry.getAttribute('position').count*4);for(let i=0;i<poison.length;i+=4)poison.set([.125,.25,.5,.125],i)
   poisonGeometry.setAttribute('color',new T.Float32BufferAttribute(poison,4));mesh.geometry=poisonGeometry;actual.vertexColors=true;actual.needsUpdate=true
   const poisoned=await draw(camera,'poison',entry.id,128,8);assert(difference(first,poisoned)===0,'Implicit COLOR0 changed complete native RGB/Alpha')
   const unowned=actual.isMeshPhysicalNodeMaterial?new MeshPhysicalNodeMaterial():new MeshStandardNodeMaterial();unowned.copy(actual);unowned.vertexColors=false;unowned.colorNode=actual.colorNode;unowned.opacityNode=actual.opacityNode;mesh.material=unowned
   try{const plain=await draw(camera,'unowned-no-color',entry.id,128,8);assert(difference(first,plain)===0,'Unowned comparison differs before COLOR0');unowned.vertexColors=true;unowned.needsUpdate=true;const negative=await draw(camera,'unowned-color-negative',entry.id,128,8);assert(difference(first,negative)>0,'COLOR0 negative control insensitive')}finally{mesh.material=actual;unowned.dispose();mesh.geometry=previousGeometry;poisonGeometry.dispose();actual.vertexColors=previousVertexColors;actual.needsUpdate=true}
   for(const mode of entry===proof.entries[0]?['missing','corrupt','abort']:[]){
    const old=mesh.material,controller=new AbortController();await window.boxNetworkMode(mode)
    try{
     const pending=installTslMaterials({root,descriptor,signal:controller.signal});if(mode==='abort'){await window.boxWaitRequest();controller.abort()}
     await pending;throw Error('Injected '+mode+' companion unexpectedly installed')
    }catch(error){assert(mode==='abort'?error.name==='AbortError':mode==='missing'?/fetch failed/.test(String(error)):/mip bytes changed/.test(String(error)),'Unexpected failure cause '+String(error));result.controls.push({id:entry.id,kind:mode,refusal:String(error),materialPreserved:mesh.material===old})}
    finally{await window.boxNetworkMode('normal')}
    assert(mesh.material===old,'Failed preparation changed last-good material');const recovered=await draw(camera,'recovery-'+mode,entry.id,128,8);assert(difference(first,recovered)===0,'Failure changed last-good pixels')
   }
   handle.dispose();handle=null;assert(mesh.material===original,'Scoped material did not restore');const disposed=await draw(camera,'disposed-stock',entry.id,128,8);assert(difference(stock,disposed)===0,'Disposed stock carrier changed');handle=await installTslMaterials({root,descriptor});assert(handle.applied===1&&handle.skipped.length===0,'Remount skipped color/Alpha');result.controls.push({id:entry.id,kind:'remount-installation',applied:handle.applied,skipped:handle.skipped.length});const remount=await draw(camera,'remount',entry.id,128,8);assert(difference(first,remount)===0,'Remount changed actual pixels')
   if(entry===proof.entries[0]){
    const legacy=new T.WebGLRenderer({antialias:false}),caller=new T.Scene();let pending,preparedLegacy
    try{const module=await import(/* @vite-ignore */entry.moduleUrl);pending=startThreeCompiledScenePreparation({renderer:legacy,scene:caller,descriptor:module[entry.moduleExport],assetBaseUrl:proof.assetBaseUrl,viewport:{width:64,height:4}});preparedLegacy=await pending.promise;throw Error('Legacy renderer accepted live BOX')}catch(error){assert(/Legacy WebGLRenderer.*BOX Image Texture/.test(String(error)),'Unexpected legacy refusal '+String(error));result.controls.push({id:entry.id,kind:'legacy-refusal',refusal:String(error)})}finally{preparedLegacy?.dispose();pending?.cancel();legacy.dispose();legacy.forceContextLoss()}
   }
   cleanRoot();assert(scene.children.length===callerChildren.length&&scene.children.every((o,i)=>o===callerChildren[i]),'Caller scene ownership changed');assert(result.bitmap.opened===result.bitmap.closed,'Owned bitmap leak');const memory={...r.info.memory};assert(['textures','geometries','attributes','indexAttributes','storageAttributes','indirectStorageAttributes','readbackBuffers'].every(key=>memory[key]===baseline[key]),'Owned renderer resources leaked '+JSON.stringify({baseline,memory}));result.resources.push({id:entry.id,baseline,memory,bitmap:{...result.bitmap}})
  }
  assert(!result.errors.length,result.errors.join(';'));result.status='PASSED_PUBLIC_INSTALLED_BOX_COLOR_NOT_FULL_SCENE';return result
 }finally{cleanRoot();window.createImageBitmap=realBitmap;target.dispose();for(const o of callerChildren)scene.remove(o);light.dispose();ambient.dispose?.();disposing=true;r.dispose()}
}
