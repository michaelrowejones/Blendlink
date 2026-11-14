import * as THREE from 'three'
import {WebGPURenderer}from'three/webgpu'
import {vec4,normalWorld,clearcoatNormalView,cameraViewMatrix}from'three/tsl'
import {GLTFLoader}from'three/examples/jsm/loaders/GLTFLoader.js'
import {installTslMaterials}from'@normal-carrier-runtime'
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
window.normalCarrierProof=async proof=>{
 const requested=new URLSearchParams(location.search).get('backend')??'webgpu'
 if(requested==='webgpu'&&!await navigator.gpu?.requestAdapter())throw new Error('Normal carrier proof requires an actual WebGPU adapter')
 const renderer=new WebGPURenderer({antialias:false,forceWebGL:requested==='webgl2'});await renderer.init()
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2'
 if(backend!==requested)throw new Error('Requested actual backend was not created')
 const adapter=renderer.backend.device?.adapterInfo,gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info')
 const gpu=adapter?{api:'WebGPU',vendor:adapter.vendor,architecture:adapter.architecture,device:adapter.device,description:adapter.description}:{api:'WebGL2',vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 const errors=[];renderer.debug.onShaderError=(gl,p,v,f)=>errors.push([gl.getProgramInfoLog(p),gl.getShaderInfoLog(v),gl.getShaderInfoLog(f)].join('\n'));renderer.backend.device?.addEventListener('uncapturederror',event=>errors.push(String(event.error)))
 renderer.setSize(96,96);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const rows=[]
 try{
  for(const source of proof.sources){
   const raw=await(await fetch(source.glbUrl)).arrayBuffer();if(await hash(raw)!==source.glbSha256)throw new Error('Actual carrier GLB changed')
   const view=new DataView(raw),length=view.getUint32(12,true),document=JSON.parse(new TextDecoder().decode(raw.slice(20,20+length))),binaryOffset=20+length+8
   const loader=new GLTFLoader(),gltf=await loader.parseAsync(raw,source.glbUrl.slice(0,source.glbUrl.lastIndexOf('/')+1)),meshes=[];gltf.scene.traverse(obj=>{if(obj.isMesh)meshes.push(obj)})
   if(meshes.length!==1)throw new Error('Actual owned Beam2 should have exactly one mesh')
   const sourceMaterials=new Map(),callbacks=new Map()
   for(const mesh of meshes){
    const material=mesh.material,normal=material.normalMap,coat=material.clearcoatNormalMap;sourceMaterials.set(mesh,material);callbacks.set(mesh,mesh.onBeforeRender)
    for(const semantic of ['position','normal','tangent','uv'+(source.texCoord||'')])if(!(mesh.geometry.getAttribute(semantic)?.array instanceof Float32Array))throw new Error('Actual native basis stream missing: '+semantic)
    if(!normal||normal.channel!==source.texCoord||normal.colorSpace!==THREE.NoColorSpace||material.normalScale.x!==1||material.normalScale.y!==1)throw new Error('Base Normal carrier schema changed')
    if(source.coat&&(!coat||coat.channel!==source.texCoord||coat.colorSpace!==THREE.NoColorSpace||material.clearcoat!==.5))throw new Error('Active Coat Normal carrier schema changed')
    if(!source.coat&&coat)throw new Error('Inactive native coat gained an image')
    const emitted=document.materials.find(row=>row.extras?.blendlink_source_material===material.userData.blendlink_source_material)
    for(const [kind,info]of [['Normal',emitted.normalTexture],...(source.coat?[['Coat Normal',emitted.extensions.KHR_materials_clearcoat.clearcoatNormalTexture]]:[])]){
     const texture=document.textures[info.index],image=document.images[texture.source],buffer=document.bufferViews[image.bufferView]
     const bytes=raw.slice(binaryOffset+(buffer.byteOffset??0),binaryOffset+(buffer.byteOffset??0)+buffer.byteLength)
     if(await hash(bytes)!==source.normalHashes[kind])throw new Error('Embedded native normal PNG changed: '+kind)
    }
   }
   if(await hash(await(await fetch(source.materialPrograms.url)).arrayBuffer())!==source.materialProgramSha256)throw new Error('Actual companion material programs changed')
   const installed=await installTslMaterials({root:gltf.scene,descriptor:{materialPrograms:source.materialPrograms}})
   if(installed.applied<1)throw new Error('Actual published live companion channels did not install '+JSON.stringify(installed))
   const box=new THREE.Box3().setFromObject(gltf.scene),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()).length(),camera=new THREE.OrthographicCamera(-size*.65,size*.65,size*.65,-size*.65,.01,size*20+100)
   camera.position.copy(center).add(new THREE.Vector3(1,.8,1).multiplyScalar(size*2));camera.lookAt(center);camera.updateMatrixWorld()
   const channels=[]
   try{
    for(const channel of ['Normal',...(source.coat?['Coat Normal']:[])]){
     for(const mesh of meshes){
      const material=mesh.material,original=sourceMaterials.get(mesh)
      if(material.normalMap!==original.normalMap||material.clearcoatNormalMap!==original.clearcoatNormalMap)throw new Error('Companion IR installation replaced a baked normal map')
      if(material.normalNode||material.clearcoatNormalNode)throw new Error('A refused normal channel silently became a live program')
      const field=channel==='Normal'?normalWorld:clearcoatNormalView.transformDirection(cameraViewMatrix)
      material.fragmentNode=vec4(field.mul(.5).add(.5),1);material.needsUpdate=true
     }
     const target=new THREE.RenderTarget(96,96,{type:THREE.FloatType,format:THREE.RGBAFormat,depthBuffer:true})
     try{
      renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.render(gltf.scene,camera);const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,96,96)
      if(!(pixels instanceof Float32Array)||!pixels.every(Number.isFinite))throw new Error('Normal diagnostic readback must be finite Float32')
      let visible=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>.9){visible++;for(let c=0;c<3;c++)if(pixels[i+c]<-1e-5||pixels[i+c]>1+1e-5)throw new Error('Normal diagnostic left its encoded direction range')}
      if(visible<20)throw new Error('Actual imported normal mesh rendered blank')
      channels.push({channel,visiblePixels:visible,sha256:await hash(pixels.buffer)})
     }finally{renderer.setRenderTarget(null);target.dispose()}
    }
    if(source.coat&&channels[0].sha256===channels[1].sha256)throw new Error('Distinct actual base and coat normal fields collapsed')
   }finally{
    installed.dispose()
    for(const mesh of meshes)if(mesh.material!==sourceMaterials.get(mesh)||mesh.onBeforeRender!==callbacks.get(mesh))throw new Error('Material/ownership callback restoration failed')
    const textures=new Set(),materials=new Set();for(const mesh of meshes){mesh.geometry.dispose();materials.add(mesh.material);for(const value of Object.values(mesh.material))if(value?.isTexture)textures.add(value)}for(const material of materials)material.dispose();for(const texture of textures){texture.dispose();texture.source.data?.close?.()}
   }
   rows.push({case:source.name,installed:installed.applied,channels,sourceRestored:true,normalCarrierRetained:true})
  }
  if(errors.length)throw new Error(JSON.stringify(errors))
  return{status:'PASSED_CYCLES_NORMAL_CARRIER_LOADING',backend,gpu,rows,errors,scope:'Actual native PNG/basis carrier loading, installed companion IR, normal-map preservation and nonblank finite normal diagnostics; no cross-renderer lighting parity claim'}
 }finally{renderer.dispose()}
}
