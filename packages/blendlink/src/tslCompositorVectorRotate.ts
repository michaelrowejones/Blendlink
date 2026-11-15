/* SPDX-License-Identifier: MIT */
/** Private CPU fixed-axis consumer; existing shader/Normalized kernels stay unchanged. */
import {Vector2} from 'three'
import * as TSL from 'three/tsl'
import type {CompositorValue,SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'
import {OwnedCompositorRowTable} from './tslCompositorRowTable.js'
import {CompositorRendererEpoch} from './tslCompositorRttOwner.js'
import {updateCompositorPassProducers} from './tslCompositorProducers.js'
const {Fn,bitcast,float,uniform,vec2,vec3}=TSL as unknown as Record<'Fn'|'bitcast'|'float'|'uniform'|'vec2'|'vec3',(...args:any[])=>TslEffectNode>
export const VECTOR_ROTATE_CPU_MODEL='native-fixed-axis-vector-rotate-cpu-53-v1'
export const VECTOR_ROTATE_CPU_PROFILE='darwin-arm64-53-fixed-axis-vector-rotate-cpu-v1'
export const VECTOR_ROTATE_COORDINATES='private-normalized-r32f-vector-rotate-v1'
const fail=(reason:string):never=>{throw Error('Vector Rotate: '+reason)}
const keys=(value:unknown,names:string[]):boolean=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...names].sort().join('|')
const array=(value:unknown,width:number,valid:(item:unknown)=>boolean):value is number[]=>Array.isArray(value)&&value.length===width&&[...value].every(valid)
const word=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=0xffffffff
const fromWord=(bits:number):number=>new Float32Array(new Uint32Array([bits]).buffer)[0]!
const bits=(value:number):number=>new Uint32Array(new Float32Array([value]).buffer)[0]!
const literalWord=(value:unknown,max=0x41800000):value is number=>word(value)&&value!==0x80000000&&((value&0x7fffffff)===0||(value&0x7fffffff)>=0x37800000&&(value&0x7fffffff)<=max)
const coefficientWord=(value:unknown):value is number=>word(value)&&value!==0x80000000&&((value&0x7fffffff)===0||(value&0x7fffffff)>=0x20000000&&(value&0x7fffffff)<=0x40000000)
const actualSource=(op:SourceCompositorOperation):boolean=>keys(op.source,['path','node','nodeType','output'])&&typeof op.source.node==='string'&&!!op.source.node&&Array.isArray(op.source.path)&&op.source.path.length>0&&op.source.path.length<=17&&op.source.path.every(part=>typeof part==='string'&&!!part)
interface Contract{op:SourceCompositorOperation;coordinates?:SourceCompositorOperation;pass?:SourceCompositorOperation;center:number[];columns:number[][]}
const contracts=new WeakSet<object>()

