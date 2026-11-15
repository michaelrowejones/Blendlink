import * as THREE from'three'
import{WebGPURenderer,NodeMaterial,QuadMesh}from'three/webgpu'
import{vec4}from'three/tsl'
import{startThreeCompiledScenePreparation}from'@runtime'
window.runPrivateLightControl=async proof=>{
 const wanted=proof.backend,adapter=wanted==='webgpu'?await navigator.gpu.requestAdapter({powerPreference:'high-performance'}):null,device=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:wanted==='webgl2',antialias:false,...device?{device}:{}});await renderer.init()
 const backend=renderer.backend,gl=backend.gl,api=backend.isWebGPUBackend?'webgpu':'webgl2',debug=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=adapter?{api:'WebGPU',...Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]]))}:{api:'WebGL2',renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 const errors=[],uncaptured=[],records=new Map(),live=new Set(),rows=[];let ending=false
 renderer.setSize(13,9);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;renderer.shadowMap.enabled=true;renderer.debug.onShaderError=(g,p)=>errors.push(g.getProgramInfoLog(p));device?.addEventListener('uncapturederror',e=>uncaptured.push(String(e.error)));device?.lost.then(e=>{if(!ending)uncaptured.push(e.message)})
 const assert=(ok,message)=>{if(!ok)throw Error(message)},created=backend.createTexture.bind(backend),destroyed=backend.destroyTexture.bind(backend),deleteTexture=gl?.deleteTexture
 const track=t=>{const p=backend.has(t)?backend.get(t):undefined,handle=api==='webgpu'?p?.texture:p?.textureGPU;if(!handle)return;let record=records.get(handle);if(!record){record={texture:t,name:t.name,handle,destroys:0};records.set(handle,record);if(api==='webgpu'){const old=handle.destroy.bind(handle);handle.destroy=()=>{record.destroys++;return old()}}}return record}
 if(gl)gl.deleteTexture=function(handle){if(records.has(handle))records.get(handle).destroys++;return deleteTexture.call(gl,handle)}
 backend.createTexture=(texture,...args)=>{const result=created(texture,...args);live.add(texture);track(texture);return result};backend.destroyTexture=(texture,...args)=>{const result=destroyed(texture,...args);live.delete(texture);return result}
 const output=new THREE.RenderTarget(13,9,{type:THREE.FloatType,depthBuffer:false}),foreign=new THREE.RenderTarget(2,2,{type:THREE.FloatType,depthBuffer:false}),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,13/9,.1,2000)
 const hostGeometry=new THREE.PlaneGeometry(1,1),hostMaterial=new THREE.MeshStandardMaterial(),hostMesh=new THREE.Mesh(hostGeometry,hostMaterial),hostLight=new THREE.PointLight(0xffffff,1);hostMesh.position.x=1000;hostMesh.receiveShadow=true;hostMesh.castShadow=true;hostLight.position.set(1000,0,2);hostLight.castShadow=true;hostLight.shadow.mapSize.set(32,32);scene.add(hostMesh,hostLight,new THREE.AmbientLight(0xffffff,.1));camera.position.set(1000,0,3)
 const animate=draw=>new Promise((resolve,reject)=>renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{draw();resolve()}catch(e){reject(e)}}).catch(reject))
 const renderHost=()=>animate(()=>{renderer.setRenderTarget(output);renderer.render(scene,camera)})
 const quadMaterial=new NodeMaterial();quadMaterial.fragmentNode=vec4(.125,.5,.75,1);const quad=new QuadMesh(quadMaterial)
 const allMapTextures=target=>[...target.textures,...target.depthTexture?[target.depthTexture]:[]]
 const targetRecords=target=>allMapTextures(target).map(t=>{const record=track(t);assert(record,'Missing actual physical shadow handle '+t.name);return record})
 const remaining=baseline=>[...live].filter(t=>!baseline.has(t))
 try{
  device?.pushErrorScope('validation');await animate(()=>{renderer.setRenderTarget(foreign);quad.render(renderer)});await renderHost()
  assert(hostLight.shadow.map,'Independent caller point shadow did not allocate');const hostRecords=targetRecords(hostLight.shadow.map),foreignRecords=targetRecords(foreign),baseline=new Set(live),hostMap=hostLight.shadow.map
  const generated=await import(/* @vite-ignore */proof.moduleUrl),descriptor=generated[proof.moduleExport]
  for(const mode of['normal','borrowed-map-and-late-light']){
   const oldChildren=[...scene.children],before=new Set(records.keys()),task=startThreeCompiledScenePreparation({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl,prewarm:true,onWarning:m=>{throw Error(m)}}),prepared=await task.promise,installed=prepared.commit()
   let late,lateRecords=[],originalRecords=[],originalMap,privateLight
   try{
    await animate(()=>{renderer.setRenderTarget(output);installed.render()});installed.root.traverse(o=>{if(o.isPointLight){assert(!privateLight,'Expected one imported point light');privateLight=o}})
    assert(privateLight&&privateLight!==hostLight&&privateLight.shadow.map,'Missing actual imported point light shadow');originalMap=privateLight.shadow.map;originalRecords=targetRecords(originalMap);assert(originalRecords.length===2,'Expected color+depth point shadow handles')
    if(mode==='borrowed-map-and-late-light'){
     late=new THREE.PointLight(0xffffff,.1);late.castShadow=true;late.shadow.mapSize.set(32,32);late.position.set(0,2,2);installed.root.add(late);await animate(()=>{renderer.setRenderTarget(output);installed.render()});assert(late.shadow.map,'Late borrowed light did not allocate');lateRecords=targetRecords(late.shadow.map);privateLight.shadow.map=foreign
    }
   }finally{installed.dispose();prepared.dispose();installed.dispose()}
   assert(originalRecords.every(r=>r.destroys===1),'Imported point shadow physical handles not retired once '+JSON.stringify(originalRecords.map(r=>({name:r.name,destroys:r.destroys}))))
   assert(hostLight.shadow.map===hostMap&&hostRecords.every(r=>r.destroys===0),'Caller-owned point shadow changed or disposed');assert(foreignRecords.every(r=>r.destroys===0),'Borrowed replacement target destroyed')
   if(late){assert(lateRecords.length===2&&lateRecords.every(r=>r.destroys===0),'Late scene-added light was claimed');late.dispose()}
   const leftover=remaining(baseline);assert(leftover.length===0,'Install retained textures '+JSON.stringify(leftover.map(t=>t.name)));assert(scene.children.length===oldChildren.length&&scene.children.every((o,i)=>o===oldChildren[i]),'Caller scene ownership changed')
   const privatePhysical=[...records].filter(([handle])=>!before.has(handle)&&!lateRecords.some(r=>r.handle===handle));assert(privatePhysical.every(([,r])=>r.destroys===1),'Some private physical allocations survived')
   rows.push({mode,privatePointShadowHandles:originalRecords.map(r=>({name:r.name,physicalDestroys:r.destroys})),allPrivateHandles:privatePhysical.length,callerPointShadowPreserved:true,borrowedReplacementPreserved:true,lateAddedLightPreserved:!!late,remainingInstallTextures:0,callerSceneRestored:true})
  }
  const validation=await device?.popErrorScope();if(validation)errors.push(validation.message);assert(errors.length===0&&uncaptured.length===0,JSON.stringify({errors,uncaptured}));return{status:'ACTUAL_PRIVATE_LIGHT_CONTROL_PASSED',backend:api,gpu,rows,errors,uncaptured,sourceScene:'Unchanged saved Displace nearest-origin Cube/Sphere/PointLight Final',nativeRenders:0,qualificationCredit:0}
 }finally{ending=true;renderer.setAnimationLoop(null);hostLight.dispose();hostGeometry.dispose();hostMaterial.dispose();foreign.dispose();output.dispose();quadMaterial.dispose();backend.createTexture=created;backend.destroyTexture=destroyed;renderer.dispose();if(gl)gl.deleteTexture=deleteTexture;device?.destroy()}
}
