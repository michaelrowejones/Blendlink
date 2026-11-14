/* SPDX-License-Identifier: MIT */
/** Pinned native CPU boundary decisions; the shader loads integer row intervals. */
import {DataTexture,IntType,NearestFilter,NoColorSpace,RGIntegerFormat,Vector2} from 'three'
import * as TSL from 'three/tsl'
import {validateStaticMaskDomains} from './tslCompositorMaskDomains.js'
import type {SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'
const {float,floor,int,ivec2,select,texture,uniform,uv}=TSL as unknown as Record<string,(...args:any[])=>TslEffectNode>
export type EllipseMaskSettings={operation:'ADD'|'SUBTRACT'|'MULTIPLY'|'NOT',position:readonly number[],size:readonly number[],mask:number,value:number}
const f=Math.fround
const normal=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&f(n)===n&&!Object.is(n,-0)&&(n===0||Math.abs(n)>=2**-126)
const bounded=(n:number)=>n===0||Math.abs(n)>=2**-16
const pair=(n:unknown):n is number[]=>Array.isArray(n)&&n.length===2&&n.every(normal)
const word=(n:number)=>{const b=new ArrayBuffer(4),v=new DataView(b);v.setFloat32(0,n,true);return v.getUint32(0,true)}
function dimensions(w:number,h:number):void{if(![w,h].every(n=>Number.isInteger(n)&&n>=2&&n<=8192))throw Error('Ellipse Mask requires physical extents in [2,8192]')}
function validateSettings(s:EllipseMaskSettings):void{
 if(!['ADD','SUBTRACT','MULTIPLY','NOT'].includes(s.operation)||!pair(s.position)||!s.position.every(n=>Math.abs(n)<=2&&bounded(n))
  ||!pair(s.size)||!s.size.every(n=>n>=0&&n<=2&&bounded(n))||![s.mask,s.value].every(n=>normal(n)&&bounded(n)&&n>=0&&n<=1))throw Error('Ellipse Mask requires bounded exact normal-or-positive-zero Float32 literals')
}
export function ellipseMaskValues(s:EllipseMaskSettings):readonly[number,number]{
 validateSettings(s)
 if(s.size.some(n=>n===0))return[s.mask,s.mask]
 const a=s.operation==='ADD'?Math.max(s.mask,s.value):s.operation==='SUBTRACT'?Math.min(1,Math.max(0,f(s.mask-s.value))):s.operation==='MULTIPLY'?f(s.mask*s.value):s.mask>0?0:s.value
 if(!normal(a))throw Error('Ellipse Mask output is outside its native Float32 profile')
 return[a,s.operation==='MULTIPLY'?0:s.mask]
}
/** Source-pinned worker uses separate FMUL/FADD and FSQRT, not FMA or an epsilon. */
export function ellipseMaskMembership(x:number,y:number):boolean{return f(Math.sqrt(f(f(x*x)+f(y*y))))<1}
export function ellipseMaskAxes(w:number,h:number,s:EllipseMaskSettings):{x:Float32Array,y:Float32Array}{
 validateSettings(s);dimensions(w,h);if(s.size.some(n=>n===0))throw Error('Ellipse Mask zero Size is an identity, not a boundary field')
 const aspect=f(h/w),rx=f(s.size[0]!/2),ry=f(s.size[1]!/2)
 return{x:Float32Array.from({length:w},(_,p)=>f(f(f(p/(w-1))-s.position[0]!)/rx)),y:Float32Array.from({length:h},(_,p)=>f(f(f(f(p/(h-1))-s.position[1]!)*aspect)/ry))}
}
/** O(W+H log W), two signed inclusive bounds per row; no full-pixel CPU image. */
export function ellipseMaskRows(w:number,h:number,s:EllipseMaskSettings):Int32Array{
 validateSettings(s);dimensions(w,h);if(s.size.some(n=>n===0))return new Int32Array()
 const{x,y}=ellipseMaskAxes(w,h,s);let pivot=0;for(let i=1;i<w;i++)if(Math.abs(x[i]!)<Math.abs(x[pivot]!))pivot=i
 const rows=new Int32Array(h*2)
 for(let row=0;row<h;row++){
  const test=(i:number)=>ellipseMaskMembership(x[i]!,y[row]!);let first=w,last=-1
  if(test(pivot)){
   let lo=0,hi=pivot;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(test(mid))hi=mid;else lo=mid+1}first=lo
   lo=pivot;hi=w-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(test(mid))lo=mid;else hi=mid-1}last=lo
  }
  rows[row*2]=first;rows[row*2+1]=last
 }
 return rows
}
export function validateEllipseMaskGraph(program:SourceCompositorProgram,fail:(message:string)=>never):void{
 validateStaticMaskDomains(program,'CompositorNodeEllipseMask',fail)
}
export function buildCompositorEllipseMask(op:SourceCompositorOperation,ops:readonly SourceCompositorOperation[],resources:{dispose():void}[],fail:(message:string)=>never,program?:SourceCompositorProgram):TslEffectNode{
 if(program&&program.ops!==ops)return fail('Ellipse Mask full graph must retain the exact operation-list identity')
 validateStaticMaskDomains(program??{ops:[...ops]} as SourceCompositorProgram,'CompositorNodeEllipseMask',fail)
 const p=op.properties,index=ops.indexOf(op)
 if(op.kind!=='ellipse-mask'||op.type!=='VALUE'||op.source.nodeType!=='CompositorNodeEllipseMask'||op.source.output!=='Mask'
  ||p?.ellipse_mask_model!=='cpu-f32-row-integer-intervals-v1'||p.ellipse_mask_source_profile!=='darwin-arm64-53-ellipse-mask-cpu-v1'
  ||JSON.stringify(p.ellipse_mask_native_version)!=='[5,3,0]'||p.ellipse_mask_reference_model!=='full-frame-context-zero-offset-v1'
  ||p.ellipse_mask_precision!=='CPU_FLOAT32'||!['AUTO','FULL'].includes(String(p.ellipse_mask_requested_precision))
  ||p.ellipse_mask_scalar_storage!=='native-interface-copy-f32-v1'||p.ellipse_mask_literal_model!=='zero-or-2^-16-bounded-f32-v1'
  ||p.ellipse_mask_boundary_model!=='separate-fmul-fadd-fsqrt-v1'||p.ellipse_mask_row_model!=='rg32i-fixed-256x32-inclusive-v1'
  ||p.evaluation_device!=='CPU'||p.single_value_device!=='CPU'||!op.inputs||Object.keys(op.inputs).length!==0
  ||!Array.isArray(p.ellipse_mask_export_extent)||p.ellipse_mask_export_extent.length!==2||!p.ellipse_mask_export_extent.every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=2&&n<=8192)
  ||index<0||ops.length>2048||new Set(ops.map(n=>n.id)).size!==ops.length)return fail('Ellipse Mask requires its bounded static native CPU Float32 source/precision/domain schema')
 const s:EllipseMaskSettings={operation:p.ellipse_mask_operation as EllipseMaskSettings['operation'],position:p.ellipse_mask_position as number[],size:p.ellipse_mask_size as number[],mask:p.ellipse_mask_mask as number,value:p.ellipse_mask_value as number}
 try{validateSettings(s)}catch(e){return fail(String(e))}
 if(p.ellipse_mask_identity!==s.size.some(n=>n===0))return fail('Ellipse Mask single-value identity must match its native zero Size')
 if(JSON.stringify(p.ellipse_mask_scalar_words)!==JSON.stringify([word(s.mask),word(s.value),0]))return fail('Ellipse Mask requires matching raw stored scalar Float32 words and rotation positive zero')
 const settings:EllipseMaskSettings={...s,position:[...s.position],size:[...s.size]},values=ellipseMaskValues(settings),dimensionsValue=new Vector2(),drawing=new Vector2()
 let key='',disposed=false
 const validateExtent=(frame:any):string=>{
  if(disposed)return fail('Ellipse Mask resources were disposed')
  frame.renderer.getDrawingBufferSize(drawing);const target=frame.renderer.getRenderTarget?.()
  try{dimensions(drawing.x,drawing.y)}catch(e){return fail(String(e))}
  if(target&&(target.width!==drawing.x||target.height!==drawing.y))return fail('Ellipse Mask requires matching full-frame physical drawing/target extents, including resize/DPR changes')
  return drawing.x+':'+drawing.y
 }
 // Native zero-Size identity and equal-value outputs need no row texture or CPU search.
 if(values[0]===values[1]){
  resources.push({dispose(){disposed=true}})
  return float!(values[0]).toVar().onRenderUpdate((frame:any)=>{validateExtent(frame)})
 }
 const data=new Int32Array(8192*2),table=new DataTexture(data,256,32,RGIntegerFormat,IntType)
 table.name='SceneToWeb Ellipse CPU row intervals';table.minFilter=table.magFilter=NearestFilter;table.generateMipmaps=false;table.flipY=false;table.colorSpace=NoColorSpace;table.unpackAlignment=1;table.matrixAutoUpdate=false
 resources.push({dispose(){if(!disposed){disposed=true;table.dispose()}}})
 const validate=(frame:any):Vector2=>{
  const next=validateExtent(frame)
  if(next!==key){
   const rows=ellipseMaskRows(drawing.x,drawing.y,settings)
   // All potentially refusing work finishes before mutating the live cache.
   data.set(rows);dimensionsValue.copy(drawing);table.needsUpdate=true;key=next
  }
  return dimensionsValue
 }
 const size=uniform!(dimensionsValue,'ivec2').onRenderUpdate(validate),pixel=ivec2!(floor!(uv!().mul(size)))
 const row=texture!(table).load(ivec2!(pixel.y.mod(int!(256)),pixel.y.div(int!(256))))
 const inside=pixel.x.greaterThanEqual(row.x).and(pixel.x.lessThanEqual(row.y))
 // Keep the guard even if shader optimization eliminates a constant selection.
 return select!(inside,float!(values[0]),float!(values[1])).toVar().onRenderUpdate((frame:any)=>{validate(frame)})
}
