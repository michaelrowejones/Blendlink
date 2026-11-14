// Dynamic backend calibration only; no CPU image/texture is created by production.
import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {float,ivec2,screenCoordinate,textureLoad,uint,vec4} from 'three/tsl'
import {cpuRneUnit} from './rne-normalization.mjs'
import {uintCases} from './uint-cases.mjs'
window.runDynamicRneProbe=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),webgl=wanted==='webgl2',adapter=webgl?undefined:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(!webgl&&!adapter)throw Error('Actual adapter required')
 const supplied=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:webgl,antialias:false,...(supplied?{device:supplied}:{})});await renderer.init()
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2';if(backend!==wanted)throw Error('API fallback')
 const device=renderer.backend.device,gl=renderer.backend.gl,ext=gl?.getExtension('WEBGL_debug_renderer_info'),info=adapter?.info??device?.adapterInfo,gpu=info?{api:'WebGPU',vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}:{api:'WebGL2',vendor:gl.getParameter(ext?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 const words=Uint32Array.from(uintCases()),input=new THREE.DataTexture(words,256,256,THREE.RedIntegerFormat,THREE.UnsignedIntType);input.needsUpdate=true
 const target=new THREE.RenderTarget(256,256,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
 renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;renderer.setPixelRatio(1);renderer.setSize(256,256)
 const u=textureLoad(input,ivec2(screenCoordinate)).r,material=new NodeMaterial();material.fragmentNode=vec4(float(u.bitAnd(uint(65535))),float(u.shiftRight(uint(16))),cpuRneUnit(u),float(u).mul(2**-32));const quad=new QuadMesh(material)
 try{
  device?.pushErrorScope('validation')
  await new Promise((resolve,reject)=>{renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{renderer.setRenderTarget(target);quad.render(renderer);resolve()}catch(e){reject(e)}}).catch(reject)})
  const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,256,256),actual=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length),f32word=value=>new Uint32Array(new Float32Array([value]).buffer)[0]
  if(actual.length!==words.length*4)throw Error('Unexpected UInt calibration readback layout')
  const matches=flip=>{for(let y=0;y<256;y++)for(let x=0;x<256;x++){const u=words[((flip?255-y:y)*256+x)],at=(y*256+x)*4;if(pixels[at]!== (u&65535)||pixels[at+1]!==u>>>16)return false}return true}
  const forward=matches(false),reverse=matches(true);if(forward===reverse)throw Error('Independent U32 low/high orientation failed');const rowFlip=reverse
  let exactMismatches=0,oldCastMismatches=0;const examples=[]
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
   const word=words[((rowFlip?255-y:y)*256+x)],at=(y*256+x)*4,expected=f32word(Math.fround(word)/2**32)
   if(actual[at+2]!==expected){exactMismatches++;if(examples.length<8)examples.push({word,actual:actual[at+2],expected})}
   if(actual[at+3]!==expected)oldCastMismatches++
  }
  if(exactMismatches)throw Error('Explicit CPU RNE calibration failed '+JSON.stringify({exactMismatches,examples}))
  const validation=await device?.popErrorScope();if(validation)throw Error(validation.message)
  const shader=await renderer.debug.getShaderAsync(quad,quad.camera,quad)
  return {status:'EXPERIMENT_ONLY_DYNAMIC_CPU_RNE',portCredit:0,backend,gpu,values:words.length,exactMismatches,oldCastMismatches,rowFlip,inputStorage:{format:'R32UI',exactLowHigh16:true},shader}
 }finally{material.dispose();input.dispose();renderer.setRenderTarget(null);target.dispose();renderer.dispose();supplied?.destroy()}
}