/** The private plan is created only after closed typed/source/shape validation. */
export function validateVectorRotateProgram(program:SourceCompositorProgram):Contract|null{
 const candidates=program.ops.filter(op=>op.kind==='vector-rotate-cpu'||op.source?.nodeType==='ShaderNodeVectorRotate'||Object.keys(op.properties??{}).some(key=>key.startsWith('vector_rotate_')))
 if(!candidates.length)return null
 if(candidates.length!==1||program.ops.length>8||new Set(program.ops.map(op=>op.id)).size!==program.ops.length||program.ops.some(op=>typeof op.id!=='string'||!op.id||!actualSource(op)))return fail('requires one bounded native producer and unique typed operation IDs')
 const op=candidates[0]!,p=op.properties,v=op.inputs?.Vector?.value
 const names=['vector_rotate_model','vector_rotate_profile','vector_rotate_version','vector_rotate_build','vector_rotate_mode','vector_rotate_invert','vector_rotate_center_words','vector_rotate_angle_word','vector_rotate_columns','vector_rotate_input','vector_rotate_vector_words','vector_rotate_coordinates','vector_rotate_export_extent','vector_rotate_precision','vector_rotate_scene']
 if(op.kind!=='vector-rotate-cpu'||op.type!=='VECTOR'||op.source.nodeType!=='ShaderNodeVectorRotate'||op.source.output!=='Vector'||!p||Object.keys(p).some(key=>key.startsWith('vector_rotate_')&&!names.includes(key))||p.vector_rotate_model!==VECTOR_ROTATE_CPU_MODEL||p.vector_rotate_profile!==VECTOR_ROTATE_CPU_PROFILE||JSON.stringify(p.vector_rotate_version)!=='[5,3,0]'||p.vector_rotate_build!=='02f0899d78e3'||p.evaluation_device!=='CPU'||p.single_value_device!=='CPU'||!['AUTO','FULL'].includes(String(p.vector_rotate_precision))||!['X_AXIS','Y_AXIS','Z_AXIS'].includes(String(p.vector_rotate_mode))||typeof p.vector_rotate_invert!=='boolean'||typeof p.vector_rotate_scene!=='string'||!p.vector_rotate_scene)return fail('requires its pinned CPU fixed X/Y/Z model, schema and static controls')
 if(!array(p.vector_rotate_export_extent,2,n=>typeof n==='number'&&Number.isInteger(n)&&n>=4&&n<=8192)||!array(p.vector_rotate_center_words,3,n=>literalWord(n))||!literalWord(p.vector_rotate_angle_word,0x3f800000)||!Array.isArray(p.vector_rotate_columns)||p.vector_rotate_columns.length!==3||![...p.vector_rotate_columns].every(column=>array(column,3,coefficientWord)))return fail('requires reviewed raw center/angle/coefficient/extent bounds')
 if(!keys(op.inputs,['Vector'])||!keys(op.inputs.Vector,['name','socketType','value'])||op.inputs.Vector.name!=='Vector'||op.inputs.Vector.socketType!=='VECTOR'||!v)return fail('requires one typed native VECTOR3 input')
 const columns=(p.vector_rotate_columns as number[][]).map(column=>column.map(fromWord)),center=(p.vector_rotate_center_words as number[]).map(fromWord)
 // Fixed-axis captures cannot describe arbitrary matrices. The remaining pair
 // is native sin/cos; the full source capture is independently pinned in proof.
 const axis=({X_AXIS:0,Y_AXIS:1,Z_AXIS:2}as Record<string,number>)[String(p.vector_rotate_mode)]!,others=[0,1,2].filter(i=>i!==axis)
 const a=others[0]!,b=others[1]!,cosine=columns[a]![a]!,sine=columns[a]![b]!
 if(columns[axis]![axis]!==1||others.some(i=>columns[axis]![i]!==0||columns[i]![axis]!==0)||cosine!==columns[b]![b]||sine!==-columns[b]![a]!||cosine<.5||cosine>1)return fail('coefficient capture is not a bounded fixed-axis native matrix')
 if((p.vector_rotate_angle_word as number)&0x7fffffff){
  const sign=((p.vector_rotate_angle_word as number)&0x80000000?-1:1)*(p.vector_rotate_invert?-1:1)*(p.vector_rotate_mode==='Y_AXIS'?-1:1)
  if(Math.abs(sine)<2**-17||Math.abs(sine)>1||(sine>0)!==(sign>0))return fail('nonzero native sine must retain its normal bound and fixed-axis sign')
 }else if(cosine!==1||sine!==0)return fail('zero-angle native coefficients must be exact identity')
 let coordinates:SourceCompositorOperation|undefined,pass:SourceCompositorOperation|undefined
 if(p.vector_rotate_input==='literal'){
  if(!keys(v,['kind','type','value'])||v.kind!=='constant'||v.type!=='VECTOR'||!array(v.value,3,n=>typeof n==='number'&&Number.isFinite(n)&&Math.fround(n)===n&&literalWord(bits(n)))||JSON.stringify(p.vector_rotate_vector_words)!==JSON.stringify((v.value as number[]).map(bits))||p.vector_rotate_coordinates!==null)return fail('literal Vector must retain its bounded raw Float32 words')
 }else if(p.vector_rotate_input==='normalized'){
  if(p.vector_rotate_vector_words!==null||p.vector_rotate_coordinates!==VECTOR_ROTATE_COORDINATES||!keys(v,['kind','type','fromType','input'])||v.kind!=='convert'||v.type!=='VECTOR'||v.fromType!=='FLOAT_VECTOR2'||!keys(v.input,['kind','node','type'])||v.input?.kind!=='ref'||v.input.type!=='FLOAT_VECTOR2')return fail('varying Vector requires the private exact Normalized-to-padded-VECTOR consumer')
  coordinates=program.ops.find(other=>other.id===v.input!.node)
  const input=coordinates?.inputs?.Image?.value,cp=coordinates?.properties
  if(!coordinates||coordinates.kind!=='image-coordinates'||coordinates.type!=='FLOAT_VECTOR2'||coordinates.source.nodeType!=='CompositorNodeImageCoordinates'||coordinates.source.output!=='Normalized'||cp?.evaluation_device!=='CPU'||cp.single_value_device!=='CPU'||cp.image_coordinates_model!=='render-layer-float2-v1'||cp.image_coordinates_source_profile!=='darwin-arm64-53-float2-v1'||JSON.stringify(cp.image_coordinates_native_version)!=='[5,3,0]'||cp.image_coordinates_reference_model!=='full-frame-render-layer-v1'||!keys(coordinates.inputs,['Image'])||coordinates.inputs.Image?.socketType!=='RGBA'||!keys(input,['kind','node','type'])||input?.kind!=='ref'||input.type!=='RGBA')return fail('requires the direct qualified CPU Normalized coordinate producer')
  pass=program.ops.find(other=>other.id===input.node)
  if(!pass||pass.kind!=='render-pass'||pass.type!=='RGBA'||pass.source.nodeType!=='CompositorNodeRLayers'||pass.source.output!=='Image'||pass.pass?.pass!=='Image'||pass.pass.scene!==p.vector_rotate_scene||!keys(pass.inputs,[]))return fail('Normalized coordinates require a direct full-frame Render Layers Image')
 }else return fail('unknown Vector producer model')
 const used=new Set<string>(),prefix=new Set<string>()
 let visits=0
 const references=(value:CompositorValue,active=new Set<CompositorValue>()):void=>{
  if(++visits>256||!value||typeof value!=='object'||active.has(value))return fail('typed references exceed bounded acyclic input budget')
  active.add(value)
  if(value.kind==='ref'&&!prefix.has(value.node??''))return fail('requires preceding typed source references')
  if(value.kind==='convert'){if(!value.input)return fail('conversion input is missing');references(value.input,active)}
  active.delete(value)
 }
 for(const item of program.ops){for(const input of Object.values(item.inputs??{}))references(input.value);prefix.add(item.id)}
 const signal=(value:CompositorValue,target:string,depth=0):boolean=>{
  if(++visits>512||depth>16||!value||value.type!==target)return false
  if(value.kind==='convert')return keys(value,['kind','type','fromType','input'])&&target==='RGBA'&&['VECTOR','VALUE'].includes(value.fromType??'')&&!!value.input&&signal(value.input,value.fromType!,depth+1)
  if(value.kind==='constant')return keys(value,['kind','type','value'])&&target==='VALUE'&&[0,1].includes(value.value as number)&&typeof value.value==='number'&&!Object.is(value.value,-0)
  if(value.kind!=='ref'||!keys(value,['kind','node','type']))return false
  const item=program.ops.find(other=>other.id===value.node);if(!item)return false
  used.add(item.id)
  if(item===op)return target==='VECTOR'
  if(item.kind==='separate-vector'){
   const incoming=item.inputs.Vector,value=incoming?.value
   return target==='VALUE'&&item.type==='VALUE'&&item.source.nodeType==='ShaderNodeSeparateXYZ'&&['X','Y','Z'].includes(item.source.output)&&keys(item.inputs,['Vector'])&&keys(incoming,['name','socketType','value'])&&incoming.socketType==='VECTOR'&&keys(value,['kind','node','type'])&&value?.kind==='ref'&&value.node===op.id&&value.type==='VECTOR'
  }
  if(item.kind==='combine-color')return target==='RGBA'&&item.type==='RGBA'&&item.source.nodeType==='CompositorNodeCombineColor'&&item.source.output==='Image'&&item.properties.mode==='RGB'&&keys(item.inputs,['Red','Green','Blue','Alpha'])&&item.inputs.Alpha?.value.kind==='constant'&&item.inputs.Alpha.value.value===1&&Object.values(item.inputs).every(input=>input.socketType==='VALUE'&&signal(input.value,'VALUE',depth+1))
  return false
 }
 if(!program.output||!signal(program.output,'RGBA'))return fail('supports only direct RGBA or Separate XYZ and alpha-one RGB presentation; scalar means/computed consumers remain unsupported')
 // Separate XYZ contributes the native rotate even though the terminal walk
 // validates that reference as a closed literal shape rather than recursing.
 if([...used].some(id=>program.ops.find(item=>item.id===id)?.kind==='separate-vector'))used.add(op.id)
 if(coordinates)used.add(coordinates.id);if(pass)used.add(pass.id)
 if(!used.has(op.id)||used.size!==program.ops.length)return fail('has unused or unqualified producers')
 const contract={op,coordinates,pass,center,columns};contracts.add(contract);return contract
}

