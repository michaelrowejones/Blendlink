import {describe,expect,it} from 'vitest'
import {buildCompositorProceduralTexture,resolveTextureLiteral} from './tslCompositorProceduralTexture.js'
import {buildSourceCompositor} from './tslSourceCompositor.js'
import type {CompositorValue,SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
const constant=(type:string,value:unknown):CompositorValue=>({kind:'constant',type,value})
const input=(type:string,value:unknown)=>({name:type,socketType:type,value:constant(type,value)})
const operation=(checker=false):SourceCompositorOperation=>({id:'texture',kind:checker?'checker-texture':'gradient-texture',type:'RGBA',source:{path:['Artist'],node:'Texture',nodeType:checker?'ShaderNodeTexChecker':'ShaderNodeTexGradient',output:'Color'},properties:{procedural_texture_model:'native-compositor-texture-v1',procedural_texture_profile:'darwin-arm64-compositor-texture-v1',procedural_texture_version:[5,3,0],texture_mapping_model:'identity-v1',gradient_type:'LINEAR',evaluation_device:'CPU',single_value_device:'CPU'},inputs:{Vector:input('VECTOR',[.5,-.25,.125]),...(checker?{Scale:input('VALUE',5),Color1:input('RGBA',[-.25,1.5,.125,-.5]),Color2:input('RGBA',[2,-.125,.75,1.5])}:{})}})
const build=(op:SourceCompositorOperation,ops=[op])=>buildCompositorProceduralTexture(op,ops,()=>({x:{},y:{}} as never),message=>{throw Error(message)})
const program=(ops:SourceCompositorOperation[]):SourceCompositorProgram=>({version:1,status:'extracted',ops,passes:[],diagnostics:[],output:{kind:'ref',node:ops.at(-1)!.id,type:ops.at(-1)!.type}})

describe('native compositor texture family admission',()=>{
 it('runs all admitted Gradient modes and Checker outputs through production dispatch',()=>{
  for(const mode of ['LINEAR','QUADRATIC','DIAGONAL','EASING'])for(const output of ['Fac','Color']){
   const op=operation();op.properties.gradient_type=mode;op.source.output=output;op.type=output==='Fac'?'VALUE':'RGBA'
   const document=program([op]);if(output==='Fac')document.output={kind:'convert',fromType:'VALUE',type:'RGBA',input:document.output}
   const built=buildSourceCompositor(document,()=>null);expect(built.node.isNode).toBe(true);built.dispose();built.dispose()
  }
  for(const output of ['Fac','Color']){
   const op=operation(true);op.source.output=output;op.type=output==='Fac'?'VALUE':'RGBA'
   if(output==='Fac'){delete op.inputs.Color1;delete op.inputs.Color2}
   const document=program([op]);if(output==='Fac')document.output={kind:'convert',fromType:'VALUE',type:'RGBA',input:document.output}
   const built=buildSourceCompositor(document,()=>null);expect(built.node.isNode).toBe(true);built.dispose()
  }
 })
 it('rejects models, versions, source classes, output types, stages and mapping forgeries before shader allocation',()=>{
  for(const patch of [{procedural_texture_model:'unknown'},{procedural_texture_profile:'other'},{procedural_texture_version:[5,2,0]},
   {procedural_texture_version:[5,3,false]},{texture_mapping_model:'custom'},{single_value_device:'GPU'},{evaluation_device:'unknown'}]){
   const op=operation();Object.assign(op.properties,patch);expect(()=>build(op)).toThrow(/Procedural Texture/)
  }
  const op=operation();op.source.nodeType='ShaderNodeTexNoise';expect(()=>build(op)).toThrow(/Procedural Texture/)
 })
 it('refuses unqualified nonlinear fields and modes instead of inferring shader semantics',()=>{
  for(const mode of ['RADIAL','SPHERICAL','QUADRATIC_SPHERE','UNKNOWN']){const op=operation();op.properties.gradient_type=mode;expect(()=>build(op)).toThrow(/no qualified kernel/)}
  for(const mode of ['LINEAR','QUADRATIC','DIAGONAL','EASING']){const op=operation();op.properties.gradient_type=mode;op.inputs.Vector.value={kind:'ref',type:'VECTOR',node:'missing'};expect(()=>build(op)).toThrow(/bounded literal/)}
  const op=operation();op.properties.gradient_type='EASING';op.inputs.Vector.value=constant('VECTOR',[Math.fround(.1),0,0]);expect(()=>build(op)).toThrow(/sixteenth-grid/)
 })
 it('requires explicit Checker coordinate/scale/color provenance and prunes unused colors for Fac',()=>{
  for(const coord of [[.1,0,0],[32,0,0],[Infinity,0,0],[-0,0,0]]){const op=operation(true);op.inputs.Vector.value=constant('VECTOR',coord);expect(()=>build(op)).toThrow(/Checker requires/)}
  for(const scale of [-1,5.5,257]){const op=operation(true);op.inputs.Scale.value=constant('VALUE',scale);expect(()=>build(op)).toThrow(/Checker requires/)}
  const op=operation(true);op.inputs.Color1.value=constant('RGBA',[.1,.25,.5,1]);expect(()=>build(op)).toThrow(/Color inputs/)
 })
 it('resolves only prior typed literal producers with bounded work',()=>{
  const op=operation(),producer:SourceCompositorOperation={id:'vector',kind:'value',type:'VECTOR',value:[.5,-.25,.125],inputs:{},properties:{},source:{path:[],node:'Vector',nodeType:'FunctionNodeInputVector',output:'Vector'}}
  op.inputs.Vector.value={kind:'ref',node:'vector',type:'VECTOR'}
  expect(resolveTextureLiteral(op.inputs.Vector.value,[producer,op],op,'VECTOR')).toEqual([.5,-.25,.125])
  expect(resolveTextureLiteral(op.inputs.Vector.value,[op,producer],op,'VECTOR')).toBeNull()
  expect(resolveTextureLiteral(op.inputs.Vector.value,[producer,{...producer},op],op,'VECTOR')).toBeNull()
  expect(resolveTextureLiteral(op.inputs.Vector.value,[{...producer,source:{...producer.source,nodeType:'CompositorNodeRGB'}},op],op,'VECTOR')).toBeNull()
  expect(resolveTextureLiteral(op.inputs.Vector.value,Array.from({length:2049},()=>producer),op,'VECTOR')).toBeNull()
 })
})
