/* SPDX-License-Identifier: MIT */
import type {SourceCompositorProgram,SourcePresentation} from './sourceDisplay.js'
import {ellipseSceneMixContract,sceneMaskMixContract,validateSceneMaskMixMarkers} from './tslCompositorEllipseSceneMix.js'
const families={CompositorNodeBoxMask:{kind:'box-mask',label:'Box Mask',limit:2048},CompositorNodeEllipseMask:{kind:'ellipse-mask',label:'Ellipse Mask',limit:2048}} as const
const spatial=new Set(['translate','image-affine','image-input','image-crop','alpha-crop','image-split','pixelate','blur','filter','glare','flip'])
const pointwise=new Set(['ellipse-mask','box-mask','value','rgb','utility-constant','math','vector-math','vector-component','combine-vector','separate-vector','combine-color','separate-color','mix','mix-rgb','alpha-over','set-alpha','convert-alpha','exposure','brightness-contrast','invert','gamma','hue-saturation-value','rgb-to-bw','clamp','map-range','map-value','posterize','switch','luminance-key','difference-key','distance-key','chroma-key','channel-key','color-spill','color-key','color-correction','color-balance','normal-direction'])
const displayLookups=new Set(['Lut1DTransform','Lut3DTransform'])
export function ellipseRowTextureCount(ops:SourceCompositorProgram['ops']):number{
 let count=0
 for(const op of ops){if(op.kind!=='ellipse-mask')continue;const p=op.properties,size=p?.ellipse_mask_size
  if(Array.isArray(size)&&size.length===2&&size.every(n=>typeof n==='number'&&Number.isFinite(n))&&size.some(n=>n===0))continue
  const m=p?.ellipse_mask_mask,v=p?.ellipse_mask_value,o=p?.ellipse_mask_operation
  if(typeof m!=='number'||typeof v!=='number'||!Number.isFinite(m)||!Number.isFinite(v)){count++;continue}
  const inside=o==='ADD'?Math.max(m,v):o==='SUBTRACT'?Math.min(1,Math.max(0,Math.fround(m-v))):o==='MULTIPLY'?Math.fround(m*v):o==='NOT'?(m>0?0:v):undefined,outside=o==='MULTIPLY'?0:m
  if(inside===undefined||inside!==outside)count++
 }
 return count
}
/** Class/kind and sampler contracts are closed before building any row resources. */
export function validateStaticMaskDomains(program:SourceCompositorProgram,nativeClass:keyof typeof families,fail:(message:string)=>never):void{
 if(!Object.hasOwn(families,nativeClass))return fail('Unknown static mask source class')
 const family=families[nativeClass]
 for(const op of program.ops){const expected=Object.entries(families).find(([,entry])=>entry.kind===op.kind)?.[0];if(expected&&op.source.nodeType!==expected)return fail('Static mask kind does not match its native source class')}
 const masks=program.ops.filter(op=>op.kind===family.kind)
 if(masks.length>family.limit)return fail(family.label+' exceeds its static mask node budget')
 if(masks.length&&family.kind==='ellipse-mask'){
  if(ellipseRowTextureCount(program.ops)>1)return fail('Ellipse Mask varying row texture budget permits at most one table')
  if(program.ops.some(op=>!pointwise.has(op.kind))&&!ellipseSceneMixContract(program))return fail('Ellipse Mask requires closed texture-free pointwise composition; other sampler/domain producers remain unqualified')
 }else if(masks.length&&program.ops.some(op=>spatial.has(op.kind)))return fail(family.label+' requires full-frame pointwise consumers; spatial/domain transformations remain unqualified')
}
/** Reserve presentation slots independently of sampler minimums and third-party effects. */
export function validateEllipsePresentation(presentation:SourcePresentation|undefined,postLdrCount:number,fail:(message:string)=>never,preHdrCount=0):void{
 const graph=presentation?.compositor;if(!graph)return
 validateSceneMaskMixMarkers(graph,fail)
 const sceneMix=sceneMaskMixContract(graph),hasEllipse=graph.ops.some(op=>op.kind==='ellipse-mask')
 if(!hasEllipse&&!sceneMix)return
 if(hasEllipse)validateStaticMaskDomains(graph,'CompositorNodeEllipseMask',fail)
 if(sceneMix?.family==='box')validateStaticMaskDomains(graph,'CompositorNodeBoxMask',fail)
 const ops=presentation?.display?.ops??[]
 if(!Array.isArray(ops))return fail('Static mask requires a bounded display operation list')
 if(ellipseRowTextureCount(graph.ops)+ops.filter(op=>displayLookups.has(op.type)).length+(sceneMix?1:0)>8)return fail('Static mask combined row/frame/display lookup budget is eight sampled textures')
 if(sceneMix&&preHdrCount!==0)return fail('Static mask scene composition requires no registered pre-HDR or post-LDR effects')
 if(postLdrCount!==0)return fail('Static mask custom post-LDR registrations require independent sampler accounting')
}
