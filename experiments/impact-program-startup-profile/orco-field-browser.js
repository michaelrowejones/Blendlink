import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial } from 'three/webgpu'
import { vec3,vec4,positionWorld } from 'three/tsl'
import { geometryFrame } from '@frame'
import { sourceCpuRawOrco,sourceOrcoAttribute,sourceGeneratedAttribute } from '@orco'
window.runOrcoField=async({backend,native})=>{
 const renderer=new WebGPURenderer({forceWebGL:backend==='webgl2',antialias:false});await renderer.init();renderer.setSize(64,64);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;renderer.setClearColor(0,1)
 const target=new THREE.RenderTarget(64,64,{type:THREE.FloatType,depthBuffer:true});target.texture.colorSpace=THREE.NoColorSpace;renderer.setRenderTarget(target)
 const rows=[],errors=[],materials=[],frames=[];renderer.debug.onShaderError=(gl,p)=>errors.push(gl.getProgramInfoLog(p));renderer.backend.device?.addEventListener('uncapturederror',e=>errors.push(String(e.error)))
 const material=node=>{const value=new NodeMaterial();value.fragmentNode=node;value.side=THREE.DoubleSide;value.blending=THREE.NoBlending;materials.push(value);return value}
 const mask=material(vec4(1,1,1,1)),generated=material(vec4(sourceGeneratedAttribute(),1))
 try{
  for(const basis of ['blender-z-up','gltf-y-up'])for(const item of native.cases){
   const frame=geometryFrame({...item,basis});frames.push(frame)
   const raw=sourceCpuRawOrco(item.position.flat(),item.texspace.location,item.texspace.size)
   frame.mesh.geometry.setAttribute('_scenetoweb_orco',sourceOrcoAttribute(raw))
   const p=basis==='gltf-y-up'?vec3(positionWorld.x,positionWorld.z.negate(),positionWorld.y):positionWorld
   const position=material(vec4(p.mul(.125).add(.5),1))
   for(const[kind,m]of[['mask',mask],['position',position],['generated',generated]]){
    frame.mesh.material=m;renderer.render(frame.scene,frame.camera);const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,64,64)
    rows.push({id:backend+'-'+basis+'-'+item.id+'-'+kind,case:item.id,basis,kind,words:Array.from(new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length))})
   }
   frame.mesh.geometry.setAttribute('_scenetoweb_orco',sourceOrcoAttribute(sourceCpuRawOrco(item.position.flat(),item.texspace.location.map(v=>v+.125),item.texspace.size)))
   frame.mesh.material=generated;renderer.render(frame.scene,frame.camera);const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,64,64);rows.push({id:backend+'-'+basis+'-'+item.id+'-wrong-bbox',case:item.id,basis,kind:'wrong-bbox',words:Array.from(new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length))})
  }
  return{backend:renderer.backend.isWebGPUBackend?'webgpu':'webgl2',rows,errors}
 }finally{for(const m of materials)m.dispose();for(const f of frames)f.dispose();target.dispose();renderer.dispose()}
}
