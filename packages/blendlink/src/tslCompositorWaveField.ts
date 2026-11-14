/* SPDX-License-Identifier: MIT */
import type {SourceCompositorProgram,SourcePresentation} from './sourceDisplay.js'
import {COMPOSITOR_WAVE_AXIS_MODEL,validateCompositorWaveAxis,waveAxisTableKeys} from './tslCompositorWaveAxis.js'
import {ellipseRowTextureCount,STATIC_MASK_POINTWISE} from './tslCompositorMaskDomains.js'
const whiteModel='native-compositor-white-noise-uniform-cpu-53-v1'
export const waveAxisFieldKind=(op:SourceCompositorProgram['ops'][number]):boolean=>op.properties?.wave_axis_model===COMPOSITOR_WAVE_AXIS_MODEL
const pointwise=new Set([...STATIC_MASK_POINTWISE,'white-noise-texture','wave-texture'])
export function validateWaveAxisGraph(program:SourceCompositorProgram,fail:(message:string)=>never):void{
 if(!Array.isArray(program.ops)||program.ops.length>2048)return fail('Wave axis requires a bounded compositor operation list')
 for(const op of program.ops){if(op.kind==='wave-texture')validateCompositorWaveAxis(op,fail);else if(op.properties&&Object.keys(op.properties).some(key=>key.startsWith('wave_')))return fail('Wave axis properties require the actual Wave source kind')}
 if(!program.ops.some(waveAxisFieldKind))return
 const ids=new Set<string>()
 for(const op of program.ops){if(typeof op.id!=='string'||op.id.length===0||ids.has(op.id))return fail('Wave axis requires unique nonempty operation identities');ids.add(op.id)}
 if(!Array.isArray(program.passes)||program.passes.length!==0)return fail('Wave axis requires no declared scene-pass inputs')
 if(program.ops.filter(waveAxisFieldKind).length>128)return fail('Wave axis exceeds its 128 source-operation budget')
 if(program.ops.some(op=>!pointwise.has(op.kind)))return fail('Wave axis requires closed full-frame texture-free pointwise composition')
 if(waveAxisTableKeys(program.ops).size+(program.ops.some(op=>op.properties?.white_noise_model===whiteModel)?1:0)+ellipseRowTextureCount(program.ops)>8)return fail('Wave combined row/axis lookup budget is eight sampled textures')
}
export function validateWaveAxisPresentation(presentation:SourcePresentation|undefined,postLdrCount:number,fail:(message:string)=>never,preHdrCount=0):void{
 const graph=presentation?.compositor;if(!graph)return;validateWaveAxisGraph(graph,fail);if(!graph.ops.some(waveAxisFieldKind))return
 const display=presentation?.display?.ops??[];if(!Array.isArray(display))return fail('Wave axis requires a bounded display operation list')
 if(waveAxisTableKeys(graph.ops).size+(graph.ops.some(op=>op.properties?.white_noise_model===whiteModel)?1:0)+ellipseRowTextureCount(graph.ops)+display.filter(op=>op.type==='Lut1DTransform'||op.type==='Lut3DTransform').length>8)return fail('Wave combined row/axis/display lookup budget is eight sampled textures')
 if(preHdrCount!==0||postLdrCount!==0)return fail('Wave axis requires no registered pre-HDR or post-LDR effects without independent accounting')
}
