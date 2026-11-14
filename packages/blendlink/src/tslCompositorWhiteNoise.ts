/* SPDX-License-Identifier: MIT */
/** CPU-MF source White Noise; the shader's implicit-coordinate policy differs. */
import {float,vec3,vec4} from 'three/tsl'
import {isCompositorExactAxes,type CompositorExactAxes} from './tslCompositorExactAxes.js'
import {compositorCpuFieldWhiteNoise} from './tslCompositorWhiteNoiseRne.js'
import {compositorWhiteNoiseHash} from './tslNodeRecipe.js'
import type {SourceCompositorOperation} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'

export const COMPOSITOR_WHITE_NOISE_MODEL='native-compositor-white-noise-fixed-cpu-53-v1'
export const COMPOSITOR_WHITE_NOISE_FIELD_PROFILE='darwin-arm64-53-white-noise-uniform-cpu-v1'
export const COMPOSITOR_WHITE_NOISE_FIELD_MODEL='native-compositor-white-noise-uniform-cpu-53-v1'
export const COMPOSITOR_WHITE_NOISE_AXES='exact-uniform-r32f-axes-v1'
export const COMPOSITOR_WHITE_NOISE_PROFILE='darwin-arm64-53-white-noise-cpu-v1'
export const whiteNoiseWord=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
  &&!Object.is(value,-0)&&Math.fround(value)===value&&(value===0||Math.abs(value)>=2**-126)

export function validateCompositorWhiteNoise(op:SourceCompositorOperation,fail:(message:string)=>never):void {
  if(!op||!op.source||!Array.isArray(op.source.path)||!op.source.path.every(item=>typeof item==='string')
    ||typeof op.source.node!=='string'||!op.properties||Array.isArray(op.properties)||typeof op.properties!=='object'
    ||!op.inputs||Array.isArray(op.inputs)||typeof op.inputs!=='object')
    return fail('White Noise requires a complete native source/properties/input schema')
  const p=op.properties,dimensions=p?.noise_dimensions,color=op.source.output==='Color',field=p.white_noise_model===COMPOSITOR_WHITE_NOISE_FIELD_MODEL
  const names=field?(dimensions===4?['W']:[]):dimensions===1?['W']:dimensions===4?['Vector','W']:['Vector']
  if(op.kind!=='white-noise-texture'||op.source.nodeType!=='ShaderNodeTexWhiteNoise'
    ||!['Value','Color'].includes(op.source.output)||op.type!==(color?'RGBA':'VALUE')
    ||![COMPOSITOR_WHITE_NOISE_MODEL,COMPOSITOR_WHITE_NOISE_FIELD_MODEL].includes(String(p?.white_noise_model))||p.white_noise_profile!==(field?COMPOSITOR_WHITE_NOISE_FIELD_PROFILE:COMPOSITOR_WHITE_NOISE_PROFILE)
    ||JSON.stringify(p.white_noise_version)!=='[5,3,0]'||p.white_noise_build!=='02f0899d78e3'
    ||p.white_noise_evaluator!=='CPU-MF'||p.evaluation_device!=='CPU'||p.single_value_device!=='CPU'
    ||![1,2,3,4].includes(Number(dimensions))||typeof dimensions!=='number'
    ||Object.keys(op.inputs).length!==names.length||!names.every(name=>Object.hasOwn(op.inputs,name)))
    return fail('White Noise requires its pinned Blender 5.3 CPU compositor model and native dimension/output schema')
  if(field){
    const extent=p.white_noise_export_extent
    if(![2,3,4].includes(Number(dimensions))||p.white_noise_coordinate_model!==COMPOSITOR_WHITE_NOISE_AXES
      ||p.white_noise_reference_model!=='full-frame-context-zero-offset-v1'||p.white_noise_precision!=='CPU_FLOAT32'
      ||!['AUTO','FULL'].includes(String(p.white_noise_requested_precision))||p.white_noise_normalization!=='u32-rne-integer-mantissa-v1'
      ||!Array.isArray(extent)||extent.length!==2||!extent.every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=4&&n<=8192))
      return fail('White Noise field requires its exact Uniform-axis, CPU Float32, full-frame extent and integer RNE source schema')
  }else if(['white_noise_coordinate_model','white_noise_reference_model','white_noise_export_extent','white_noise_precision','white_noise_requested_precision','white_noise_normalization'].some(key=>Object.hasOwn(p,key)))
    return fail('White Noise fixed source cannot carry stale field-model properties')
  for(const name of names){
    const input=op.inputs[name],kind=name==='Vector'?'VECTOR':'VALUE',value=input?.value
    if(input?.socketType!==kind||value?.kind!=='constant'||value.type!==kind
      ||(kind==='VALUE'?!whiteNoiseWord(value.value):!Array.isArray(value.value)||value.value.length!==3||!value.value.every(whiteNoiseWord)))
      return fail('White Noise requires explicit raw normal Float32 or positive-zero fixed seeds; implicit coordinates, casts, fields, negative zero and subnormals are unqualified')
  }
}

export function buildCompositorWhiteNoise(op:SourceCompositorOperation,fail:(message:string)=>never,fieldAxes?:CompositorExactAxes):TslEffectNode {
  validateCompositorWhiteNoise(op,fail)
  const dimensions=op.properties.noise_dimensions as number,color=op.source.output==='Color',field=op.properties.white_noise_model===COMPOSITOR_WHITE_NOISE_FIELD_MODEL
  if(field&&!isCompositorExactAxes(fieldAxes))return fail('White Noise field requires one owned shared Uniform-axis binding')
  const vector=field?fieldAxes!.node: dimensions===1?vec3(0):vec3(...op.inputs.Vector!.value.value as number[])
  const w=dimensions===1||dimensions===4?float(op.inputs.W!.value.value as number):float(0)
  const result=(field?compositorCpuFieldWhiteNoise:compositorWhiteNoiseHash)(dimensions,vector as unknown as TslEffectNode,w as unknown as TslEffectNode,color)
  return color?vec4(result as unknown as TslEffectNode,1):result
}
