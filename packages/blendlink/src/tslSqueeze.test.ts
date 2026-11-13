import { describe,expect,it } from 'vitest'
import { buildTslColorNode,type TslIrExpression } from './tslNodeRecipe.js'
import { squeezeScalarBounds,validSqueezeExpression } from './tslSqueeze.js'
const scalar=(value:number):TslIrExpression=>({op:'const_float',value})
const squeeze=(value:TslIrExpression=scalar(0)):TslIrExpression=>({op:'squeeze_native',model:'eevee-squeeze-f32-v1',sourceEngine:'EEVEE',sourceProfile:'darwin-arm64-metal-v1',nativeVersion:[5,2,0],nativeGpuBackend:'METAL',inputModel:'opaque-nearest-f32-data-or-literal-v1',value,width:scalar(1),center:scalar(0)})
const image=():TslIrExpression=>({op:'separate',channel:'x',input:{op:'tex_image',sourceEngine:'EEVEE',nativeGpuBackend:'METAL',sourceImageStorage:'rgba32f',sourceImageUploadRounding:'none',width:2,height:1,pixels:[-8,0,0,1,8,1,0,1],interpolation:'Closest',extension:'REPEAT',output:'color',vector:{op:'const_vec3',value:[.25,.75,0]}}})
const linux=(value:TslIrExpression=scalar(0)):TslIrExpression=>({...squeeze(value),sourceProfile:'linux-x86_64-llvmpipe20-opengl-v1',nativeGpuBackend:'OPENGL',sourceBuildHash:'fbe6228777e7',nativeGpuRenderer:'llvmpipe (LLVM 20.1.2, 256 bits)'})
const build=(output:TslIrExpression)=>buildTslColorNode({schemaVersion:1,model:'blendlink-tsl-ir-v1',output})

