import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {Fn,If,abs,ceil,float,floor,int,round,texture,trunc,uv,vec4} from 'three/tsl'

const functions={}
for(const mode of ['ROUND','FLOOR','CEILING','TRUNCATE']){
 functions['builtin-'+mode]=Fn(([value])=>int(({ROUND:round,FLOOR:floor,CEILING:ceil,TRUNCATE:trunc}[mode])(value)))
  .setLayout({name:'privateFloatToIntBuiltin'+mode,type:'int',inputs:[{name:'value',type:'float'}]})
 functions['candidate-'+mode]=Fn(([value])=>{
  const result=int(value).toVar()
  if(mode==='ROUND'){
   const fraction=abs(value.sub(float(result))).toVar()
   If(fraction.greaterThanEqual(.5),()=>{
    If(value.lessThan(0),()=>{result.subAssign(int(1))}).Else(()=>{result.addAssign(int(1))})
   })
  }else if(mode==='FLOOR')If(value.lessThan(float(result)),()=>{result.subAssign(int(1))})
  else if(mode==='CEILING')If(value.greaterThan(float(result)),()=>{result.addAssign(int(1))})
  return result
 }).setLayout({name:'privateFloatToIntStaged'+mode,type:'int',inputs:[{name:'value',type:'float'}]})
}
const normalOrZero=word=>(word&0x7fffffff)===0||(word&0x7f800000)!==0
const valueOfWord=word=>new Float32Array(new Uint32Array([word]).buffer)[0]
const safe=control=>Number.isFinite(valueOfWord(control.word))&&normalOrZero(control.word)&&Math.abs(valueOfWord(control.word))<=2**24

window.runTrial=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),webgl=wanted==='webgl2'
 const adapter=webgl?undefined:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(!webgl&&!adapter)throw new Error('FloatToInt trial requires an actual WebGPU adapter; fallback is not API qualification')
 const supplied=await adapter?.requestDevice({requiredFeatures:[...adapter.features]})
 const renderer=new WebGPURenderer({forceWebGL:webgl,antialias:false,...(supplied?{device:supplied}:{})});await renderer.init()
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2'
 if(backend!==wanted){renderer.dispose();supplied?.destroy();throw new Error('FloatToInt actual renderer backend differs from requested '+wanted)}
 const device=renderer.backend.device,gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),info=adapter?.info??device?.adapterInfo
 const gpu=info?{api:'WebGPU',vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}
  :{api:'WebGL2',vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 renderer.setPixelRatio(1);renderer.setSize(8,8);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const target=new THREE.RenderTarget(8,8,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
 const rows=[],errors=[];renderer.debug.onShaderError=(context,program)=>errors.push(context.getProgramInfoLog(program))
 for(const scenario of ['qualified-points','excluded-controls']){
  const available=proof.controls.map((control,index)=>({...control,index})).filter(control=>scenario==='qualified-points'?safe(control):!safe(control))
  const indices=Array.from({length:64},(_,index)=>available[index%available.length].index)
  const words=new Uint32Array(64*4)
  indices.forEach((index,pixel)=>{for(let channel=0;channel<3;channel++)words[pixel*4+channel]=proof.controls[index].word;words[pixel*4+3]=0x3f800000})
  const map=new THREE.DataTexture(new Float32Array(words.buffer),8,8,THREE.RGBAFormat,THREE.FloatType)
  map.colorSpace=THREE.NoColorSpace;map.magFilter=map.minFilter=THREE.NearestFilter;map.generateMipmaps=false;map.flipY=false;map.needsUpdate=true
  let flip
  for(const key of ['identity',...Object.keys(functions)]){
   const material=new NodeMaterial(),input=texture(map,uv()).r
   const value=key==='identity'?input:float(functions[key](input))
   material.fragmentNode=vec4(value,value,value,1)
   const quad=new QuadMesh(material);renderer.setRenderTarget(target);device?.pushErrorScope('validation');quad.render(renderer)
   const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,8,8)
   if(!(pixels instanceof Float32Array))throw new Error('Float32 readback is required')
   const actualWords=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length)
   const paddedStride=Math.ceil(8*16/256)*256/16
   const stride=pixels.length===8*8*4?8:backend==='webgpu'&&pixels.length===4*(paddedStride*7+8)?paddedStride:0
   if(!stride)throw new Error('Unknown actual Float32 readback row layout '+pixels.length)
   const measured=flipped=>indices.map((_,index)=>actualWords[((flipped?7-Math.floor(index/8):Math.floor(index/8))*stride+index%8)*4])
   if(key==='identity'){
    const matches=flipped=>measured(flipped).reduce((count,word,index)=>count+(word!==words[index*4]),0)
    flip=matches(true)<matches(false)
    const changed=measured(flip).flatMap((word,index)=>word!==words[index*4]?[{control:available[index%available.length].name,requested:words[index*4],actual:word}]:[])
    if(scenario==='qualified-points'&&changed.length)throw new Error('Qualified input texture word calibration failed '+JSON.stringify(changed))
    rows.push({scenario,kernel:key,controls:available.length,wordChanges:changed,flipRows:flip})
   }else{
    const mode=key.split('-')[1],actual=measured(flip),expected=proof.expected[mode]
    const mismatches=actual.flatMap((word,index)=>word!==expected[indices[index]]?[{control:proof.controls[indices[index]].name,inputWord:proof.controls[indices[index]].word,nativeWord:expected[indices[index]],browserWord:word}]:[])
    rows.push({scenario,kernel:key,controls:available.length,pixels:actual.length,mismatches,actualWords:actual})
   }
   const failure=await device?.popErrorScope();if(failure)errors.push(failure.message)
   material.dispose()
  }
  map.dispose()
 }
 renderer.setRenderTarget(null);target.dispose();const remainingTextures=renderer.info.memory.textures
 renderer.dispose();supplied?.destroy()
 if(errors.length)throw new Error('Shader/device errors '+JSON.stringify(errors))
 if(remainingTextures!==0)throw new Error('Private trial resources leaked '+remainingTextures)
 return{backend,gpu,rows,remainingTextures,errors}
}
