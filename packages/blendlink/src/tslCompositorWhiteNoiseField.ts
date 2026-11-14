import {waveAxisTableKeys} from './tslCompositorWaveAxis.js'
/* SPDX-License-Identifier: MIT */
import type {SourceCompositorProgram,SourcePresentation} from './sourceDisplay.js'
import {COMPOSITOR_WHITE_NOISE_FIELD_MODEL,validateCompositorWhiteNoise} from './tslCompositorWhiteNoise.js'
import {ellipseRowTextureCount,STATIC_MASK_POINTWISE} from './tslCompositorMaskDomains.js'
export const whiteNoiseFieldKind=(op:SourceCompositorProgram['ops'][number]):boolean=>op.properties?.white_noise_model===COMPOSITOR_WHITE_NOISE_FIELD_MODEL
// Same closed texture-free pointwise consumer family as static mask domains.
const pointwise=new Set([...STATIC_MASK_POINTWISE,'white-noise-texture','wave-texture'])
export function validateWhiteNoiseFieldGraph(program:SourceCompositorProgram,fail:(message:string)=>never):void{
 for(const op of program.ops){
  if(op.kind==='white-noise-texture')validateCompositorWhiteNoise(op,fail)
  else if(op.properties&&Object.keys(op.properties).some(key=>key.startsWith('white_noise_')))return fail('White Noise model properties require the actual native White Noise source kind')
 }
 if(!program.ops.some(whiteNoiseFieldKind))return
 if(program.ops.some(op=>!pointwise.has(op.kind)))return fail('White Noise fields require closed texture-free pointwise composition; image, render-pass, spatial and unknown sampler/domain producers remain unqualified')
 if(waveAxisTableKeys(program.ops).size+1+ellipseRowTextureCount(program.ops)>8)return fail('White Noise combined axis/row lookup budget is eight sampled textures')
}
export function validateWhiteNoisePresentation(presentation:SourcePresentation|undefined,postLdrCount:number,fail:(message:string)=>never,preHdrCount=0):void{
 const program=presentation?.compositor;if(!program)return
 validateWhiteNoiseFieldGraph(program,fail)
 if(!program.ops.some(whiteNoiseFieldKind))return
 const display=presentation?.display?.ops??[]
 if(!Array.isArray(display))return fail('White Noise fields require a bounded display operation list')
 if(waveAxisTableKeys(program.ops).size+1+ellipseRowTextureCount(program.ops)+display.filter(op=>op.type==='Lut1DTransform'||op.type==='Lut3DTransform').length>8)
  return fail('White Noise combined axis/row/display lookup budget is eight sampled textures')
 if(preHdrCount!==0||postLdrCount!==0)return fail('White Noise fields require no registered pre-HDR or post-LDR effects without independent sampler accounting')
}
