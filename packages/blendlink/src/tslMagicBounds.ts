import type { BufferAttribute, InterleavedBufferAttribute, Mesh } from 'three'
import { TslIrError, type BuildTslOptions, type TslIrExpression } from './tslNodeRecipe.js'
import { magicControlRange } from './tslMagicNodes.js'
import { irInspectionChildren } from './tslIrInspection.js'
type Pair = [number,number]
type Ranges = [Pair,Pair,Pair]
export const MAGIC_SCALED_COORDINATE_LIMIT = 32.001
const fail=(message:string):never=>{throw new TslIrError('Magic Texture '+message)}
class NeedsOwner extends Error {}
const finite=(value:unknown):value is number=>typeof value==='number' && Number.isFinite(value)
const attributeCache=new WeakMap<object,{signature:unknown[];ranges:Pair[]}>()
function attributeRanges(attribute:BufferAttribute|InterleavedBufferAttribute,components:number):Pair[] {
  const interleaved=(attribute as InterleavedBufferAttribute).data
  const signature=[components,(attribute as BufferAttribute).version,interleaved?.version,attribute.array,attribute.count,attribute.itemSize,attribute.normalized]
  const previous=attributeCache.get(attribute)
  if(previous&&signature.every((value,index)=>value===previous.signature[index]))return previous.ranges
  if(attribute.itemSize<components||attribute.count<1)return fail('coordinates need nonempty actual primitive attributes')
  const ranges=Array.from({length:components},()=>[Infinity,-Infinity] as Pair)
  for(let index=0;index<attribute.count;index++)for(let axis=0;axis<components;axis++){
    const value=axis===0?attribute.getX(index):axis===1?attribute.getY(index):attribute.getZ(index)
    if(!finite(value))return fail('coordinates require finite actual primitive attributes')
    ranges[axis]![0]=Math.min(ranges[axis]![0],value);ranges[axis]![1]=Math.max(ranges[axis]![1],value)
  }
  attributeCache.set(attribute,{signature,ranges});return ranges
}
const pixelCache=new WeakMap<object,{pixels:unknown;ranges:Ranges}>()
function ranges(expression:TslIrExpression,mesh:Pick<Mesh,'geometry'>|undefined,options:BuildTslOptions,depth=0):Ranges {
  if(!expression||typeof expression!=='object'||depth>32)return fail('coordinates exceed their bounded proof grammar')
  const child=(key:string):Ranges=>ranges(expression[key] as TslIrExpression,mesh,options,depth+1)
  let result:Ranges
  switch(expression.op){
    case 'const_float':result=Array.from({length:3},()=>[expression.value,expression.value]) as Ranges;break
    case 'const_vec3':
      if(!Array.isArray(expression.value)||expression.value.length!==3||![0,1,2].every(i=>finite((expression.value as number[])[i])))return fail('coordinates have no actual finite range')
      result=expression.value.map(value=>[value,value]) as Ranges;break
    case 'object_coords':case 'generated':{
      if(!mesh)throw new NeedsOwner()
      const attribute=mesh.geometry.getAttribute('position')
      if(!attribute)return fail('coordinates require actual primitive positions')
      result=attributeRanges(attribute,3).map(pair=>[...pair]) as Ranges
      if(options.objectSpace?.basis==='gltf-y-up')result=[result[0],[-result[2][1],-result[2][0]],result[1]]
      else if(options.objectSpace?.basis&&options.objectSpace.basis!=='blender-z-up')return fail('coordinates need an explicit object-space basis')
      if(expression.op==='generated'){
        const space=options.generatedTexspace
        if(!space||![...space.location,...space.size].every(finite))return fail('Generated coordinates need their actual exported finite texspace')
        result=result.map((pair,axis)=>{const values=pair.map(value=>(value-space.location[axis]!)/(2*(space.size[axis]||1))+.5);return [Math.min(...values),Math.max(...values)]}) as Ranges
      }
      break
    }
    case 'uv':case 'uv_active':{
      if(!mesh)throw new NeedsOwner()
      const channel=expression.op==='uv_active'?options.activeUvChannel:typeof expression.uvMap==='string'&&expression.uvMap?options.uvChannel?.(expression.uvMap):0
      if(channel===undefined||!Number.isInteger(channel)||channel<0||channel>3)return fail('UV coordinates require their actual exported channel')
      const attribute=mesh.geometry.getAttribute(channel===0?'uv':'uv'+channel)
      if(!attribute)return fail('UV coordinates need their actual nonempty exported map')
      const bound=attributeRanges(attribute,2);result=[bound[0]!,options.uvSpace==='gltf'?[1-bound[1]![1],1-bound[1]![0]]:bound[1]!,[0,0]]
      break
    }
    case 'combine':result=['x','y','z'].map(key=>child(key)[0]) as Ranges;break
    case 'separate':{
      const index=['x','y','z'].indexOf(String(expression.channel));if(index<0)return fail('coordinates need a known vector channel')
      const pair=child('input')[index]!;result=[pair,pair,pair];break
    }
    case 'vector_math':{
      if(!['ADD','SUBTRACT','MULTIPLY'].includes(String(expression.operation)))return fail('coordinates need actual mesh/opaque nearest pixels or bounded static arithmetic')
      const a=child('a'),b=child('b');result=a.map((pair,index)=>{const values=pair.flatMap(x=>b[index]!.map(y=>expression.operation==='ADD'?x+y:expression.operation==='SUBTRACT'?x-y:x*y));return [Math.min(...values),Math.max(...values)]}) as Ranges;break
    }
    case 'vector_scale':{
      const input=child('input'),scale=child('scale');result=input.map((pair,index)=>{const values=pair.flatMap(x=>scale[index]!.map(y=>x*y));return [Math.min(...values),Math.max(...values)]}) as Ranges;break
    }
    case 'tex_image':{
      if(expression.interpolation!=='Closest'||(expression.output??'color')!=='color'||expression.sourceImageStorage!=='rgba32f'||expression.sourceImageUploadRounding!=='none')return fail('image coordinates require opaque embedded nearest pixels')
      const previous=pixelCache.get(expression)
      if(previous&&previous.pixels===expression.pixels)return previous.ranges
      const pixels=expression.pixels
      if(!Array.isArray(pixels)||pixels.length<4||pixels.length%4||pixels.length>128*128*4)return fail('image coordinates need actual finite opaque embedded nearest pixels')
      const bound:Ranges=[[Infinity,-Infinity],[Infinity,-Infinity],[Infinity,-Infinity]]
      for(let i=0;i<pixels.length;i++){
        const value=pixels[i]
        if(!finite(value)||i%4===3&&value!==1)return fail('image coordinates need actual finite opaque embedded nearest pixels')
        if(i%4<3){bound[i%4]![0]=Math.min(bound[i%4]![0],value);bound[i%4]![1]=Math.max(bound[i%4]![1],value)}
      }
      result=bound.map(([low,high])=>[Math.min(0,low),Math.max(0,high)]) as Ranges
      break
    }
    case 'clamp01':result=[[0,1],[0,1],[0,1]];break
    case 'clamp_minmax':{
      const low=child('min'),high=child('max')
      if(low.some((a,i)=>a[0]!==a[1]||high[i]![0]!==high[i]![1]))return fail('coordinate Clamp needs fixed limits')
      result=low.map((a,i)=>[Math.min(a[0],high[i]![0]),Math.max(a[0],high[i]![0])]) as Ranges;break
    }
    default:return fail('coordinates need actual mesh/opaque nearest pixels or bounded static arithmetic')
  }
  if(result.length!==3||[0,1,2].some(i=>!Array.isArray(result[i])||result[i]!.length!==2||![0,1].every(j=>finite(result[i]![j]))))return fail('coordinates have no actual finite range')
  const padded=result.map(([lo,hi])=>{const pad=Math.max(1,Math.abs(lo),Math.abs(hi))*2**-20;return [lo-pad,hi+pad]}) as Ranges
  return padded
}
export function collectMagicTextures(value:unknown,result:TslIrExpression[]):void {
  if(Array.isArray(value)){value.forEach(child=>collectMagicTextures(child,result));return}
  if(!value||typeof value!=='object')return
  if((value as TslIrExpression).op==='tex_magic_native')result.push(value as TslIrExpression)
  for(const child of irInspectionChildren(value))collectMagicTextures(child,result)
}
export function validateMagicCoordinates(expression:TslIrExpression,mesh:Mesh|undefined,options:BuildTslOptions={},refreshAttributes=false,drawGeometry?:Mesh['geometry']):void {
  if(expression.evaluationModel!=='shader')return
  validateBoundCoordinates(expression.vector as TslIrExpression,magicControlRange(expression.scale as TslIrExpression),mesh,options,refreshAttributes,drawGeometry)
}
function validateBoundCoordinates(vector:TslIrExpression,scale:Pair|undefined,mesh:Mesh|undefined,options:BuildTslOptions,refreshAttributes=false,drawGeometry?:Mesh['geometry']):void {
  const geometry=drawGeometry??mesh?.geometry
  // Before the first upload, editing an attribute's CPU array needs no GPU
  // update flag. Rescan that first draw; later uploads use Three's version.
  if(geometry&&refreshAttributes)for(const name of ['position','uv','uv1','uv2','uv3']){
    const attribute=geometry.getAttribute(name);if(attribute)attributeCache.delete(attribute)
  }
  if(mesh&&((mesh as any).isSkinnedMesh||(mesh as any).isInstancedMesh||geometry?.morphAttributes.position?.length))return fail('coordinate proof currently requires static authored primitive attributes without skin/morph/instances')
  if(!scale)return fail('coordinate proof requires its qualified finite Scale')
  const bound=ranges(vector,drawGeometry?{geometry:drawGeometry}:mesh,options)
  if(Math.max(...bound.flat().map(Math.abs))*Math.max(...scale.map(Math.abs))>MAGIC_SCALED_COORDINATE_LIMIT)return fail('scaled coordinates exceed their verified magnitude32 band; reduce Scale or bound coordinates')
}
export interface MagicCoordinateProof {
  readonly requiresAttributes:boolean
  validate(mesh:Mesh,options:BuildTslOptions,refreshAttributes?:boolean,drawGeometry?:Mesh['geometry']):void
}
/** Own only the coordinate proof, not a second material document. Image
 * payloads become private derived extrema; no pixel array is copied or kept
 * on the draw path. This object never replaces source IR in a shader builder. */
