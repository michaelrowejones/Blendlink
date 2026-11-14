/* SPDX-License-Identifier: MIT */
/** Native regular/full-roundness Segment Width, deliberately no polar branch. */
import {float} from 'three/tsl'
import type {TslEffectNode} from './tslPostEffects.js'
import type {TslIrExpression,TslExpression} from './tslNodeRecipe.js'
import type {SourceCompositorOperation} from './sourceDisplay.js'
import {resolveTextureLiteral} from './tslCompositorProceduralTexture.js'
export const RADIAL_WIDTH_MODEL='regular-full-roundness-segment-width-v1'
export const RADIAL_WIDTH_PROFILE='darwin-arm64-53-radial-width-v1'
const dependency='width-independent-of-vector-and-normalize-v1'
const version=(value:unknown)=>Array.isArray(value)&&value.length===3&&[5,3,0].every((n,i)=>Object.hasOwn(value,i)&&value[i]===n)
export const radialWidthSides=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=2&&value<=64
export function buildRadialWidthKernel(sides:TslEffectNode):TslEffectNode{return float(Math.fround(Math.PI)).div(sides) as unknown as TslEffectNode}
export function buildTslRadialWidth(expression:TslIrExpression,build:(expression:TslIrExpression)=>TslExpression,fail:(message:string)=>never):TslExpression{
 const sides=expression.sides as TslIrExpression|undefined,roundness=expression.roundness as TslIrExpression|undefined
 if(expression.op!=='radial_segment_width'||expression.model!==RADIAL_WIDTH_MODEL||expression.sourceProfile!==RADIAL_WIDTH_PROFILE
  ||!version(expression.nativeVersion)||expression.sourceEngine!=='EEVEE'||expression.nativeGpuBackend!=='METAL'||expression.dependencyModel!==dependency
  ||sides?.op!=='const_float'||!radialWidthSides(sides.value)||roundness?.op!=='const_float'||roundness.value!==1
  ||Object.keys(expression).some(key=>!['op','model','sourceProfile','nativeVersion','sourceEngine','nativeGpuBackend','dependencyModel','sides','roundness'].includes(key)))
  return fail('Radial Tiling Segment Width requires its measured regular/full-roundness model and literal integer Sides2..64; other branches are unqualified')
 return buildRadialWidthKernel(build(sides)) as TslExpression
}
export function buildCompositorRadialWidth(op:SourceCompositorOperation,operations:readonly SourceCompositorOperation[],input:(name:string)=>TslEffectNode,fail:(message:string)=>never):TslEffectNode{
 const p=op.properties,sides=op.inputs?.Sides,roundness=op.inputs?.Roundness
 if(op.kind!=='radial-segment-width'||op.type!=='VALUE'||op.source.nodeType!=='ShaderNodeRadialTiling'||op.source.output!=='Segment Width'
  ||p?.radial_width_model!==RADIAL_WIDTH_MODEL||p.radial_width_profile!==RADIAL_WIDTH_PROFILE||!version(p.radial_width_version)||p.radial_width_dependency!==dependency
  ||!['CPU','GPU'].includes(String(p.evaluation_device))||p.single_value_device!=='CPU'||p.evaluation_device==='GPU'&&p.native_gpu_backend!=='METAL'
  ||Object.keys(op.inputs).length!==2||sides?.socketType!=='VALUE'||roundness?.socketType!=='VALUE'
  ||!radialWidthSides(resolveTextureLiteral(sides?.value,operations,op,'VALUE'))||resolveTextureLiteral(roundness?.value,operations,op,'VALUE')!==1)
  return fail('Radial Tiling Segment Width requires its measured compositor regular/full-roundness model and literal integer Sides2..64; other branches are unqualified')
 return buildRadialWidthKernel(input('Sides'))
}
