/* SPDX-License-Identifier: MIT */
import {Vector2} from 'three'
import * as TSL from 'three/tsl'
import type {CompositorValue,SourceCompositorOperation} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'
const {floor,max,textureSize,uniform,uv,vec2,vec3,vec4}=TSL as unknown as Record<'floor'|'max'|'textureSize'|'uniform'|'uv'|'vec2'|'vec3'|'vec4',(...args:TslEffectNode[])=>TslEffectNode>
const MODEL='render-layer-float2-v1',PROFILE='darwin-arm64-53-float2-v1'
const producer=(op:SourceCompositorOperation):boolean=>op.kind==='image-coordinates'&&op.type==='FLOAT_VECTOR2'
 &&op.source?.nodeType==='CompositorNodeImageCoordinates'&&['Uniform','Normalized'].includes(op.source.output)
 &&op.properties?.image_coordinates_model===MODEL&&op.properties.image_coordinates_source_profile===PROFILE
 &&JSON.stringify(op.properties.image_coordinates_native_version)==='[5,3,0]'
 &&op.properties.image_coordinates_reference_model==='full-frame-render-layer-v1'

/** Shared numerical kernel. Callers qualify full-frame provenance and physical integer dimensions in [1,8192]. */
export function buildFullFrameFloatCoordinateKernel(output:'Uniform'|'Normalized',dimensions:TslEffectNode):TslEffectNode{
 const coordinates=floor(uv().mul(dimensions)).add(.5)
 return output==='Normalized'?coordinates.div(dimensions):coordinates.sub(dimensions.div(2)).div(max(dimensions.x,dimensions.y)).mul(2)
}

export function buildCompositorFloat2Conversion(value:CompositorValue,operations:readonly SourceCompositorOperation[],
 resolve:(input:CompositorValue)=>TslEffectNode,fail:(message:string)=>never):TslEffectNode{
 if(value.kind!=='convert'||value.fromType!=='FLOAT_VECTOR2'||!['RGBA','VECTOR'].includes(value.type)
  ||value.input?.kind!=='ref'||value.input.type!=='FLOAT_VECTOR2'||operations.length>2048)
  return fail('Image Coordinates FLOAT_VECTOR2 supports only verified field-to-RGBA or padded float3 edges; scalar/int conversions remain unqualified')
 const matches=operations.filter(op=>op.id===value.input!.node)
 if(matches.length!==1||!producer(matches[0]!))return fail('Image Coordinates FLOAT_VECTOR2 requires a verified fresh two-component field producer')
 const input=vec2(resolve(value.input))
 return value.type==='RGBA'?vec4(input,0,1):vec3(input,0)
}

export function buildCompositorFloatCoordinates(op:SourceCompositorOperation,operations:readonly SourceCompositorOperation[],
 image:TslEffectNode,fail:(message:string)=>never):TslEffectNode{
 const p=op.properties,input=op.inputs?.Image
 if(!producer(op)||!['CPU','GPU'].includes(String(p.evaluation_device))||p.single_value_device!=='CPU'
  ||p.evaluation_device==='GPU'&&p.native_gpu_backend!=='METAL'
  ||Object.keys(op.inputs).join()!=='Image'||input?.socketType!=='RGBA'
  ||input.value.kind!=='ref'||input.value.type!=='RGBA'||operations.length>2048)
  return fail('Image Coordinates float2 requires its verified two-component schema and native source profile')
 const index=operations.indexOf(op),prefix=index<0?[]:operations.slice(0,index),matches=prefix.filter(item=>item.id===input.value.node)
 if(index<0||new Set([...prefix.map(item=>item.id),op.id]).size!==index+1||matches.length!==1)
  return fail('Image Coordinates float2 needs a bounded unique topological Image reference')
 const source=matches[0]!
 if(source.kind!=='render-pass'||source.type!=='RGBA'||source.source.nodeType!=='CompositorNodeRLayers'
  ||source.source.output!=='Image'||source.pass?.pass!=='Image')return fail('Image Coordinates float2 requires a direct full-frame Render Layers Image')
 if(image.isPassNode)image=image.getTextureNode()
 if(!image.isTextureNode)return fail('Image Coordinates float2 requires a texture-backed full-frame Image reference; preprocessed field references remain unqualified')
 const drawing=new Vector2()
 const guard=uniform(0,'int').onRenderUpdate((frame:TslEffectNode)=>{
  frame.renderer.getDrawingBufferSize(drawing)
  let root=image
  const seen=new Set<TslEffectNode>()
  while(root.referenceNode&&root.referenceNode!==root){if(seen.has(root))return fail('Image Coordinates float2 Image reference is cyclic');seen.add(root);root=root.referenceNode}
  const width=root.value?.image?.width,height=root.value?.image?.height,target=frame.renderer.getRenderTarget?.()
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192
   ||width!==drawing.x||height!==drawing.y||target&&(target.width!==width||target.height!==height))
   return fail('Image Coordinates float2 requires matching full-frame physical Image/render extents in [1,8192], including DPR changes')
  return 0
 })
 return buildFullFrameFloatCoordinateKernel(op.source.output as 'Uniform'|'Normalized',vec2(textureSize(image,0))).add(vec2(guard))
}