describe('bounded native EEVEE Squeeze',()=>{
 it('accepts default, signed width and bounded nested instances through production dispatch',()=>{
  for(const value of [scalar(0),scalar(-1),scalar(1),squeeze()]){
   const ir=squeeze(value);expect(validSqueezeExpression(ir,[5,2,0])).toBe(true);expect(build(ir).isNode).toBe(true)
   ir.width=scalar(-1);expect(build(ir).isNode).toBe(true)
  }
 })
 it('recomputes data-image bounds and refuses spatial UV coordinates',()=>{
  const input=image();expect(squeezeScalarBounds(input,[5,2,0])).toEqual([-8,8]);expect(build(squeeze(input)).isNode).toBe(true)
  const texture=input.input as TslIrExpression;texture.extension='CLIP';texture.pixels=[2,0,0,1,4,1,0,1]
  expect(squeezeScalarBounds(input,[5,2,0])).toEqual([0,4])
  texture.vector={op:'const_vec3',value:[-8,16,0]};expect(build(squeeze(input)).isNode).toBe(true)
  expect(()=>build(squeeze({op:'separate',channel:'x',input:{op:'uv',range:[0,1]}}))).toThrow(/Squeeze Value/)
  texture.vector={op:'uv_active',range:[0,1]};expect(()=>build(squeeze(input))).toThrow(/Squeeze Value/)
 })
 it('independently refuses forged versions, models, ranges and dangerous products before texture creation',()=>{
  for(const patch of [{model:'future'},{sourceEngine:'CYCLES'},{nativeVersion:[4,2,0]},{nativeVersion:[5,2,1]},
   {nativeVersion:[5,2,false]},{sourceProfile:'linux-x64'},{nativeGpuBackend:'OPENGL'},{inputModel:'asserted-range'},
   {value:scalar(Infinity)},{value:scalar(.1)},{value:scalar(16.001)},
   {value:scalar(16),width:scalar(2),center:scalar(0)},
   {value:{op:'math',operation:'ADD',a:scalar(0),b:scalar(1),range:[0,1]}},
  ])expect(()=>build({...squeeze(),...patch})).toThrow(/Squeeze Value/)
 })
 it('validates actual image bytes and source sampling shape including sparse arrays',()=>{
  for(const change of [
   (v:any)=>{v.input.pixels[0]=32},(v:any)=>{v.input.pixels[0]=NaN},(v:any)=>{v.input.pixels[0]=.1},
   (v:any)=>{v.input.pixels[3]=.5},(v:any)=>{delete v.input.pixels[1]},(v:any)=>{v.input.width=3},
   (v:any)=>{v.input.interpolation='Linear'},(v:any)=>{v.input.sourceImageStorage='rgba16f'},
   (v:any)=>{v.input.sourceImageUploadRounding='toward-zero'},(v:any)=>{v.input.nativeGpuBackend='OPENGL'},
   (v:any)=>{v.input.projection='box'},(v:any)=>{v.input.vector={op:'generated'}},
   (v:any)=>{v.input.op='texture_ref'},
  ]){const value=image();change(value);expect(()=>build(squeeze(value))).toThrow(/Squeeze Value/)}
 })
 it('caps actual pixel work and rejects oversize payloads before traversing them',()=>{
  const channel=image(),map=channel.input as TslIrExpression
  Object.assign(map,{width:32,height:32,pixels:Array.from({length:1024},()=>[.25,.5,.125,1]).flat()})
  const ir=squeeze(channel);ir.width={...channel,channel:'y'};ir.center={...channel,channel:'z'}
  const work={nodes:0,pixels:0};expect(validSqueezeExpression(ir,[5,2,0],0,work)).toBe(true);expect(work.pixels).toBe(12288)
  expect(()=>build(squeeze(ir))).not.toThrow()
  const extra=squeeze(ir);extra.width=channel;expect(()=>build(extra)).toThrow(/bounded validation work/)
  Object.assign(map,{width:1025,height:1,pixels:new Proxy([],{get(_target,key){if(key==='length')return 4100;throw new Error('Oversize pixel storage was visited')}})})
  expect(()=>build(squeeze(channel))).toThrow(/Squeeze Value/)
 })
 it('keeps the measured steep cascade slice within the shared depth budget',()=>{
  for(const value of [.5-2**-25,.5,.5+2**-24])for(let depth=2;depth<=8;depth++){
   let ir=scalar(value)
   for(let index=0;index<depth;index++)ir={...squeeze(ir),width:scalar(16),center:scalar(.5)}
   if(depth<=4){expect(validSqueezeExpression(ir,[5,2,0])).toBe(true);expect(build(ir).isNode).toBe(true)}
   else expect(()=>build(ir)).toThrow(/bounded validation work/)
  }
 })
 it('does not certify a nested Squeeze from a different source context',()=>{
  const child=squeeze();child.nativeVersion=[5,3,0]
  expect(()=>build(squeeze(child))).toThrow(/Squeeze Value/)
  const matching=squeeze(child);matching.nativeVersion=[5,3,0]
  expect(build(matching).isNode).toBe(true)
 })
 it('admits only the measured Linux source build and actual llvmpipe renderer with matching image and nested profiles',()=>{
  expect(build(linux()).isNode).toBe(true)
  const channel=image();(channel.input as TslIrExpression).nativeGpuBackend='OPENGL'
  expect(build(linux(channel)).isNode).toBe(true)
  expect(build(linux(linux(channel))).isNode).toBe(true)
  for(const patch of [{sourceBuildHash:'unknown'},{sourceBuildHash:undefined},{nativeGpuRenderer:'unmeasured OpenGL driver'},
   {nativeGpuRenderer:undefined},{nativeGpuBackend:'METAL'},{nativeGpuBackend:'VULKAN'},{nativeVersion:[5,3,0]},
   {sourceProfile:'linux-x86_64-opengl-trial-v1'},
  ])expect(()=>build({...linux(),...patch})).toThrow(/Squeeze Value/)
  expect(()=>build(linux(image()))).toThrow(/Squeeze Value/)
  expect(()=>build(linux(squeeze()))).toThrow(/Squeeze Value/)
  expect(()=>build(squeeze(linux()))).toThrow(/Squeeze Value/)
 })
})