export function validateVectorRotatePresentation(presentation:import('./sourceDisplay.js').SourcePresentation|undefined,postLdrCount:number,refuse:(reason:string)=>never,preHdrCount=0):void{
 const graph=presentation?.compositor
 if(!graph?.ops.some(op=>op.kind==='vector-rotate-cpu'||op.source?.nodeType==='ShaderNodeVectorRotate'))return
 const contract=validateVectorRotateProgram(graph)
 if(preHdrCount||postLdrCount)return refuse('Vector Rotate registered pre-HDR/post-LDR effects remain outside its closed scope')
 const display=presentation?.display?.ops??[]
 if(!Array.isArray(display)||display.filter(op=>op.type==='Lut1DTransform'||op.type==='Lut3DTransform').length+(contract?.coordinates?1:0)>8)return refuse('Vector Rotate combined row/display lookup budget is eight sampled textures')
}

/** Native half-center Float32 divide; small rational separation rules out double rounding. */
export function compositorRotateNormalizedRows(width:number,height:number):Float32Array{
 if(![width,height].every(n=>Number.isInteger(n)&&n>=4&&n<=8192))return fail('exact Normalized rows require physical extents [4,8192]')
 const stride=Math.max(width,height),data=new Float32Array(stride*2)
 for(let x=0;x<width;x++)data[x]=Math.fround((x+.5)/width)
 for(let y=0;y<height;y++)data[stride+y]=Math.fround((y+.5)/height)
 return data
}

