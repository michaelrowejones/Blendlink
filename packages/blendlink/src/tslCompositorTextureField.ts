/* SPDX-License-Identifier: MIT */
/** Full-frame texture coordinate fields; no literal substitute for implicit position. */
import {Vector2} from 'three'
import * as TSL from 'three/tsl'
import {buildFullFrameFloatCoordinateKernel} from './tslCompositorFloatCoordinates.js'
import type {SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'
const {uniform,vec3}=TSL as unknown as Record<string,(...args:any[])=>TslEffectNode>
const DEFAULT='implicit-uniform-full-frame-v1',LINKED='linked-render-layer-float2-v1'
const spatial=new Set(['translate','image-affine','image-input','image-crop','alpha-crop','image-split','pixelate','blur','filter','glare'])
/** Seven unit-roundoffs bound ordered smoothstep polynomial error on [0,1].
 * Include the coordinate contract and native rounding; require eight u of
 * endpoint separation, preserving exact native-one controls without repair. */
export function easingFieldAdmission(width:number,height:number,output:string):boolean{
 const maximum=output==='Normalized'?1-.5/width:(width-1)/Math.max(width,height)
 const upper=Math.min(1,maximum+2**-22+2**-24)
 return 1-upper*upper*(3-2*upper)>8*2**-24
}
/** Rational pixel phases plus an outward bound on coordinate/arithmetic rounding.
 * This admits a frame only when every possible native/browser phase has the
 * same floor. No shader epsilon, branch reconstruction or tolerance is added.
 * O(width+height), cached per extent/scale; never a per-pixel/frame readback. */
export function checkerFieldAdmission(width:number,height:number,output:string,scale:number):boolean{
 if(scale===0)return true
 const epsilon=Math.fround(.000001),shrink=Math.fround(.999999),maximum=Math.max(width,height)
 for(const dimension of [width,height])for(let pixel=0;pixel<dimension;pixel++){
  const coordinate=output==='Normalized'?(pixel+.5)/dimension:(2*pixel+1-dimension)/maximum
  const coordinateError=coordinate===0?0:Math.min(2**(Math.floor(Math.log2(Math.abs(coordinate)))-21),2**-22+2**-24)
  const phase=(coordinate*scale+epsilon)*shrink
  const budget=coordinateError*scale*shrink+8*2**-24*(Math.abs(coordinate*scale)+epsilon)*shrink+2**-38
  if(Math.floor(phase-budget)!==Math.floor(phase+budget))return false
 }
 return true
}
export function textureFieldKind(op:SourceCompositorOperation):boolean{return op.properties?.procedural_texture_coordinate_model!==undefined}
export function validateTextureFieldGraph(program:SourceCompositorProgram,fail:(message:string)=>never):void{
 if(program.ops.some(textureFieldKind)&&program.ops.some(op=>spatial.has(op.kind)))fail('Procedural Texture fields require pointwise full-frame consumers; spatial/neighborhood domains remain unqualified')
}
export function buildTextureCoordinateField(op:SourceCompositorOperation,operations:readonly SourceCompositorOperation[],input:(name:string)=>TslEffectNode,fail:(message:string)=>never,checkerScale?:number):TslEffectNode{
 const index=operations.indexOf(op),prefix=index<0?[]:operations.slice(0,index)
 if(index<0||operations.length>2048||new Set([...prefix.map(item=>item.id),op.id]).size!==index+1)return fail('Procedural Texture field requires a bounded unique earlier-operation prefix')
 const p=op.properties,model=p.procedural_texture_coordinate_model,output=p.procedural_texture_coordinate_output
 if(![DEFAULT,LINKED].includes(String(model))||p.procedural_texture_field_profile!=='darwin-arm64-compositor-texture-field-v1'
  ||!['Uniform','Normalized'].includes(String(output))||p.evaluation_device==='GPU'&&p.native_gpu_backend!=='METAL')return fail('Procedural Texture field requires its measured coordinate/native-stage profile')
 const dimensions=new Vector2();let checked=''
 const validate=(frame:any)=>{
  frame.renderer.getDrawingBufferSize(dimensions);const target=frame.renderer.getRenderTarget?.()
  if(!Number.isInteger(dimensions.x)||!Number.isInteger(dimensions.y)||dimensions.x<4||dimensions.y<4||dimensions.x>8192||dimensions.y>8192||target&&(target.width!==dimensions.x||target.height!==dimensions.y))return fail('Procedural Texture field requires matching full-frame physical drawing/target extents in [4,8192] including DPR changes')
  if(op.kind==='gradient-texture'&&p.gradient_type==='EASING'&&!easingFieldAdmission(dimensions.x,dimensions.y,String(output)))return fail('Procedural Texture Easing field needs more separation from the native one endpoint at this extent; choose Linear/Quadratic or a smaller X extent')
  const maximum=Math.max(dimensions.x,dimensions.y)
  if(op.kind==='gradient-texture'&&p.gradient_type==='DIAGONAL'&&output==='Uniform'&&(maximum&(maximum-1)))return fail('Procedural Texture Uniform Diagonal field requires a power-of-two maximum physical extent to preserve native exact zero cancellation')
  const key=dimensions.x+':'+dimensions.y
  if(checkerScale!==undefined&&key!==checked){if(!checkerFieldAdmission(dimensions.x,dimensions.y,String(output),checkerScale))return fail('Procedural Texture Checker field is too close to a native floor boundary at this extent; choose another integer Scale or render extent');checked=key}
  return dimensions
 }
 if(model===DEFAULT){
  if(output!=='Uniform'||op.inputs.Vector!==undefined)return fail('Procedural Texture implicit Vector is native Uniform image coordinates, without an authored Vector input')
  const size=uniform!(dimensions).onRenderUpdate(validate)
  return vec3!(buildFullFrameFloatCoordinateKernel('Uniform',size),0)
 }
 const value=op.inputs.Vector?.value
 if(op.inputs.Vector?.socketType!=='VECTOR'||value?.kind!=='convert'||value.fromType!=='FLOAT_VECTOR2'||value.type!=='VECTOR'
  ||value.input?.kind!=='ref'||value.input.type!=='FLOAT_VECTOR2'||index<0||operations.length>2048)return fail('Procedural Texture linked coordinates require an explicit fresh float2-to-padded-vector edge')
 const matches=prefix.filter(item=>item.id===value.input!.node)
 if(new Set([...prefix.map(item=>item.id),op.id]).size!==index+1||matches.length!==1)return fail('Procedural Texture linked field requires a unique bounded earlier coordinate producer')
 const source=matches[0]!,q=source.properties
 if(source.kind!=='image-coordinates'||source.type!=='FLOAT_VECTOR2'||source.source.nodeType!=='CompositorNodeImageCoordinates'||source.source.output!==output
  ||q.image_coordinates_model!=='render-layer-float2-v1'||q.image_coordinates_source_profile!=='darwin-arm64-53-float2-v1'
  ||JSON.stringify(q.image_coordinates_native_version)!=='[5,3,0]'||q.image_coordinates_reference_model!=='full-frame-render-layer-v1')return fail('Procedural Texture linked field requires the measured full-frame Uniform/Normalized producer')
 const guard=uniform!(0).onRenderUpdate((frame:any)=>{validate(frame);return 0});return input('Vector').add(vec3!(guard))
}
