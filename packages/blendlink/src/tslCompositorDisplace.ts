import {CompositorRendererEpoch} from './tslCompositorRttOwner.js'
/* SPDX-License-Identifier: MIT */
/** Candidate Displace single-value branch. The actual resampler remains shared. */
import {Vector2,Vector4} from 'three'
import type {TslEffectNode} from './tslPostEffects.js'
import type {SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
export const DISPLACE_SINGLE_MODEL='native-displace-single-domain-cpu-53-v1'
export const DISPLACE_SINGLE_PROFILE='darwin-arm64-53-displace-single-cpu-v1'
export const DISPLACE_MAX_PIXELS=4194304
const closed=(value:object,names:string[]):boolean=>Object.keys(value).sort().join('|')===[...names].sort().join('|')
const normal=(n:unknown,max:number):n is number=>typeof n==='number'&&Number.isFinite(n)&&!Object.is(n,-0)&&Math.fround(n)===n&&(n===0||Math.abs(n)>=2**-16)&&Math.abs(n)<=max
const bits=(n:number):number=>new Uint32Array(new Float32Array([n]).buffer)[0]!
const markers=(op:SourceCompositorOperation):boolean=>op.source?.nodeType==='CompositorNodeDisplace'||Object.keys(op.properties??{}).some(key=>key.startsWith('displace_'))
export function validateDisplaceProgram(program:SourceCompositorProgram,fail:(message:string)=>never):boolean{
 const candidates=program.ops.filter(markers);if(!candidates.length)return false
 if(new Set(program.ops.map(op=>op.id)).size!==program.ops.length||program.ops.some(op=>typeof op.id!=='string'||!op.id))return fail('Displace requires unique nonempty operation IDs')
 if(candidates.length!==1||program.ops.length>2)return fail('Displace requires one terminal node and a direct Render Layers or constant RGB source')
 const op=candidates[0]!,p=op.properties,source=op.source,input=op.inputs?.Image
 if(!source||!p||typeof p!=='object'||Array.isArray(p)||op.kind!=='translate'||op.type!=='RGBA'||source.nodeType!=='CompositorNodeDisplace'||source.output!=='Image'||!Array.isArray(source.path)||!source.path.every(s=>typeof s==='string')||typeof source.node!=='string'||!closed(source,['path','node','nodeType','output']))return fail('Displace requires its actual native class and Image schema')
 const names=['displace_model','displace_profile','displace_version','displace_build','displace_words','displace_source_kind','displace_image_words','displace_export_extent','displace_requested_precision','displace_max_pixels']
 if(Object.keys(p).some(key=>key.startsWith('displace_')&&!names.includes(key))||p.displace_model!==DISPLACE_SINGLE_MODEL||p.displace_profile!==DISPLACE_SINGLE_PROFILE||JSON.stringify(p.displace_version)!=='[5,3,0]'||p.displace_build!=='02f0899d78e3'||p.evaluation_device!=='CPU'||p.single_value_device!=='CPU'||!['AUTO','FULL'].includes(String(p.displace_requested_precision))||p.displace_max_pixels!==DISPLACE_MAX_PIXELS)return fail('Displace requires its pinned CPU single-value domain model')
 const extent=p.displace_export_extent
 if(!Array.isArray(extent)||extent.length!==2||!extent.every(v=>typeof v==='number'&&Number.isInteger(v)&&v>=4&&v<=8192)||extent[0]!*extent[1]!>DISPLACE_MAX_PIXELS)return fail('Displace export exceeds its physical extent/pixel budget')
 const delta=p.image_translation
 if(p.image_domain_model!=='native-translation-v2'||p.image_sampling_model!=='modern-cpu-v1'||!['Nearest','Bilinear'].includes(String(p.image_interpolation))||!Array.isArray(delta)||delta.length!==2||!delta.every(v=>normal(v,8192))||JSON.stringify(p.displace_words)!==JSON.stringify(delta.map(bits)))return fail('Displace requires exact raw float2 translation and Nearest/Bilinear Clip sampling')
 if(!input||!closed(op.inputs,['Image'])||!closed(input,['name','socketType','value'])||input.name!=='Image'||input.socketType!=='RGBA'||!input.value||typeof input.value!=='object'||input.value.type!=='RGBA')return fail('Displace accepts only its native RGBA Image input')
 const output=program.output
 if(!output||output.kind!=='ref'||output.node!==op.id||output.type!=='RGBA'||!closed(output,['kind','node','type']))return fail('Displace is currently terminal; consumers and transform chains remain unqualified')
 const v=input.value
 let color:unknown
 if(v.kind==='constant'&&closed(v,['kind','type','value']))color=v.value
 else if(v.kind==='ref'&&closed(v,['kind','type','node'])){
  const upstream=program.ops.find(other=>other.id===v.node)
  if(!upstream||upstream===op||upstream.type!=='RGBA')return fail('Displace Image has no qualified direct source')
  if(p.displace_source_kind==='render-layer'){
   if(upstream.kind!=='render-pass'||upstream.source.nodeType!=='CompositorNodeRLayers'||upstream.source.output!=='Image'||p.displace_image_words!==null)return fail('Displace requires the direct Render Layers Image domain')
  }else if(upstream.kind==='rgb'&&upstream.source.nodeType==='CompositorNodeRGB')color=upstream.value
  else return fail('Displace transformed, finite-window and varying image producers remain unqualified')
 }else return fail('Displace Image conversions are not qualified')
 if(p.displace_source_kind==='constant-rgba'){
  if(!Array.isArray(color)||color.length!==4||!color.every(v=>normal(v,16))||color[3]!==1||JSON.stringify(p.displace_image_words)!==JSON.stringify(color.map(bits)))return fail('Displace constant Image requires raw normal/+0 RGBA and alpha one')
 }else if(p.displace_source_kind!=='render-layer'||color!==undefined)return fail('Displace source-kind declaration does not match its actual producer')
 if(program.ops.some(other=>other!==op&&other.id!==(v.kind==='ref'?v.node:undefined)))return fail('Displace has unqualified extra graph producers')
 return true
}

/** Existing RTT realization resets renderer state internally. Validate the
 * restored actual caller target/viewport as well before accepting output. */
export function guardDisplaceOutput(node:TslEffectNode,program:SourceCompositorProgram):TslEffectNode{
 const source=program.ops.find(op=>op.source.nodeType==='CompositorNodeDisplace')
 if(source?.properties.displace_source_kind!=='render-layer')return node
 const drawing=new Vector2(),viewport=new Vector4(),epoch=new CompositorRendererEpoch('Displace')
 return node.toVar().onRenderUpdate((frame:any)=>{
  const renderer=frame.renderer,backend=renderer?.backend,token=backend?.isWebGPUBackend?backend.device:backend?.isWebGLBackend?backend.gl:null
  if(!renderer?.isWebGPURenderer||!token||token.isContextLost?.())throw Error('Displace requires an actual available renderer/device/context')
  epoch.validate(renderer)
  renderer.getDrawingBufferSize(drawing);const width=drawing.x,height=drawing.y,target=renderer.getRenderTarget()
  if(!Number.isInteger(width)||!Number.isInteger(height)||Math.min(width,height)<4||Math.max(width,height)>8192||width*height>DISPLACE_MAX_PIXELS)throw Error('Displace physical extent exceeds its 4194304 pixel budget')
  if((renderer.getActiveMipmapLevel?.()??0)!==0||target&&(target.texture?.isCubeTexture||target.depth!==undefined&&target.depth!==1||target.width!==width||target.height!==height||target.viewport.x!==0||target.viewport.y!==0||target.viewport.z!==width||target.viewport.w!==height||target.scissorTest))throw Error('Displace requires a matching zero-origin full-frame 2D mip0 target without scissor')
  if(!target){renderer.getViewport(viewport);const ratio=renderer.getPixelRatio();if(!Number.isFinite(ratio)||ratio<=0||viewport.x!==0||viewport.y!==0||Math.floor(viewport.z*ratio)!==width||Math.floor(viewport.w*ratio)!==height||renderer.getScissorTest())throw Error('Displace requires a zero-origin full physical viewport including DPR')}
 })
}
