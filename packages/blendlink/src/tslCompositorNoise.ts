/* SPDX-License-Identifier: MIT */
/** Bounded default2D CPU compositor candidate. Numerical qualification is
 * separate from the existing EEVEE/Cycles/shader-MF source profiles. */
import {vec4} from 'three/tsl'
import {compositorCpuDefaultNoise2d,type TslExpression} from './tslNodeRecipe.js'
import {isCompositorExactAxes,type CompositorExactAxes} from './tslCompositorExactAxes.js'
import type {SourceCompositorOperation} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'

export const COMPOSITOR_NOISE_MODEL='native-compositor-noise2d-default-fbm-cpu-53-v1'
export const COMPOSITOR_NOISE_PROFILE='darwin-arm64-53-noise2d-default-fbm-cpu-v1'
export const COMPOSITOR_NOISE_COORDINATES='exact-uniform-r32f-axes-v1'
export const COMPOSITOR_NOISE_KERNEL='staged-bli-fade-perlin-fbm-noise2d-v3'
export const COMPOSITOR_NOISE_DEFAULTS=Object.freeze({Scale:5,Detail:2,Roughness:.5,Lacunarity:2,Distortion:0})
const propertyNames=new Set(['noise_model','noise_profile','noise_kernel','noise_coordinate_model','noise_version','noise_build','noise_evaluator','noise_reference_model','noise_export_extent','noise_precision','noise_requested_precision','noise_fixed_sources','noise_type','noise_normalize','noise_dimensions'])
export const noiseFieldKind=(op:SourceCompositorOperation):boolean=>op.properties?.noise_model===COMPOSITOR_NOISE_MODEL

export function validateCompositorNoise(op:SourceCompositorOperation,fail:(message:string)=>never):void{
 const closed=(value:object,keys:string[]):boolean=>Object.keys(value).sort().join('|')===keys.sort().join('|')
 const p=op?.properties,source=op?.source,inputs=op?.inputs
 if(!p||typeof p!=='object'||Array.isArray(p)||!source||!Array.isArray(source.path)||!source.path.every(n=>typeof n==='string')
  ||typeof source.node!=='string'||!inputs||typeof inputs!=='object'||Array.isArray(inputs))return fail('Noise requires complete native source/properties/input metadata')
 if(!closed(source,['path','node','nodeType','output']))return fail('Noise requires a closed native source record')
 if(Object.keys(p).some(key=>key.startsWith('noise_')&&!propertyNames.has(key)))return fail('Noise requires known closed source-model properties')
 const members=p.noise_fixed_sources
 if(!Array.isArray(members)||members.length<1||members.length>64||!members.every(member=>member&&typeof member==='object'&&!Array.isArray(member)&&Object.keys(member).sort().join('|')==='node|nodeType|tree'&&['node','nodeType','tree'].every(key=>typeof member[key]==='string')))return fail('Noise requires its bounded raw-copy source provenance')
 const color=source.output==='Color',extent=p.noise_export_extent
 if(op.kind!=='noise-texture'||source.nodeType!=='ShaderNodeTexNoise'||!['Fac','Color'].includes(source.output)||op.type!==(color?'RGBA':'VALUE')
  ||p.noise_model!==COMPOSITOR_NOISE_MODEL||p.noise_profile!==COMPOSITOR_NOISE_PROFILE||p.noise_kernel!==COMPOSITOR_NOISE_KERNEL
  ||JSON.stringify(p.noise_version)!=='[5,3,0]'||p.noise_build!=='02f0899d78e3'||p.noise_evaluator!=='CPU-MF'
  ||p.evaluation_device!=='CPU'||p.single_value_device!=='CPU'||p.noise_dimensions!==2||p.noise_type!=='FBM'||p.noise_normalize!==true
  ||p.noise_coordinate_model!==COMPOSITOR_NOISE_COORDINATES||p.noise_reference_model!=='full-frame-context-zero-offset-v1'
  ||p.noise_precision!=='CPU_FLOAT32'||!['AUTO','FULL'].includes(String(p.noise_requested_precision))
  ||!Array.isArray(extent)||extent.length!==2||!extent.every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=4&&n<=8192))
  return fail('Noise requires its pinned Blender5.3 CPU default2D normalized FBM and exact Uniform full-frame source profile')
 const names=Object.keys(COMPOSITOR_NOISE_DEFAULTS)
 if(Object.keys(inputs).length!==names.length)return fail('Noise requires only the five original static default controls; linked coordinates and control fields refuse')
 for(const name of names){
  const input=inputs[name],value=input?.value,wanted=COMPOSITOR_NOISE_DEFAULTS[name as keyof typeof COMPOSITOR_NOISE_DEFAULTS]
  if(!input||!closed(input,['name','socketType','value'])||input.name!==name||input.socketType!=='VALUE'||!value||!closed(value,['kind','type','value'])||value.kind!=='constant'||value.type!=='VALUE'||typeof value.value!=='number'||!Object.is(value.value,wanted))
   return fail('Noise requires exact original positive-zero/normal Float32 defaults: Scale5, Detail2, Roughness.5, Lacunarity2, Distortion+0')
 }
}
export function buildCompositorNoise(op:SourceCompositorOperation,fail:(message:string)=>never,axes:CompositorExactAxes):TslEffectNode{
 validateCompositorNoise(op,fail)
 if(!isCompositorExactAxes(axes))return fail('Noise requires a genuine owned shared Uniform-axis binding')
 const color=op.source.output==='Color',result=compositorCpuDefaultNoise2d(axes.node as unknown as TslExpression,color)
 return (color?vec4(result as unknown as TslEffectNode,1):result) as unknown as TslEffectNode
}

