/* SPDX-License-Identifier: MIT */
/** Private pinned CPU RGBA interpolation stages. This is not a new source IR
 * option. Other image samplers retain their existing generated arithmetic. */
import {bitcast,uniform,vec4} from 'three/tsl'
import type {TslEffectNode} from './tslPostEffects.js'
const cast=bitcast as unknown as(value:TslEffectNode,type:string)=>TslEffectNode
const makeVec4=vec4 as unknown as(...values:TslEffectNode[])=>TslEffectNode
const makeUniform=uniform as unknown as(value:number,type:string)=>TslEffectNode
export function createDisplaceCpuRgbaStages():(a:TslEffectNode,b:TslEffectNode,c:TslEffectNode,d:TslEffectNode,x:TslEffectNode,y:TslEffectNode)=>TslEffectNode{
 // A runtime uniform zero keeps the integer operation nontrivial to the GPU
 // compiler. OR with zero preserves every IEEE word, including NaN payloads
 // and signed zero; it is a rounding boundary, never a value repair.
 const zero=makeUniform(0,'uint')
 const round=(value:TslEffectNode,vector=false):TslEffectNode=>{
  if(vector){const staged=value.toVar();return makeVec4(...['r','g','b','a'].map(channel=>round(staged[channel])))}
  return cast(cast(value,'uint').bitOr(zero),'float')
 }
 return(a,b,c,d,x,y)=>{
  const left=round(x.oneMinus()),bottom=round(y.oneMinus())
  const weights=[round(left.mul(bottom)),round(x.mul(bottom)),round(left.mul(y)),round(x.mul(y))]
  const products=[a,b,c,d].map((value,index)=>round(value.mul(weights[index]),true))
  const pair0=round(products[0].add(products[1]),true),pair1=round(products[2].add(products[3]),true)
  return round(pair0.add(pair1),true).toVar().onRenderUpdate(()=>{
   if(zero.value!==0)throw Error('Displace CPU interpolation requires its unchanged private rounding uniform')
  })
 }
}
