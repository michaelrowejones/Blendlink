// Research diagnostic only. Never repairs or substitutes a production result.
import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {bitcast,float,ivec2,textureLoad,uint,uniform,uv,vec2,vec3,vec4} from 'three/tsl'
import {compositorHashUint2,compositorWhiteNoiseHash} from '@exact-hash'
import {buildCompositorWhiteNoise} from '@constant-compositor'
import {ExactAxisTable} from './axis-table.mjs'
window.diagnoseAxisHash=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),webgl=wanted==='webgl2',adapter=webgl?undefined:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(!webgl&&!adapter)throw Error('Actual WebGPU adapter required')
 const supplied=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:webgl,antialias:false,...(supplied?{device:supplied}:{})});await renderer.init()
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2';if(backend!==wanted)throw Error('API fallback')
 const device=renderer.backend.device,gl=renderer.backend.gl,extension=gl?.getExtension('WEBGL_debug_renderer_info'),info=adapter?.info??device?.adapterInfo
 const gpu=info?{api:'WebGPU',vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}:{api:'WebGL2',vendor:gl.getParameter(extension?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 const width=13,height=9,target=new THREE.RenderTarget(width,height,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
 renderer.setPixelRatio(1);renderer.setSize(width,height);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const table=new ExactAxisTable(),rows=[],errors=[],owned=new Set();let rowFlip
 renderer.debug.onShaderError=(context,program)=>errors.push(context.getProgramInfoLog(program))
 const material=node=>{const m=new NodeMaterial();m.fragmentNode=node;owned.add(m);return m}
 const draw=quad=>new Promise((resolve,reject)=>{renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{renderer.setRenderTarget(target);quad.render(renderer);resolve()}catch(error){reject(error)}}).catch(reject)})
 const read=async()=>{
  const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,width,height),stride=pixels.length===width*height*4?width:backend==='webgpu'&&pixels.length===4*(16*(height-1)+width)?16:0
  if(!stride)throw Error('Unexpected diagnostic readback stride')
  return {pixels,words:new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length),stride}
 }
 try{
  device?.pushErrorScope('validation')
  const data=new Float32Array(width*height*4)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([x/32,y/32,(x+3*y)/128,1],(y*width+x)*4)
  const input=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.FloatType);input.needsUpdate=true
  const calibration=material(textureLoad(input,ivec2(uv().mul(vec2(width,height)))));await draw(new QuadMesh(calibration));const got=await read(),want=new Uint32Array(data.buffer)
  const matches=flip=>{for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++)if(got.words[(y*got.stride+x)*4+c]!==want[((flip?height-1-y:y)*width+x)*4+c])return false;return true}
  const a=matches(false),b=matches(true);if(a===b)throw Error('Independent diagnostic orientation failed');rowFlip=b;input.dispose();calibration.dispose();owned.delete(calibration)
  const position=table.node,hash=()=>compositorHashUint2(bitcast(position.x,'uint'),bitcast(position.y,'uint'))
  const encode=(h,unit)=>vec4(float(h.bitAnd(uint(65535))),float(h.shiftRight(uint(16))),float(h),unit)
  const literal=proof.literalVector,op={id:'same-fixed-seed',kind:'white-noise-texture',type:'VALUE',source:{path:[],node:'Actual CPU constant compositor regression',nodeType:'ShaderNodeTexWhiteNoise',output:'Value'},properties:{white_noise_model:'native-compositor-white-noise-fixed-cpu-53-v1',white_noise_profile:'darwin-arm64-53-white-noise-cpu-v1',white_noise_version:[5,3,0],white_noise_build:'02f0899d78e3',white_noise_evaluator:'CPU-MF',noise_dimensions:2,evaluation_device:'CPU',single_value_device:'CPU'},inputs:{Vector:{name:'Vector',socketType:'VECTOR',value:{kind:'constant',type:'VECTOR',value:literal}}}}
  const constant=buildCompositorWhiteNoise(op,message=>{throw Error(message)}),u=uniform(proof.literalHash,'uint'),ul=uint(proof.literalHash)
  const h=hash().toVar()
  const cases=[
   {kind:'source-x-bits',node:vec4(float(bitcast(position.x,'uint').bitAnd(uint(65535))),float(bitcast(position.x,'uint').shiftRight(uint(16))),position.x,1)},
   {kind:'source-y-bits',node:vec4(float(bitcast(position.y,'uint').bitAnd(uint(65535))),float(bitcast(position.y,'uint').shiftRight(uint(16))),position.y,1)},
   {kind:'field-unmaterialized-production-wrapper',node:encode(hash(),compositorWhiteNoiseHash(2,position,float(0),false))},
   {kind:'field-materialized-same-normalization-body',node:encode(h,float(h).div(4294967295.0))},
   {kind:'same-fixed-seeds-production-compositor',node:vec4(constant,constant,constant,1)},
   {kind:'uint-uniform-convert-divide-multiply',node:vec4(float(u),float(u).div(4294967295.0),float(u).mul(2**-32),1)},
   {kind:'uint-literal-convert-divide-multiply',node:vec4(float(ul),float(ul).div(4294967295.0),float(ul).mul(2**-32),1)}
  ]
  for(const entry of cases){
   const m=material(entry.node),quad=new QuadMesh(m);await draw(quad);if(entry.kind.startsWith('source-')||entry.kind.startsWith('field-'))table.attest(renderer)
   const got=await read(),values=[],words=[]
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const offset=((rowFlip?height-1-y:y)*got.stride+x)*4;values.push([...got.pixels.slice(offset,offset+4)]);words.push([...got.words.slice(offset,offset+4)])
   }
   const shader=await renderer.debug.getShaderAsync(quad,quad.camera,quad)
   rows.push({kind:entry.kind,values,words,fragmentShader:shader.fragmentShader,vertexShader:shader.vertexShader});m.dispose();owned.delete(m)
  }
  const validation=await device?.popErrorScope();if(validation)errors.push(validation.message);if(errors.length)throw Error(JSON.stringify(errors))
  return {status:'EXPERIMENT_ONLY_HASH_STAGE_DIAGNOSTIC',portCredit:0,backend,gpu,rowFlip,rows,errors,table:table.statistics}
 }finally{table.dispose();owned.forEach(m=>m.dispose());renderer.setRenderTarget(null);target.dispose();renderer.dispose();supplied?.destroy()}
}