/** Bound source/code cost separately from sampler count. Fac uses three
 * Perlin calls; Color uses nine. This initial family permits at most eighteen. */
export const COMPOSITOR_NOISE_OCTAVE_BUDGET=18
const noiseProperties=new Set([...propertyNames].filter(key=>key!=='noise_dimensions'))
/** Exact proof shapes only. A pointwise whitelist cannot bound amplification
 * of an approximate field. This runs once before texture/renderer allocation. */
function provenNoiseTopology(program:import('./sourceDisplay.js').SourceCompositorProgram):boolean{
 const ops=program.ops,byId=new Map(ops.map(op=>[op.id,op])),used=new Set<string>()
 const keys=(value:any,names:string[]):boolean=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...names].sort().join('|')
 const refuse=():never=>{throw Error('unproven Noise composition')}
 const ref=(value:any,type:string):SourceCompositorOperation=>{
  if(!keys(value,['kind','node','type'])||value.kind!=='ref'||value.type!==type)refuse()
  const op=byId.get(value.node);if(!op||op.type!==type)return refuse();used.add(op.id);return op
 }
 const input=(op:SourceCompositorOperation,name:string,type:string):any=>{
  const item=op.inputs[name]
  if(!keys(item,['name','socketType','value'])||item.name!==(name==='Value_001'?'Value':name)||item.socketType!==type)return refuse()
  return item.value
 }
 const linked=(op:SourceCompositorOperation,name:string,type:string)=>ref(input(op,name,type),type)
 const constant=(op:SourceCompositorOperation,name:string,value:number):void=>{
  const v=input(op,name,'VALUE');if(!keys(v,['kind','type','value'])||v.kind!=='constant'||v.type!=='VALUE'||!Object.is(v.value,value))refuse()
 }
 const source=(op:SourceCompositorOperation,kind:string,nodeType:string,output:string):void=>{
  const s=op.source
  if(!keys(s,['path','node','nodeType','output'])||!Array.isArray(s.path)||!s.path.every(v=>typeof v==='string')||typeof s.node!=='string'||s.node.length===0||op.kind!==kind||s.nodeType!==nodeType||s.output!==output)refuse()
 }
 const physical=(op:SourceCompositorOperation):string=>JSON.stringify([op.source.path,op.source.node])
 const leaf=(op:SourceCompositorOperation,output:'Fac'|'Color'):SourceCompositorOperation=>{
  source(op,'noise-texture','ShaderNodeTexNoise',output);if(op.type!==(output==='Fac'?'VALUE':'RGBA'))refuse();return op
 }
 try{
  const output=program.output
  if(output?.kind==='convert'){
   if(!keys(output,['kind','fromType','type','input'])||output.fromType!=='VALUE'||output.type!=='RGBA')return false
   leaf(ref(output.input,'VALUE'),'Fac');return ops.length===1
  }
  const root=ref(output,'RGBA')
  if(root.kind==='noise-texture'){leaf(root,'Color');return ops.length===1}
  source(root,'combine-color','CompositorNodeCombineColor','Image')
  if(root.properties.mode!=='RGB'||!keys(root.inputs,['Red','Green','Blue','Alpha']))return false
  let alphaExtra=0
  const alpha=input(root,'Alpha','VALUE')
  if(alpha.kind==='ref'){
   const literal=ref(alpha,'VALUE'),s=literal.source
   if(literal.kind!=='value'||!Object.is(literal.value,1)||!keys(literal.inputs,[])||!keys(s,['path','node','nodeType','output'])||!Array.isArray(s.path)||!s.path.every(v=>typeof v==='string')||![s.node,s.nodeType,s.output].every(v=>typeof v==='string'&&v.length>0))return false
   alphaExtra=1
  }else constant(root,'Alpha',1)
  const separate=(name:string,channel:string):SourceCompositorOperation=>{
   const op=linked(root,name,'VALUE');source(op,'separate-color','CompositorNodeSeparateColor',channel)
   if(op.properties.mode!=='RGB'||!keys(op.inputs,['Image']))return refuse()
   return leaf(linked(op,'Image','RGBA'),'Color')
  }
  const red=linked(root,'Red','VALUE')
  if(red.kind==='noise-texture'){
   const fac=leaf(red,'Fac'),green=separate('Green','Green'),blue=separate('Blue','Blue')
   return ops.length===5+alphaExtra&&used.size===ops.length&&green.id===blue.id&&physical(fac)===physical(green)
  }
  if(red.kind==='separate-color'){
   const a=separate('Red','Red'),green=separate('Green','Green'),blue=separate('Blue','Blue')
   return ops.length===6+alphaExtra&&used.size===ops.length&&green.id===blue.id&&a.id!==green.id&&physical(a)!==physical(green)
  }
  const leaves:SourceCompositorOperation[]=[]
  for(const name of ['Red','Green','Blue']){
   const half=linked(root,name,'VALUE');source(half,'math','ShaderNodeMath','Value')
   if(half.properties.operation!=='MULTIPLY'||half.properties.use_clamp!==false||!keys(half.inputs,['Value','Value_001']))return false
   constant(half,'Value_001',.5)
   const add=linked(half,'Value','VALUE');source(add,'math','ShaderNodeMath','Value')
   if(add.properties.operation!=='ADD'||add.properties.use_clamp!==false||!keys(add.inputs,['Value','Value_001']))return false
   for(const channel of ['Value','Value_001'])leaves.push(leaf(linked(add,channel,'VALUE'),'Fac'))
  }
  return ops.length===13+alphaExtra&&used.size===ops.length&&new Set(leaves.map(op=>op.id)).size===6&&new Set(leaves.map(physical)).size===6
 }catch{return false}
}

