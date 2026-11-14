/* SPDX-License-Identifier: MIT */
/** Closed native CPU binary arithmetic over one renderer-owned HalfFloat frame. */
import type {SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'
import * as TSL from 'three/tsl'
const {Fn,bitcast,select,uint,vec4}=TSL as unknown as Record<string,(...args:any[])=>TslEffectNode>
export const ELLIPSE_SCENE_MIX_MODEL='native-cpu-binary-half-frame-v1'
export const ELLIPSE_SCENE_FRAME_MODEL='three-r184-half-msaa0-physical-load-v1'
const word=(n:number)=>{const b=new ArrayBuffer(4),v=new DataView(b);v.setFloat32(0,n,true);return v.getUint32(0,true)}
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&Math.fround(n)===n&&!Object.is(n,-0)&&(n===0||n>=2**-126&&n<=1)
const exact=(a:unknown,b:unknown):boolean=>{if(Object.is(a,b))return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();return ak.length===bk.length&&ak.every((k,i)=>k===bk[i]&&exact((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]))}
const reference=(value:unknown,op:SourceCompositorOperation,type:string)=>exact(value,{kind:'ref',type,node:op.id})
export interface EllipseSceneMixContract {render:SourceCompositorOperation;mask:SourceCompositorOperation;mix:SourceCompositorOperation;side:'A'|'B';background:number[]}
/** A sampler exemption exists only for this complete terminal three-op graph. */
export function ellipseSceneMixContract(graph:SourceCompositorProgram):EllipseSceneMixContract|null{
 const ops=graph.ops;if(ops.length!==3||new Set(ops.map(op=>op.id)).size!==3||graph.outputAlpha!==undefined||graph.images&&Object.keys(graph.images).length)return null
 const render=ops.find(op=>op.kind==='render-pass'),mask=ops.find(op=>op.kind==='ellipse-mask'),mix=ops.find(op=>op.kind==='mix');if(!render||!mask||!mix)return null
 const p=mix.properties,mp=mask.properties,rp=render.pass
 if(mix.type!=='RGBA'||mix.source.nodeType!=='ShaderNodeMix'||mix.source.output!=='Result_Color'||p.data_type!=='RGBA'||p.blend_type!=='MIX'||p.clamp_factor!==true||p.clamp_result!==false||p.evaluation_device!=='CPU'||p.color_conversion_device!=='CPU'||!reference(graph.output,mix,'RGBA'))return null
 if(mask.type!=='VALUE'||mask.source.nodeType!=='CompositorNodeEllipseMask'||mask.source.output!=='Mask'||mp.ellipse_mask_operation!=='ADD'||mp.ellipse_mask_mask!==0||Object.is(mp.ellipse_mask_mask,-0)||mp.ellipse_mask_value!==1||mp.ellipse_mask_identity!==false||Object.keys(mask.inputs).length)return null
 if(render.source.nodeType!=='CompositorNodeRLayers'||Object.keys(render.inputs).length||!rp||!['Image','Alpha'].includes(rp.pass)||rp.name!==rp.pass||rp.aov!=null||typeof rp.scene!=='string'||!rp.scene||typeof rp.viewLayer!=='string'||!rp.viewLayer||render.source.output!==rp.pass||rp.type!==(rp.pass==='Image'?'RGBA':'VALUE')||render.type!==rp.type||!exact(graph.passes,[rp]))return null
 const inputs=mix.inputs;if(!exact(Object.keys(inputs).sort(),['A_Color','B_Color','Factor_Float'])||!reference(inputs.Factor_Float?.value,mask,'VALUE'))return null
 const source={kind:'ref',type:render.type,node:render.id},converted=render.type==='VALUE'?{kind:'convert',fromType:'VALUE',type:'RGBA',input:source}:source
 const side=exact(inputs.A_Color?.value,converted)?'A':exact(inputs.B_Color?.value,converted)?'B':null;if(!side)return null
 const background=inputs[side==='A'?'B_Color':'A_Color']?.value,values=background?.value
 if(background?.kind!=='constant'||background.type!=='RGBA'||!exact(Object.keys(background).sort(),['kind','type','value'])||!Array.isArray(values)||values.length!==4||!values.every(positive))return null
 if(p.ellipse_scene_mix_model!==ELLIPSE_SCENE_MIX_MODEL||p.ellipse_scene_mix_frame_model!==ELLIPSE_SCENE_FRAME_MODEL||!exact(p.ellipse_scene_mix_owner,[rp.scene,rp.viewLayer])||p.ellipse_scene_mix_direction!==side||!exact(p.ellipse_scene_mix_background_words,values.map(word)))return null
 return{render,mask,mix,side,background:values}
}
/** Integer classification prevents GPU floating-mix rewrites at binary endpoints.
 * Half frame decoding is independently certified by the renderer-owned binding. */
const binaryChannel=Fn!(([source,background,factor,sourceIsA]:TslEffectNode[])=>{
 const bits=bitcast!(source,'uint').toVar(),magnitude=bits.bitAnd(uint!(0x7fffffff)).toVar(),nan=magnitude.greaterThan(uint!(0x7f800000)),infinity=magnitude.equal(uint!(0x7f800000))
 const selected=select!(sourceIsA,factor.equal(0),factor.equal(1)),quiet=bits.bitOr(uint!(0x00400000)),selectedWord=select!(magnitude.equal(0),uint!(0),bits)
 const finite=select!(selected,selectedWord,bitcast!(background,'uint')),withInfinity=select!(infinity.and(selected.not()),uint!(0x7fc00000),finite)
 return bitcast!(select!(nan,quiet,withInfinity),'float')
})
export function buildEllipseSceneBinaryMix(source:TslEffectNode,background:TslEffectNode,factor:TslEffectNode,side:'A'|'B'):TslEffectNode{
 return vec4!(...['r','g','b','a'].map(c=>binaryChannel(source[c],background[c],factor,side==='A')))
}
