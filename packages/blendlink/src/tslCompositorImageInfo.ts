/* SPDX-License-Identifier: MIT */
/** Identity-domain metadata: Render Layers retains live texture dimensions;
 * admitted finite buffers retain their authored, source-validated data size. */
import{Vector2}from'three'
import*as TSL from'three/tsl'
import type{CompositorValue,SourceCompositorOperation,SourceCompositorProgram}from'./sourceDisplay.js'
import type{TslEffectNode}from'./tslPostEffects.js'
const{float,int,ivec2,textureSize,uniform,vec2,vec3,vec4}=TSL as unknown as Record<string,(...args:any[])=>TslEffectNode>
const MODEL='render-layer-identity-image-info-v1',PROFILE='darwin-arm64-53-image-info-v1'
export const FINITE_IMAGE_INFO_MODEL='finite-identity-image-info-v1',FINITE_IMAGE_INFO_PROFILE='darwin-arm64-53-finite-image-info-v1'
const TYPES:Record<string,string>={Dimensions:'INT_VECTOR2',Resolution:'INT_VECTOR2',Location:'FLOAT_VECTOR2',Rotation:'VALUE',Scale:'FLOAT_VECTOR2'}
function producer(op:SourceCompositorOperation):boolean{
 const p=op.properties
 return op.kind==='image-info'&&op.source.nodeType==='CompositorNodeImageInfo'&&Object.hasOwn(TYPES,op.source.output)&&op.type===TYPES[op.source.output]
  &&((p?.image_info_model===MODEL&&p.image_info_source_profile===PROFILE&&p.image_info_reference_model==='full-frame-render-layer-identity-v1')||(p?.image_info_model===FINITE_IMAGE_INFO_MODEL&&p.image_info_source_profile===FINITE_IMAGE_INFO_PROFILE&&p.image_info_reference_model==='finite-image-identity-v1'))&&JSON.stringify(p.image_info_native_version)==='[5,3,0]'&&typeof p.image_info_scene==='string'&&p.image_info_scene.length>0
}
/** Closed finite producer -> native single metadata -> existing metadata arithmetic.
 * No image/color branch may escape through a conversion or a constant output. */
export function finiteMetadataConsumerGraph(program:SourceCompositorProgram,producerId:string):boolean{
 const ops=program.ops;if(ops.length<2||ops.length>64||program.passes.length||ops.some(op=>typeof op.id!=='string'||!op.id)||new Set(ops.map(op=>op.id)).size!==ops.length)return false
 const byId=new Map(ops.map(op=>[op.id,op])),used=new Set<string>(),visiting=new Set<string>();let infos=0
 const walk=(value:CompositorValue|undefined,depth=0,allowProducer=false):boolean=>{
  if(!value||depth>64)return false
  if(value.kind==='constant')return true
  if(value.kind==='convert')return walk(value.input,depth+1,allowProducer)
  if(value.kind!=='ref'||!value.node||!byId.has(value.node)||value.node===producerId&&!allowProducer)return false
  const id=value.node;if(visiting.has(id))return false;if(used.has(id))return true
  const op=byId.get(id)!;used.add(id);visiting.add(id);let valid=false
  if(id===producerId)valid=true
  else if(op.kind==='image-info'){
   infos++;const edge=op.inputs?.Image?.value
   valid=op.properties?.image_info_model===FINITE_IMAGE_INFO_MODEL&&edge?.kind==='ref'&&edge.node===producerId&&edge.type==='RGBA'&&walk(edge,depth+1,true)
  }else if(['value','math','separate-vector','combine-color'].includes(op.kind))valid=Object.values(op.inputs).every(input=>walk(input.value,depth+1))
  visiting.delete(id);return valid
 }
 return walk(program.output)&&used.size===ops.length&&infos>0
}
function finiteSize(op:SourceCompositorOperation,source:SourceCompositorOperation,program:SourceCompositorProgram,fail:(message:string)=>never):[number,number]{
 const input=op.inputs?.Image
 if(!input||Object.keys(input).sort().join()!=='name,socketType,value'||input.name!=='Image'||!input.value||Object.keys(input.value).sort().join()!=='kind,node,type')return fail('Finite Image Info requires the exact native Image input/reference schema')
 const keys=['evaluation_device','native_gpu_backend','single_value_device','image_info_model','image_info_source_profile','image_info_native_version','image_info_reference_model','image_info_scene','image_info_finite_size']
 if(Object.keys(op.properties).sort().join()!==keys.sort().join()||typeof op.properties.native_gpu_backend!=='string')return fail('Finite Image Info requires its closed identity-domain metadata schema')
 if(program.ops.length>64||!finiteMetadataConsumerGraph(program,source.id)||op.properties.evaluation_device!=='CPU')return fail('Finite Image Info requires its closed direct finite-producer metadata graph and CPU source')
 let size:unknown
 if(source.kind==='image-input'&&source.type==='RGBA'&&source.source.nodeType==='CompositorNodeImage'&&source.source.output==='Image'&&source.properties.image_window_model==='modern-cpu-v1'){
  const id=source.properties.image_id,record=typeof id==='string'?program.images?.[id]:undefined
  if(!record||record.model!=='native-cpu-static-image-v1')return fail('Finite Image Info requires the admitted static Image payload')
  size=[record.width,record.height]
 }else if(source.kind==='blank-image'&&source.type==='RGBA'&&source.source.nodeType==='CompositorNodeBlankImage'&&source.source.output==='Image'&&source.properties.blank_image_model==='native-compositor-blank-image-cpu-53-v1')size=source.properties.blank_image_effective_size
 else return fail('Finite Image Info requires a direct static Image or native Blank Image, never transformed/computed/single inputs')
 if(!Array.isArray(size)||size.length!==2||!size.every(n=>typeof n==='number'&&Number.isInteger(n)&&!Object.is(n,-0)&&n>=1&&n<=8192)||JSON.stringify(size)!==JSON.stringify(op.properties.image_info_finite_size))return fail('Finite Image Info data size differs from its actual finite producer')
 return[size[0] as number,size[1] as number]
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
export function buildCompositorImageInfo(op:SourceCompositorOperation,ops:readonly SourceCompositorOperation[],image:TslEffectNode,fail:(message:string)=>never,program?:SourceCompositorProgram):TslEffectNode{
 const p=op.properties,input=op.inputs?.Image,index=ops.indexOf(op),prefix=index<0?[]:ops.slice(0,index)
 if(!producer(op)||!['CPU','GPU'].includes(String(p.evaluation_device))||p.single_value_device!=='CPU'||Object.keys(op.inputs).join()!=='Image'
  ||input?.socketType!=='RGBA'||input.value?.kind!=='ref'||input.value.type!=='RGBA'||index<0||ops.length>2048
  ||new Set([...prefix.map(item=>item.id),op.id]).size!==index+1)return fail('Image Info requires its measured native schema and a bounded unique earlier Image reference')
 const matches=prefix.filter(item=>item.id===input.value.node),source=matches[0]
 if(p.image_info_model===FINITE_IMAGE_INFO_MODEL){
  if(matches.length!==1||!program||program.ops!==ops)return fail('Finite Image Info requires its complete actual program and unique earlier finite source')
  const [width,height]=finiteSize(op,source!,program,fail)
  if(op.source.output==='Dimensions'||op.source.output==='Resolution')return ivec2!(width,height)
  if(op.source.output==='Rotation')return float!(0)
  return op.source.output==='Scale'?vec2!(1):vec2!(0)
 }
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
