/* SPDX-License-Identifier: MIT */
/** CPU-profile rectangle classification. Shader math never re-evaluates its floating boundary. */
import{Vector2,Vector4}from'three'
import*as TSL from'three/tsl'
import {validateStaticMaskDomains} from './tslCompositorMaskDomains.js'
import type{SourceCompositorOperation,SourceCompositorProgram}from'./sourceDisplay.js'
import type{TslEffectNode}from'./tslPostEffects.js'
const{float,floor,ivec2,select,uniform,uv}=TSL as unknown as Record<string,(...args:any[])=>TslEffectNode>
export type BoxMaskSettings={operation:'ADD'|'SUBTRACT'|'MULTIPLY'|'NOT',position:readonly number[],size:readonly number[],mask:number,value:number}
const normal=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&Math.fround(n)===n&&!Object.is(n,-0)&&(n===0||Math.abs(n)>=2**-126)
const pair=(n:unknown):n is number[]=>Array.isArray(n)&&n.length===2&&n.every(normal)
const bounded=(n:number)=>n===0||Math.abs(n)>=2**-16
const word=(n:number)=>{const b=new ArrayBuffer(4),v=new DataView(b);v.setFloat32(0,n,true);return v.getUint32(0,true)}
const f=Math.fround
/** Inputs and every output use native Float32 stages; no rounded artist-input grid. */
export function boxMaskValues(s:BoxMaskSettings):readonly[number,number]{
 const{mask:m,value:v,operation:o}=s
 const inside=o==='ADD'?Math.max(m,v):o==='SUBTRACT'?Math.min(1,Math.max(0,f(m-v))):o==='MULTIPLY'?f(m*v):m>0?0:v
 if(!normal(inside))throw Error('Box Mask subnormal/negative-zero output remains unqualified')
 return[inside,o==='MULTIPLY'?0:m]
}
/** O(W+H), run only when physical extent changes. Strict equality remains outside. */
export function boxMaskIntervals(width:number,height:number,s:BoxMaskSettings):readonly[number,number,number,number]{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||width>8192||height>8192)throw Error('Box Mask requires physical extents in [2,8192]')
 const bounds:number[]=[],aspect=f(height/width)
 for(let axis=0;axis<2;axis++){
  const dimension=axis===0?width:height,half=f(s.size[axis]!/2);let first=dimension,last=-1,ended=false
  for(let pixel=0;pixel<dimension;pixel++){
   let coordinate=f(f(pixel/(dimension-1))-s.position[axis]!)
   if(axis===1)coordinate=f(coordinate*aspect)
   const inside=Math.abs(coordinate)<half
   if(inside){if(ended)throw Error('Box Mask CPU axis is not contiguous');first=Math.min(first,pixel);last=pixel}else if(last>=0)ended=true
  }
  bounds.push(first,last)
 }
 return bounds as unknown as readonly[number,number,number,number]
}
export function validateBoxMaskGraph(program:SourceCompositorProgram,fail:(message:string)=>never):void{
 validateStaticMaskDomains(program,'CompositorNodeBoxMask',fail)
}
export function buildCompositorBoxMask(op:SourceCompositorOperation,ops:readonly SourceCompositorOperation[],fail:(message:string)=>never):TslEffectNode{
 const p=op.properties,index=ops.indexOf(op)
 if(op.kind!=='box-mask'||op.type!=='VALUE'||op.source.nodeType!=='CompositorNodeBoxMask'||op.source.output!=='Mask'
  ||p?.box_mask_model!=='cpu-f32-axis-integer-intervals-v1'||p.box_mask_source_profile!=='darwin-arm64-53-box-mask-cpu-v1'
  ||JSON.stringify(p.box_mask_native_version)!=='[5,3,0]'||p.box_mask_reference_model!=='full-frame-context-zero-offset-v1'
  ||p.box_mask_precision!=='CPU_FLOAT32'||!['AUTO','FULL'].includes(String(p.box_mask_requested_precision))
  ||p.box_mask_scalar_storage!=='native-interface-copy-f32-v1'||p.box_mask_literal_model!=='zero-or-2^-16-bounded-f32-v1'
  ||p.evaluation_device!=='CPU'||p.single_value_device!=='CPU'||!op.inputs||Object.keys(op.inputs).length!==0
  ||!['ADD','SUBTRACT','MULTIPLY','NOT'].includes(String(p.box_mask_operation))
  ||!pair(p.box_mask_position)||!p.box_mask_position.every(n=>n>=-2&&n<=2&&bounded(n))
  ||!pair(p.box_mask_size)||!p.box_mask_size.every(n=>n>=0&&n<=2&&bounded(n))
  ||!normal(p.box_mask_mask)||!bounded(p.box_mask_mask)||p.box_mask_mask<0||p.box_mask_mask>1||!normal(p.box_mask_value)||!bounded(p.box_mask_value)||p.box_mask_value<0||p.box_mask_value>1
  ||!Array.isArray(p.box_mask_export_extent)||p.box_mask_export_extent.length!==2||!p.box_mask_export_extent.every(n=>Number.isInteger(n)&&n>=2&&n<=8192)
  ||index<0||ops.length>2048||new Set(ops.map(n=>n.id)).size!==ops.length)return fail('Box Mask requires its bounded static native CPU Float32 source/precision/domain schema')
 if(JSON.stringify(p.box_mask_scalar_words)!==JSON.stringify([word(p.box_mask_mask),word(p.box_mask_value),0]))return fail('Box Mask requires matching raw stored scalar Float32 words, including rotation positive zero')
 const settings:BoxMaskSettings={operation:p.box_mask_operation as BoxMaskSettings['operation'],position:[...p.box_mask_position],size:[...p.box_mask_size],mask:p.box_mask_mask,value:p.box_mask_value}
 let values:readonly[number,number];try{values=boxMaskValues(settings)}catch(e){return fail(String(e))}
 const dimensions=new Vector2(),drawing=new Vector2(),rectangle=new Vector4();let key=''
 const validate=(frame:any)=>{
  frame.renderer.getDrawingBufferSize(drawing);const target=frame.renderer.getRenderTarget?.()
  if(!Number.isInteger(drawing.x)||!Number.isInteger(drawing.y)||drawing.x<2||drawing.y<2||drawing.x>8192||drawing.y>8192
   ||target&&(target.width!==drawing.x||target.height!==drawing.y))return fail('Box Mask requires matching full-frame physical drawing/target extents in [2,8192], including resize/DPR changes')
  const next=drawing.x+':'+drawing.y
  // Stage all validation/computation before replacing the sole cached extent.
  // A rejected resize never mutates live uniforms or its previous cache entry.
  if(next!==key){const b=boxMaskIntervals(drawing.x,drawing.y,settings);rectangle.set(...b);dimensions.copy(drawing);key=next}
  return dimensions
 }
 const bounds=uniform!(rectangle,'ivec4'),size=uniform!(dimensions,'ivec2').onRenderUpdate(validate)
 const pixel=ivec2!(floor!(uv!().mul(size)))
 const inside=pixel.x.greaterThanEqual(bounds.x).and(pixel.x.lessThanEqual(bounds.y)).and(pixel.y.greaterThanEqual(bounds.z)).and(pixel.y.lessThanEqual(bounds.w))
 // The result VarNode owns the guard even when all-zero/constant selections
 // make the geometry uniform unnecessary to the final shader optimizer.
 return select!(inside,float!(values[0]),float!(values[1])).toVar().onRenderUpdate((frame:any)=>{validate(frame)})
}
