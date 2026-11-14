/* SPDX-License-Identifier: MIT */
/** CPU-MF source White Noise; the shader's implicit-coordinate policy differs. */
import {float,vec3,vec4} from 'three/tsl'
import {compositorWhiteNoiseHash} from './tslNodeRecipe.js'
import type {SourceCompositorOperation} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'

export const COMPOSITOR_WHITE_NOISE_MODEL='native-compositor-white-noise-fixed-cpu-53-v1'
export const COMPOSITOR_WHITE_NOISE_PROFILE='darwin-arm64-53-white-noise-cpu-v1'
export const whiteNoiseWord=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
  &&!Object.is(value,-0)&&Math.fround(value)===value&&(value===0||Math.abs(value)>=2**-126)

export function validateCompositorWhiteNoise(op:SourceCompositorOperation,fail:(message:string)=>never):void {
  if(!op||!op.source||!Array.isArray(op.source.path)||!op.source.path.every(item=>typeof item==='string')
    ||typeof op.source.node!=='string'||!op.properties||Array.isArray(op.properties)||typeof op.properties!=='object'
    ||!op.inputs||Array.isArray(op.inputs)||typeof op.inputs!=='object')
    return fail('White Noise requires a complete native source/properties/input schema')
  const p=op.properties,dimensions=p?.noise_dimensions,color=op.source.output==='Color'
  const names=dimensions===1?['W']:dimensions===4?['Vector','W']:['Vector']
  if(op.kind!=='white-noise-texture'||op.source.nodeType!=='ShaderNodeTexWhiteNoise'
    ||!['Value','Color'].includes(op.source.output)||op.type!==(color?'RGBA':'VALUE')
    ||p?.white_noise_model!==COMPOSITOR_WHITE_NOISE_MODEL||p.white_noise_profile!==COMPOSITOR_WHITE_NOISE_PROFILE
    ||JSON.stringify(p.white_noise_version)!=='[5,3,0]'||p.white_noise_build!=='02f0899d78e3'
    ||p.white_noise_evaluator!=='CPU-MF'||p.evaluation_device!=='CPU'||p.single_value_device!=='CPU'
    ||![1,2,3,4].includes(Number(dimensions))||typeof dimensions!=='number'
    ||Object.keys(op.inputs).length!==names.length||!names.every(name=>Object.hasOwn(op.inputs,name)))
    return fail('White Noise requires its pinned Blender 5.3 CPU compositor fixed-input model and native dimension/output schema')
  for(const name of names){
    const input=op.inputs[name],kind=name==='Vector'?'VECTOR':'VALUE',value=input?.value
    if(input?.socketType!==kind||value?.kind!=='constant'||value.type!==kind
      ||(kind==='VALUE'?!whiteNoiseWord(value.value):!Array.isArray(value.value)||value.value.length!==3||!value.value.every(whiteNoiseWord)))
      return fail('White Noise requires explicit raw normal Float32 or positive-zero fixed seeds; implicit coordinates, casts, fields, negative zero and subnormals are unqualified')
  }
}

export function buildCompositorWhiteNoise(op:SourceCompositorOperation,fail:(message:string)=>never):TslEffectNode {
  validateCompositorWhiteNoise(op,fail)
  const dimensions=op.properties.noise_dimensions as number,color=op.source.output==='Color'
  const vector=dimensions===1?vec3(0):vec3(...op.inputs.Vector!.value.value as number[])
  const w=dimensions===1||dimensions===4?float(op.inputs.W!.value.value as number):float(0)
  const result=compositorWhiteNoiseHash(dimensions,vector as unknown as TslEffectNode,w as unknown as TslEffectNode,color)
  return color?vec4(result as unknown as TslEffectNode,1):result
}
