/* SPDX-License-Identifier: MIT */
/** Identity-domain metadata. Width/height remain live texture dimensions, never exported literals. */
import{Vector2}from'three'
import*as TSL from'three/tsl'
import type{CompositorValue,SourceCompositorOperation}from'./sourceDisplay.js'
import type{TslEffectNode}from'./tslPostEffects.js'
const{float,int,ivec2,textureSize,uniform,vec2,vec3,vec4}=TSL as unknown as Record<string,(...args:any[])=>TslEffectNode>
const MODEL='render-layer-identity-image-info-v1',PROFILE='darwin-arm64-53-image-info-v1'
const TYPES:Record<string,string>={Dimensions:'INT_VECTOR2',Resolution:'INT_VECTOR2',Location:'FLOAT_VECTOR2',Rotation:'VALUE',Scale:'FLOAT_VECTOR2'}
function producer(op:SourceCompositorOperation):boolean{
 const p=op.properties
 return op.kind==='image-info'&&op.source.nodeType==='CompositorNodeImageInfo'&&Object.hasOwn(TYPES,op.source.output)&&op.type===TYPES[op.source.output]
  &&p?.image_info_model===MODEL&&p.image_info_source_profile===PROFILE&&JSON.stringify(p.image_info_native_version)==='[5,3,0]'
  &&p.image_info_reference_model==='full-frame-render-layer-identity-v1'&&typeof p.image_info_scene==='string'&&p.image_info_scene.length>0
}
export function imageInfoConversionSource(value:CompositorValue,ops:readonly SourceCompositorOperation[]):boolean{
 return value.kind==='convert'&&['INT_VECTOR2','FLOAT_VECTOR2'].includes(String(value.fromType))&&value.input?.kind==='ref'
  &&ops.some(op=>op.id===value.input!.node&&op.kind==='image-info')
}
export function buildImageInfoConversion(value:CompositorValue,ops:readonly SourceCompositorOperation[],resolve:(value:CompositorValue)=>TslEffectNode,fail:(message:string)=>never):TslEffectNode{
 if(value.kind!=='convert'||!['INT_VECTOR2','FLOAT_VECTOR2'].includes(String(value.fromType))||!['RGBA','VECTOR'].includes(value.type)
  ||value.input?.kind!=='ref'||value.input.type!==value.fromType||ops.length>2048)return fail('Image Info supports only qualified metadata-to-RGBA or padded float3 edges; scalar/integer/Boolean casts remain unqualified')
 const matches=ops.filter(op=>op.id===value.input!.node)
 if(matches.length!==1||!producer(matches[0]!)||matches[0]!.type!==value.fromType)return fail('Image Info conversion requires its unique qualified metadata producer')
 const xy=vec2!(resolve(value.input))
 return value.type==='RGBA'?vec4!(xy,0,1):vec3!(xy,0)
}
export function buildCompositorImageInfo(op:SourceCompositorOperation,ops:readonly SourceCompositorOperation[],image:TslEffectNode,fail:(message:string)=>never):TslEffectNode{
 const p=op.properties,input=op.inputs?.Image,index=ops.indexOf(op),prefix=index<0?[]:ops.slice(0,index)
 if(!producer(op)||!['CPU','GPU'].includes(String(p.evaluation_device))||p.single_value_device!=='CPU'||Object.keys(op.inputs).join()!=='Image'
  ||input?.socketType!=='RGBA'||input.value.kind!=='ref'||input.value.type!=='RGBA'||index<0||ops.length>2048
  ||new Set([...prefix.map(item=>item.id),op.id]).size!==index+1)return fail('Image Info requires its measured native schema and a bounded unique earlier Image reference')
 const matches=prefix.filter(item=>item.id===input.value.node),source=matches[0]
 if(matches.length!==1||source?.kind!=='render-pass'||source.type!=='RGBA'||source.source.nodeType!=='CompositorNodeRLayers'||source.source.output!=='Image'
  ||source.pass?.pass!=='Image'||source.pass.scene!==p.image_info_scene)return fail('Image Info requires a direct current-scene full-frame Render Layers Image with identity domain')
 if(image?.isPassNode)image=image.getTextureNode()
 if(!image?.isTextureNode)return fail('Image Info requires a texture-backed resolved Render Layers Image')
 const drawing=new Vector2(),guard=uniform!(0,'int').onRenderUpdate((frame:any)=>{
  frame.renderer.getDrawingBufferSize(drawing);let root=image;const seen=new Set<TslEffectNode>()
  while(root.referenceNode&&root.referenceNode!==root){if(seen.has(root))return fail('Image Info Image reference is cyclic');seen.add(root);root=root.referenceNode}
  const width=root.value?.image?.width,height=root.value?.image?.height,target=frame.renderer.getRenderTarget?.()
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192||width!==drawing.x||height!==drawing.y||target&&(target.width!==width||target.height!==height))
   return fail('Image Info requires matching full-frame physical Image/drawing/target extents in [1,8192], including resize/DPR changes')
  return 0
 })
 // textureSize retains the actual PassNode dependency, including constant transform facts.
 const dimensions=ivec2!(textureSize!(image,0)).add(ivec2!(guard)),zero=dimensions.mul(ivec2!(guard))
 if(op.source.output==='Dimensions'||op.source.output==='Resolution')return dimensions
 if(op.source.output==='Rotation')return float!(zero.x)
 if(op.source.output==='Scale')return vec2!(zero).add(vec2!(1))
 return vec2!(zero)
}