export function createMagicCoordinateProof(expression:TslIrExpression):MagicCoordinateProof {
  if(expression.evaluationModel!=='shader')return{requiresAttributes:false,validate(){}}
  const scale=magicControlRange(expression.scale as TslIrExpression)
  const copy=(source:TslIrExpression,depth=0):TslIrExpression=>{
    if(!source||typeof source!=='object'||depth>32)return fail('coordinates exceed their bounded proof grammar')
    const result:TslIrExpression={op:source.op}
    const child=(key:string):void=>{result[key]=copy(source[key] as TslIrExpression,depth+1)}
    switch(source.op){
      case 'const_float':result.value=source.value;break
      case 'const_vec3':result.value=(source.value as number[]).slice();break
      case 'object_coords':case 'generated':case 'clamp01':break
      case 'uv':case 'uv_active':result.uvMap=source.uvMap;break
      case 'combine':['x','y','z'].forEach(child);break
      case 'separate':result.channel=source.channel;child('input');break
      case 'vector_math':result.operation=source.operation;['a','b'].forEach(child);break
      case 'vector_scale':['input','scale'].forEach(child);break
      case 'clamp_minmax':['min','max'].forEach(child);break
      case 'tex_image':
        for(const key of ['output','interpolation','sourceImageStorage','sourceImageUploadRounding'])result[key]=source[key]
        pixelCache.set(result,{pixels:undefined,ranges:ranges(source,undefined,{})});break
      default:return fail('coordinates need actual mesh/opaque nearest pixels or bounded static arithmetic')
    }
    return result
  }
  const vector=copy(expression.vector as TslIrExpression)
  return{requiresAttributes:true,validate:(mesh,options,refreshAttributes,drawGeometry)=>validateBoundCoordinates(vector,scale,mesh,options,refreshAttributes,drawGeometry)}
}
export function validateMagicWithoutOwner(expression:TslIrExpression,options:BuildTslOptions):boolean {
  try{validateMagicCoordinates(expression,undefined,options);return true}
  catch(error){if(error instanceof NeedsOwner)return false;throw error}
}
