import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { textureLoad, ivec2, uv, vec2, vec3, vec4, uint, bitcast } from 'three/tsl'
import { compositorCpuLuminanceDot, compositorCpuLuminanceStage } from 'luma-dot-under-test'
import { compositorCpuLuminanceRatio } from 'luma-ratio-under-test'
import { lumaGradualMultiplyBits, lumaGradualAddBits, lumaGradualDotBits } from 'luma-gradual-under-test'
try {
 const webgl=new URLSearchParams(location.search).get('backend')==='webgl2'
 const adapter=webgl?undefined:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(!webgl&&!adapter)throw new Error('WebGPU missing')
 const device=await adapter?.requestDevice({requiredFeatures:[...adapter.features]})
 const renderer=new WebGPURenderer({forceWebGL:webgl,...(device?{device}:{})});await renderer.init();renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const gl=(renderer.backend as any).gl,extension=gl?.getExtension('WEBGL_debug_renderer_info')
 const gpu=adapter?{vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,isFallbackAdapter:adapter.info?.isFallbackAdapter}:{renderer:gl?.getParameter(extension?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 const files=await(await fetch('/index.json')).json(),rows=[]
 for(const file of files){
  const test=await(await fetch('/'+file)).json(),{width,height}=test
  const operation=test.operation??(test.weights?(test.sourceCpuProfile?.mode==='gradual-rne'?'gradual-dot':'dot'):'ratio')
  const dot=operation==='dot'||operation==='gradual-dot',words=dot?null:test.inputWords
  const values=new Float32Array(width*height*4)
  if(dot){const bits=new Uint32Array(values.buffer);for(let i=0;i<width*height;i++){for(let c=0;c<3;c++)bits[i*4+c]=test.inputWords[i*3+c];values[i*4+3]=1}}
  else words.forEach((word:number,i:number)=>values.set([word&2047,word>>>11&2047,word>>>22,1],i*4))
  const input=new THREE.DataTexture(values,width,height,THREE.RGBAFormat,THREE.FloatType);input.needsUpdate=true
  renderer.setSize(width,height)
  const sample=textureLoad(input,ivec2(uv().mul(vec2(width,height))))
  const unpackWord=(sample:any)=>uint(sample.r).bitOr(uint(sample.g).shiftLeft(uint(11))).bitOr(uint(sample.b).shiftLeft(uint(22)))
  const unpack=(sample:any)=>bitcast(unpackWord(sample),'float')
  let divisorTexture:THREE.DataTexture|undefined,divisorSample:any
  if(!dot){
   const packed=new Float32Array(width*height*4);test.divisorWords.forEach((word:number,i:number)=>packed.set([word&2047,word>>>11&2047,word>>>22,1],i*4))
   divisorTexture=new THREE.DataTexture(packed,width,height,THREE.RGBAFormat,THREE.FloatType);divisorTexture.needsUpdate=true;divisorSample=textureLoad(divisorTexture,ivec2(uv().mul(vec2(width,height))))
  }
  const evaluated=dot?(operation==='gradual-dot'?bitcast(lumaGradualDotBits(sample.rgb,vec3(...test.weights)),'float'):compositorCpuLuminanceDot(sample.rgb,vec3(...test.weights))):operation==='multiply'?bitcast(lumaGradualMultiplyBits(unpackWord(sample),unpackWord(divisorSample)),'float'):operation==='add'?bitcast(lumaGradualAddBits(unpackWord(sample),unpackWord(divisorSample)),'float'):compositorCpuLuminanceRatio(operation==='ratio-ftz'?compositorCpuLuminanceStage(unpack(sample)):unpack(sample),unpack(divisorSample))
  const material=new NodeMaterial(),quad=new QuadMesh(material),target=new THREE.RenderTarget(width,height,{type:THREE.FloatType,depthBuffer:false})
  const render=async(node:any)=>{material.fragmentNode=node;material.needsUpdate=true;renderer.setRenderTarget(target);quad.render(renderer);return await renderer.readRenderTargetPixelsAsync(target,0,0,width,height)as Float32Array}
  const control=await render(vec4(sample.rgb,1)),stride=webgl?width:Math.ceil(width/16)*16
  const controlBits=new Uint32Array(control.buffer,control.byteOffset,control.length),sourceBits=new Uint32Array(values.buffer)
  const matches=(flip:boolean)=>{
   for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++)if(controlBits[((flip?height-1-y:y)*stride+x)*4+c]!==sourceBits[(y*width+x)*4+c])return false
   return true
  }
  const flip=!matches(false);if(!matches(flip))throw new Error('Independent input bits changed')
  if(!dot){const control=await render(vec4(divisorSample.rgb,1));test.divisorWords.forEach((word:number,i:number)=>{const x=i%width,y=Math.floor(i/width),offset=((flip?height-1-y:y)*stride+x)*4;if(control[offset]!== (word&2047)||control[offset+1]!== (word>>>11&2047)||control[offset+2]!== (word>>>22))throw new Error('Independent divisor bits changed')})}
  const actual=await render(vec4(evaluated,0,0,1)),actualBits=new Uint32Array(actual.buffer,actual.byteOffset,actual.length),expectedBits=test.expectedWords?new Uint32Array(test.expectedWords):new Uint32Array(new Float32Array(test.expected).buffer)
  let mismatches=0,worst
  expectedBits.forEach((word:number,i:number)=>{const x=i%width,y=Math.floor(i/width),offset=((flip?height-1-y:y)*stride+x)*4;if(actualBits[offset]!==word){mismatches++;worst={index:i,actualBits:actualBits[offset],expectedBits:word,actual:actual[offset],expected:test.expected[i]}}})
  renderer.setRenderTarget(null);material.dispose();target.dispose();input.dispose();divisorTexture?.dispose()
  rows.push({operation,native:test.native,hash:test.hash,count:expectedBits.length,mismatches,worst,gpu,remainingTextures:renderer.info.memory.textures})
 }
 renderer.dispose();(window as any).__lumaPrimitiveRows=rows
}catch(error){(window as any).__lumaPrimitiveError=String(error)}