export class CompositorVectorRotate {
 readonly op:SourceCompositorOperation;readonly coordinatesId?:string
 #table?:OwnedCompositorRowTable;#passId?:string;#center:TslEffectNode[];#columns:TslEffectNode[][]
 #zero=uniform(0,'uint');#epoch=new CompositorRendererEpoch('Vector Rotate');#drawing=new Vector2();#dead=false
 constructor(contract:Contract){
  if(!contracts.has(contract))fail('owned consumer plan must come from closed program validation')
  this.op=contract.op;this.coordinatesId=contract.coordinates?.id;this.#passId=contract.pass?.id
  this.#center=contract.center.map(n=>float(n));this.#columns=contract.columns.map(column=>column.map(n=>float(n)))
  if(this.coordinatesId)this.#table=new OwnedCompositorRowTable(2,compositorRotateNormalizedRows,{label:'Vector Rotate exact Normalized',name:'SceneToWeb private Vector Rotate Normalized rows'})
 }
 coordinateNode():TslEffectNode{
  if(this.#dead||!this.#table)return fail('exact Normalized table is unavailable/disposed')
  return vec2(this.#table.sample('X',0),this.#table.sample('Y',1))
 }
 build(vector:TslEffectNode):TslEffectNode{
  if(this.#dead)return fail('pipeline resources were disposed')
  const round=(value:TslEffectNode)=>bitcast(bitcast(value,'uint').bitOr(this.#zero),'float').toVar()
  return Fn((builder:TslEffectNode)=>{
   if(vector.getNodeType(builder)!=='vec3')return fail('actual Vector child must be native vec3, without scalar broadcasting')
   const delta=['x','y','z'].map((channel,lane)=>round(vector[channel].sub(this.#center[lane])))
   return vec3(...[0,1,2].map(lane=>{
    const products=this.#columns.map((column,index)=>round(column[lane]!.mul(delta[index])))
    return round(round(round(products[0]!.add(products[1])).add(products[2])).add(this.#center[lane]))
   }))
  })()
 }
 guard(node:TslEffectNode,resolved:ReadonlyMap<string,TslEffectNode>):TslEffectNode{
  const source=this.#passId?resolved.get(this.#passId):undefined
  if(this.#passId&&!source)return fail('actual Render Layers binding is missing')
  const pass=source?.isPassNode?source:source?.isPassTextureNode?source.passNode:undefined
  const image=source?.isPassNode?source.getTextureNode():source
  const nativeTexture=pass?.getTexture?.('output')
  const binding=()=>{
   if(!pass?.isPassNode||pass.getUpdateBeforeType?.()!=='frame'||!pass.scene?.isScene||!pass.camera?.isCamera||pass.getResolutionScale?.()!==1||!image?.isPassTextureNode||image.passNode!==pass||image.textureName!=='output'||image.previousTexture!==false||image.referenceNode!==null||image.value!==nativeTexture||pass.getTexture('output')!==nativeTexture||pass.getTextureNode('output')!==image||source?.isPassNode&&source!==pass||source?.isPassTextureNode&&source.passNode!==pass)return fail('requires its unchanged actual FRAME Render Layers PassNode and output texture binding')
  }
  if(this.#passId)binding()
  const validate=(frame:TslEffectNode,schedule:boolean)=>{
   if(this.#dead)return fail('pipeline resources were disposed')
   if(this.#zero.value!==0)return fail('private rounding uniform changed')
   if(frame.renderer?.xr?.isPresenting)return fail('XR/multiview targets remain outside the mono full-frame profile')
   this.#epoch.validate(frame.renderer)
   if(!this.#table)return
   binding()
   // Bounds/epoch/schema validation must precede any producer allocation.
   this.#table.validate(frame.renderer)
   if(schedule)updateCompositorPassProducers([pass],frame)
   binding()
   frame.renderer.getDrawingBufferSize(this.#drawing)
   if(image.value?.image?.width!==this.#drawing.x||image.value?.image?.height!==this.#drawing.y)return fail('actual Image/data/display extents must match the zero-offset physical frame, including DPR')
  }
  const guarded=node.toVar().onRenderUpdate((frame:TslEffectNode)=>validate(frame,false))
  if(this.#table){
   // Renderer.updateBefore runs before outer geometry/binding setup. A nested
   // PassNode render from onRenderUpdate runs too late and can replace that
   // geometry state; the late callback performs validation only.
   guarded.updateBeforeType='render'
   guarded.updateBefore=(frame:TslEffectNode)=>validate(frame,true)
  }
  return guarded
 }
 dispose():void{if(this.#dead)return;this.#dead=true;try{this.#table?.dispose()}finally{this.#epoch.clear()}}
}
