/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded original expression for Blender's legacy EEVEE Squeeze function.
 * Source revisions/precision corpus are pinned in experiments/squeeze-node-differential. */
import { Fn, float, pow } from 'three/tsl'
import type { TslExpression, TslIrExpression } from './tslNodeRecipe.js'
const MODEL='eevee-squeeze-f32-v1',SOURCE='linux-x86_64-opengl-trial-v1',INPUT='opaque-nearest-f32-data-or-literal-v1'
const versions=['5.2.0','5.3.0']
const record=(value:unknown):value is TslIrExpression=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof(value as TslIrExpression).op==='string'
const literal=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=16&&Math.fround(value)===value
function metadata(ir:TslIrExpression,version:readonly number[]):boolean {
  return ir.op==='squeeze_native'&&ir.model===MODEL&&ir.sourceEngine==='EEVEE'&&ir.sourceProfile===SOURCE
    &&ir.inputModel===INPUT&&ir.nativeGpuBackend==='OPENGL'&&Array.isArray(ir.nativeVersion)
    &&ir.nativeVersion.length===3&&version.every((part,index)=>Object.hasOwn(ir.nativeVersion as unknown[],index)&&(ir.nativeVersion as number[])[index]===part)
}
export function squeezeScalarBounds(ir:TslIrExpression,version:readonly number[],depth=0,work={nodes:0,pixels:0}):[number,number]|null {
  if(++work.nodes>64||depth>8||!record(ir))return null
  if(ir.op==='const_float'&&literal(ir.value))return[ir.value,ir.value]
  if(ir.op==='squeeze_native')return validSqueezeExpression(ir,version,depth+1,work)?[0,1]:null
  const axis=['x','y','z'].indexOf(String(ir.channel)),image=ir.input
  if(ir.op!=='separate'||axis<0||!record(image)||image.op!=='tex_image'||image.sourceEngine!=='EEVEE'
    ||image.nativeGpuBackend!=='OPENGL'||image.sourceImageStorage!=='rgba32f'||image.sourceImageUploadRounding!=='none'
    ||image.interpolation!=='Closest'||image.output!=='color'||!['REPEAT','EXTEND','CLIP'].includes(String(image.extension))
    ||(image.projection??'flat')!=='flat')return null
  const vector=image.vector
  if(!record(vector)||!['const_vec3','combine'].includes(vector.op))return null
  if(vector.op==='const_vec3'&&(!Array.isArray(vector.value)||vector.value.length!==3||![0,1,2].every(index=>Object.hasOwn(vector.value as unknown[],index)&&literal((vector.value as unknown[])[index]))))return null
  if(vector.op==='combine'&&!['x','y','z'].every(axis=>record(vector[axis])&&(vector[axis] as TslIrExpression).op==='const_float'&&literal((vector[axis] as TslIrExpression).value)))return null
  const {width,height,pixels}=image
  if(typeof width!=='number'||!Number.isInteger(width)||width<1||typeof height!=='number'||!Number.isInteger(height)||height<1||width*height>1024
    ||!Array.isArray(pixels)||pixels.length!==width*height*4)return null
  work.pixels+=pixels.length;if(work.pixels>12288)return null
  for(let index=0;index<pixels.length;index++)if(!Object.hasOwn(pixels,index)||!literal(pixels[index]))return null
  let low=image.extension==='CLIP'?0:Infinity,high=image.extension==='CLIP'?0:-Infinity
  for(let index=0;index<pixels.length;index+=4){if(pixels[index+3]!==1)return null;low=Math.min(low,pixels[index+axis]!);high=Math.max(high,pixels[index+axis]!)}
  return[low,high]
}
export function validSqueezeExpression(ir:TslIrExpression,version:readonly number[],depth=0,work={nodes:0,pixels:0}):boolean {
  if(++work.nodes>64||depth>8||version.length!==3||!versions.includes(version.join('.'))||!metadata(ir,version))return false
  const ranges=['value','width','center'].map(key=>record(ir[key])?squeezeScalarBounds(ir[key] as TslIrExpression,version,depth+1,work):null)
  if(ranges.some(range=>!range||range.some(value=>Math.abs(value)>16)))return false
  const [value,width,center]=ranges as [number,number][]
  const delta=[Math.fround(value![0]-center![1]),Math.fround(value![1]-center![0])]
  return Math.max(...delta.flatMap(d=>width!.map(w=>Math.abs(Math.fround(d*w)))))<=24
}
// Parameterized module-level function: repeated/cascaded instances cannot
// capture a different node's controls through a shared TSL closure cache.
const squeeze=(Fn as any)(([value,width,center]:any[])=>{
  const delta=value.sub(center).toVar(),argument=delta.mul(width).negate().toVar()
  return (float(1) as any).div((float(1) as any).add(pow(float(Math.fround(2.71828183)),argument)))
}).setLayout({name:'blendlinkEeveeSqueezeF32V1',type:'float',inputs:[{name:'value',type:'float'},{name:'width',type:'float'},{name:'center',type:'float'}]})
export function buildTslSqueeze(ir:TslIrExpression,build:(ir:TslIrExpression)=>TslExpression,fail:(message:string)=>never):TslExpression {
  const version=ir.nativeVersion
  if(!Array.isArray(version)||version.length!==3||![0,1,2].every(index=>Object.hasOwn(version,index)&&typeof version[index]==='number'&&Number.isInteger(version[index]))
    ||!versions.includes(version.join('.'))||!validSqueezeExpression(ir,version))
    return fail('Squeeze Value requires its verified EEVEE source/version and bounded literal or opaque nearest Float32 image inputs with literal coordinates; inputs must stay within magnitude 16 and |(Value-Center)*Width| <=24; images are limited to 1024 texels and bounded validation work')
  return squeeze(build(ir.value as TslIrExpression),build(ir.width as TslIrExpression),build(ir.center as TslIrExpression)) as TslExpression
}