export function validateNoiseFieldGraph(program:import('./sourceDisplay.js').SourceCompositorProgram,fail:(message:string)=>never):void{
 if(!Array.isArray(program.ops)||program.ops.length>2048)return fail('Noise requires a bounded operation list')
 let cost=0
 for(const op of program.ops){
  if(op.kind==='noise-texture'){validateCompositorNoise(op,fail);cost+=op.source.output==='Color'?9:3}
  else if(op.properties&&Object.keys(op.properties).some(key=>noiseProperties.has(key)))return fail('Noise model metadata requires the actual native Noise source kind')
 }
 if(cost===0)return
 const ids=new Set<string>();for(const op of program.ops){if(typeof op.id!=='string'||op.id.length===0||ids.has(op.id))return fail('Noise requires unique nonempty source operation identities');ids.add(op.id)}
 if(!Array.isArray(program.passes)||program.passes.length!==0||program.images&&Object.keys(program.images).length!==0)return fail('Noise requires no declared scene-pass/image inputs')
 if(cost>COMPOSITOR_NOISE_OCTAVE_BUDGET)return fail('Noise exceeds its eighteen-Perlin-call source/code budget')
 if(!provenNoiseTopology(program))return fail('Noise requires proven pointwise topology only: direct/group forwarding, shared Fac/Color RGB, two-Color RGB or six-Fac pair means; all operations must contribute with exact typed edges. Other consumers/amplification remain unqualified')
}
export function validateNoisePresentation(presentation:import('./sourceDisplay.js').SourcePresentation|undefined,postLdrCount:number,fail:(message:string)=>never,preHdrCount=0):void{
 const program=presentation?.compositor;if(!program)return
 validateNoiseFieldGraph(program,fail)
 if(!program.ops.some(noiseFieldKind))return
 const ops=presentation?.display?.ops??[]
 if(!Array.isArray(ops)||1+ops.filter(op=>op.type==='Lut1DTransform'||op.type==='Lut3DTransform').length>8)return fail('Noise axis/display sampler budget is eight')
 if(postLdrCount!==0||preHdrCount!==0)return fail('Noise requires no registered pre-HDR/post-LDR effects without independent sampler accounting')
}
