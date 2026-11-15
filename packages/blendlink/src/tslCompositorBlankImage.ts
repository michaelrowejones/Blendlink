/* SPDX-License-Identifier: MIT */
/** Literal native finite images. No serialized pixel payload or single-value alias. */
import {Vector2,Vector4} from 'three'
import {vec4} from 'three/tsl'
import type {SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'
import {finiteMetadataConsumerGraph} from './tslCompositorImageInfo.js'
import {CompositorRendererEpoch} from './tslCompositorRttOwner.js'
export const BLANK_IMAGE_MODEL='native-compositor-blank-image-cpu-53-v1'
export const BLANK_IMAGE_PROFILE='darwin-arm64-53-blank-image-cpu-v1'
export const BLANK_IMAGE_MAX_PIXELS=4194304
const closed=(value:unknown,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|')
const word=(value:number)=>new Uint32Array(new Float32Array([value]).buffer)[0]!
export interface BlankImageContract {op:SourceCompositorOperation;color:readonly number[];width:number;height:number}
export function validateBlankImageProgram(program:SourceCompositorProgram,fail:(message:string)=>never):BlankImageContract|undefined{
 const candidates=program.ops.filter(op=>op.kind==='blank-image'||op.source?.nodeType==='CompositorNodeBlankImage'||Object.keys(op.properties??{}).some(key=>key.startsWith('blank_image_')))
 if(!candidates.length)return undefined
 if(candidates.length!==1||program.passes.length||program.images&&Object.keys(program.images).length||program.ops.length!==1&&!finiteMetadataConsumerGraph(program,candidates[0]!.id))return fail('Blank Image initially requires one terminal finite producer without image/render-pass/other consumers')
 const op=candidates[0]!,p=op.properties,s=op.source
 if(op.kind!=='blank-image'||op.type!=='RGBA'||!s||!closed(s,['path','node','nodeType','output'])||s.nodeType!=='CompositorNodeBlankImage'||s.output!=='Image'||typeof s.node!=='string'||!s.node||!Array.isArray(s.path)||!s.path.length||!s.path.every(path=>typeof path==='string')||typeof op.id!=='string'||!op.id)return fail('Blank Image requires its actual native Image class and source schema')
 const names=['blank_image_model','blank_image_profile','blank_image_version','blank_image_build','blank_image_color_words','blank_image_size','blank_image_effective_size','blank_image_max_pixels','blank_image_sampling_model','blank_image_source_precision']
 if(!p||Object.keys(p).some(key=>key.startsWith('blank_image_')&&!names.includes(key))||p.blank_image_model!==BLANK_IMAGE_MODEL||p.blank_image_profile!==BLANK_IMAGE_PROFILE||JSON.stringify(p.blank_image_version)!=='[5,3,0]'||p.blank_image_build!=='02f0899d78e3'||p.blank_image_sampling_model!=='modern-cpu-v1'||p.blank_image_max_pixels!==BLANK_IMAGE_MAX_PIXELS||!['AUTO','FULL'].includes(String(p.blank_image_source_precision))||p.evaluation_device!=='CPU'||p.single_value_device!=='CPU')return fail('Blank Image requires its pinned CPU finite-image source model')
 if(!closed(op.inputs,['Color','Size']))return fail('Blank Image requires only its native literal Color/Size controls')
 const colorInput=op.inputs.Color!,sizeInput=op.inputs.Size!
 for(const [input,name,type,tag]of[[colorInput,'Color','RGBA','RGBA'],[sizeInput,'Size','INT_VECTOR','INT_VECTOR2']]as const)if(!closed(input,['name','socketType','value'])||input.name!==name||input.socketType!==type||input.value.kind!=='constant'||input.value.type!==tag||!closed(input.value,['kind','type','value']))return fail('Blank Image fields, linked controls and conversions remain unqualified')
 const color=colorInput.value.value,size=sizeInput.value.value
 if(!Array.isArray(color)||color.length!==4||!color.every(value=>typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0)&&Math.fround(value)===value&&value>=0&&value<=16&&(value===0||value>=2**-16))||color[3]!>1||JSON.stringify(color.map(word))!==JSON.stringify(p.blank_image_color_words))return fail('Blank Image requires exact raw positive-zero/normal Float32 Color [2^-16,16] with alpha at most one')
 if(!Array.isArray(size)||size.length!==2||!size.every(value=>typeof value==='number'&&Number.isInteger(value)&&!Object.is(value,-0)&&value>=-2147483648&&value<=2147483647)||JSON.stringify(size)!==JSON.stringify(p.blank_image_size))return fail('Blank Image requires its exact raw native signed Int32 Size')
 const [width,height]=size.map(value=>Math.max(1,value))as[number,number]
 if(width>8192||height>8192||width*height>BLANK_IMAGE_MAX_PIXELS||JSON.stringify([width,height])!==JSON.stringify(p.blank_image_effective_size))return fail('Blank Image effective Size exceeds 1..8192 / 4194304 pixels or differs from native max(Size,1)')
 if(!(program.ops.length===1&&program.output&&closed(program.output,['kind','node','type'])&&program.output.kind==='ref'&&program.output.node===op.id&&program.output.type==='RGBA')&&!finiteMetadataConsumerGraph(program,op.id))return fail('Blank Image initially requires its direct terminal RGBA output')
 return{op,color:[...color],width,height}
}
export function buildBlankImageColor(contract:BlankImageContract):TslEffectNode{return vec4(...contract.color as[number,number,number,number])}
/** Checks precede map/allocation changes and survive zero-color optimization. */
export function createBlankImageFrameGuard():((renderer:TslEffectNode)=>void)&{dispose():void}{
 const epoch=new CompositorRendererEpoch('Blank Image'),drawing=new Vector2(),viewport=new Vector4()
 const validate=(renderer:any)=>{
  epoch.validate(renderer);renderer.getDrawingBufferSize(drawing)
  const width=drawing.x,height=drawing.y,target=renderer.getRenderTarget()
  if(!Number.isInteger(width)||!Number.isInteger(height)||Math.min(width,height)<1||Math.max(width,height)>8192||width*height>BLANK_IMAGE_MAX_PIXELS)throw Error('Blank Image output requires physical extents 1..8192 and at most 4194304 pixels')
  if((renderer.getActiveMipmapLevel?.()??0)!==0||target&&(target.texture?.isCubeTexture||target.depth!==undefined&&target.depth!==1||target.width!==width||target.height!==height||target.viewport.x!==0||target.viewport.y!==0||target.viewport.z!==width||target.viewport.w!==height||target.scissorTest))throw Error('Blank Image requires a matching zero-origin full-frame 2D mip0 target without scissor')
  if(!target){renderer.getViewport(viewport);const ratio=renderer.getPixelRatio();if(!Number.isFinite(ratio)||ratio<=0||viewport.x!==0||viewport.y!==0||Math.floor(viewport.z*ratio)!==width||Math.floor(viewport.w*ratio)!==height||renderer.getScissorTest())throw Error('Blank Image requires a full physical viewport including DPR')}
 }
 return Object.assign(validate,{dispose:()=>epoch.clear()})
}
