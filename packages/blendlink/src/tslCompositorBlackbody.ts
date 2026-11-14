/* SPDX-License-Identifier: MIT */
/** Native IMB CPU MF Blackbody literal colors; GPU fields use another source path. */
import {float,max,vec3,vec4} from 'three/tsl'
import type {SourceCompositorOperation} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'
import {resolveTextureLiteral} from './tslCompositorProceduralTexture.js'
import {buildBlackbodyPolynomial} from './tslSpectralNodes.js'
import {BLACKBODY_R,BLACKBODY_G,BLACKBODY_B,BLACKBODY_TABLE_SHA256,BLACKBODY_OCIO_SHA256} from './tslBlackbodyCoefficients.js'
export const BLACKBODY_MODEL='native-imb-blackbody-literal-53-v1'
export const BLACKBODY_PROFILE='darwin-arm64-53-imb-blackbody-v1'
export const blackbodyTemperature=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&Math.fround(value)===value&&value>=800&&value<=12000
export function blackbodyTermScales(temperature:number):number[]{
 if(!blackbodyTemperature(temperature))throw Error('Blackbody needs an exact stored Float32 temperature800..12000')
 if(temperature===12000)return [0.8262954810464208,0.9945080501520986,1.566307710274283].map(value=>Math.abs(Math.fround(value)))
 const index=[965,1167,1449,1902,3315,6365].filter(boundary=>temperature>=boundary).length
 return [BLACKBODY_R,BLACKBODY_G].map(values=>Math.abs(Math.fround(values[index*3]!))/temperature+Math.abs(Math.fround(values[index*3+1]!))*temperature+Math.abs(Math.fround(values[index*3+2]!)))
  .concat([0,1,2,3].reduce((sum,power)=>sum+Math.abs(Math.fround(BLACKBODY_B[index*4+power]!))*temperature**(3-power),0))
}
export function blackbodyErrorBounds(temperature:number):number[]{return blackbodyTermScales(temperature).map(scale=>32*2**-24*scale)}
export function buildCompositorBlackbody(op:SourceCompositorOperation,operations:readonly SourceCompositorOperation[],fail:(message:string)=>never):TslEffectNode {
 const p=op.properties,t=op.inputs?.Temperature
 if(op.kind!=='blackbody-color'||op.type!=='RGBA'||op.source.nodeType!=='ShaderNodeBlackbody'||op.source.output!=='Color'
  ||p?.blackbody_model!==BLACKBODY_MODEL||p.blackbody_profile!==BLACKBODY_PROFILE||JSON.stringify(p.blackbody_version)!=='[5,3,0]'||p.blackbody_build!=='02f0899d78e3'
  ||p.blackbody_evaluator!=='CPU-MF'||p.blackbody_working_space!=='lin_rec709_scene'||p.blackbody_color_transform!=='native-rec709-bypass-53-v1'
  ||p.blackbody_ocio_sha256!==BLACKBODY_OCIO_SHA256||p.blackbody_table_sha256!==BLACKBODY_TABLE_SHA256
  ||!['CPU','GPU'].includes(String(p.evaluation_device))||p.single_value_device!=='CPU'||p.evaluation_device==='GPU'&&p.native_gpu_backend!=='METAL'
  ||Object.keys(op.inputs).length!==1||t?.socketType!=='VALUE')return fail('Blackbody needs its qualified CPU-MF literal source/schema, bundled Rec709 working space and native evaluator profile')
 const temperature=resolveTextureLiteral(t.value,operations,op,'VALUE')
 if(!blackbodyTemperature(temperature))return fail('Blackbody requires a literal/Value/group stored Float32 Temperature800..12000; fields and computed temperature have no qualified source path')
 const index=[965,1167,1449,1902,3315,6365].filter(boundary=>temperature>=boundary).length
 // Native static branch selection is exact for a stored Float32 literal. Only
 // the selected source polynomial is constructed; no7-way fragment select.
 const color=temperature===12000?vec3(0.8262954810464208,0.9945080501520986,1.566307710274283):buildBlackbodyPolynomial(float(temperature),index,BLACKBODY_R,BLACKBODY_G,BLACKBODY_B,'native-reciprocal')
 return vec4(max(color,vec3(0)),1)as unknown as TslEffectNode
}
