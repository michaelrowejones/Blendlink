/* SPDX-License-Identifier: MIT */
import {Vector2} from 'three'
import * as TSL from 'three/tsl'
import type {CompositorValue,SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'
const {floor,ivec2,textureSize,uniform,uv,vec2,vec3,vec4}=TSL as unknown as Record<'floor'|'ivec2'|'textureSize'|'uniform'|'uv'|'vec2'|'vec3'|'vec4',(...args:TslEffectNode[])=>TslEffectNode>
const MODEL='render-layer-pixel-int2-v1',PROFILE='darwin-arm64-53-pixel-int2-v1'
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
const spatial=new Set(['translate','image-affine','image-input','image-crop','alpha-crop','image-split','pixelate','blur','filter','glare'])
const pixelProducer=(op:SourceCompositorOperation):boolean=>op.kind==='image-coordinates'&&op.type==='INT_VECTOR2'
 &&op.source?.nodeType==='CompositorNodeImageCoordinates'&&op.source.output==='Pixel'&&op.properties?.image_coordinates_model===MODEL
 &&op.properties.image_coordinates_source_profile===PROFILE&&JSON.stringify(op.properties.image_coordinates_native_version)==='[5,3,0]'
 &&op.properties.image_coordinates_reference_model==='full-frame-render-layer-v1'

export function validateImageCoordinateGraph(program:SourceCompositorProgram,fail:(message:string)=>never):void{
 if(program.ops.some(op=>op.kind==='image-coordinates')&&program.output?.type!=='RGBA')
  fail('Image Coordinates fields require an explicit qualified RGBA output conversion')
 if(program.ops.some(op=>op.kind==='image-coordinates')&&program.ops.some(op=>spatial.has(op.kind)))
  fail('Image Coordinates fields currently qualify pointwise consumers only; spatial/neighborhood realization remains unqualified')
}

/** Explicit fresh INT2 edges. Existing serialized VECTOR retains float3 semantics. */
export function buildCompositorInt2Conversion(value:CompositorValue,operations:readonly SourceCompositorOperation[],
 resolve:(input:CompositorValue)=>TslEffectNode,fail:(message:string)=>never):TslEffectNode{
 if(value.kind!=='convert'||value.fromType!=='INT_VECTOR2'||!['RGBA','VECTOR'].includes(value.type)
  ||value.input?.kind!=='ref'||value.input.type!=='INT_VECTOR2'||operations.length>2048)
  return fail('Image Coordinates INT_VECTOR2 supports only verified Pixel-to-RGBA or padded float3 edges; scalar/int/float2 conversions remain unqualified')
 const matches=operations.filter(op=>op.id===value.input!.node)
 if(matches.length!==1||!pixelProducer(matches[0]!))return fail('Image Coordinates INT_VECTOR2 requires a verified fresh two-component Pixel producer')
 const input=vec2(resolve(value.input))
 return value.type==='RGBA'?vec4(input,0,1):vec3(input,0)
}

export function buildCompositorImageCoordinates(op:SourceCompositorOperation,operations:readonly SourceCompositorOperation[],
 image:TslEffectNode,fail:(message:string)=>never):TslEffectNode{
 const p=op.properties,input=op.inputs?.Image
 if(!pixelProducer(op)||!record(p)||!['CPU','GPU'].includes(String(p.evaluation_device))||p.single_value_device!=='CPU'
  ||p.evaluation_device==='GPU'&&p.native_gpu_backend!=='METAL'
  ||!record(op.inputs)||Object.keys(op.inputs).join()!=='Image'||input?.socketType!=='RGBA'
  ||input.value.kind!=='ref'||input.value.type!=='RGBA'||operations.length>2048)
  return fail('Image Coordinates Pixel requires its verified two-component schema and native source profile')
 const index=operations.indexOf(op),prefix=index<0?[]:operations.slice(0,index),matches=prefix.filter(item=>item.id===input.value.node)
 if(index<0||new Set([...prefix.map(item=>item.id),op.id]).size!==index+1||matches.length!==1)
  return fail('Image Coordinates Pixel needs a bounded unique topological Image reference')
 const source=matches[0]!
 if(source.kind!=='render-pass'||source.type!=='RGBA'||source.source.nodeType!=='CompositorNodeRLayers'
  ||source.source.output!=='Image'||source.pass?.pass!=='Image')return fail('Image Coordinates Pixel requires a direct full-frame Render Layers Image')
 const drawing=new Vector2()
 const guard=uniform(0,'int').onRenderUpdate((frame:TslEffectNode)=>{
  frame.renderer.getDrawingBufferSize(drawing)
  let root=image
  if(root.isPassNode)root=root.getTextureNode()
  const seen=new Set<TslEffectNode>()
  while(root.referenceNode&&root.referenceNode!==root){if(seen.has(root))return fail('Image Coordinates Pixel Image reference is cyclic');seen.add(root);root=root.referenceNode}
  const width=root.value?.image?.width,height=root.value?.image?.height,target=frame.renderer.getRenderTarget?.()
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192
   ||width!==drawing.x||height!==drawing.y||target&&(target.width!==width||target.height!==height))return fail(`Image Coordinates Pixel requires matching full-frame physical Image/render extents in [1,8192], including DPR changes (image=${width}x${height}, drawing=${drawing.x}x${drawing.y}, target=${target?.width}x${target?.height}, source=${root.constructor?.name})`)
  return 0
 })
 // Half-pixel raster centers stay safely inside each integer bin in the bound.
 // The guard uniform is a real render dependency; it cannot disappear as JS-only validation.
 return ivec2(floor(uv().mul(vec2(textureSize(image,0))))).add(ivec2(guard))
}
