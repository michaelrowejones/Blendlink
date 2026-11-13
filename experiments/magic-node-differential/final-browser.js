import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { vec4 } from 'three/tsl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { installTslMaterials } from '@blendlink-magic-runtime'
window.runMagicFinal=async({descriptor:manifest,width,height})=>{
  const backend=new URLSearchParams(location.search).get('backend')
  let adapter,device
  if(backend==='webgpu'){
    adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})
    if(!adapter)throw new Error('No actual WebGPU adapter')
    device=await adapter.requestDevice({requiredFeatures:[...adapter.features]})
  }
  const renderer=new WebGPURenderer({antialias:false,forceWebGL:backend==='webgl2',...(device?{device}:{})})
  await renderer.init();renderer.setPixelRatio(1);renderer.setSize(width,height);renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace
  const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu=adapter?{api:'WebGPU',vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,description:adapter.info?.description,isFallbackAdapter:adapter.info?.isFallbackAdapter??adapter.isFallbackAdapter}
    :{api:'WebGL2',renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR)}
  const scene=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(manifest.url)
  const installed=await installTslMaterials({root:scene.scene,descriptor:{materialPrograms:manifest.materialPrograms}})
  if(installed.applied!==3||installed.skipped.length)throw new Error('Actual Final Magic did not install: '+JSON.stringify(installed))
  const seen=[]
  scene.scene.traverse(mesh=>{if(mesh.isMesh){
    if(!mesh.material.colorNode)throw new Error('Final lost the actual live Base Color program')
    mesh.material.fragmentNode=vec4(mesh.material.colorNode,1);mesh.material.needsUpdate=true;seen.push(mesh.material.userData.blendlink_source_material)
  }})
  const target=new THREE.RenderTarget(width,height,{type:THREE.FloatType,depthBuffer:true});target.texture.colorSpace=THREE.NoColorSpace
  renderer.setRenderTarget(target);renderer.render(scene.scene,scene.cameras[0]);renderer.setRenderTarget(null)
  const values=await renderer.readRenderTargetPixelsAsync(target,0,0,width,height)
  const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength);let binary=''
  for(let index=0;index<bytes.length;index+=0x8000)binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000))
  installed.dispose();target.dispose();renderer.dispose()
  return{base64:btoa(binary),materials:seen,components:values.length/(width*height),backend,gpu}
}
