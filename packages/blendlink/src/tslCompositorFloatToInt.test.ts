import {describe,expect,it} from 'vitest'
import {buildCompositorFloatToInt,literalFloatToIntNumber} from './tslCompositorFloatToInt.js'
import {buildSourceCompositor} from './tslSourceCompositor.js'
import type {CompositorValue,SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'

const constant=(value:number):CompositorValue=>({kind:'constant',type:'VALUE',value})
const operation=(value:CompositorValue=constant(.5),mode='ROUND'):SourceCompositorOperation=>({
 id:'round',kind:'float-to-int',type:'INT',source:{path:['Artist'],node:'Float to Integer',nodeType:'FunctionNodeFloatToInt',output:'Integer'},
 properties:{float_to_int_model:'native-mf-f32-int24-v1',float_to_int_input_model:'literal-f32-normal-or-zero-v1',float_to_int_source_profile:'darwin-arm64-mf-v1',float_to_int_native_version:[5,3,0],rounding_mode:mode,evaluation_device:'CPU',single_value_device:'CPU'},
 inputs:{Float:{name:'Float',socketType:'VALUE',value}},
})
const build=(op:SourceCompositorOperation,ops:SourceCompositorOperation[]=[op])=>buildCompositorFloatToInt(op,ops,message=>{throw new Error(message)})
const program=(ops:SourceCompositorOperation[]):SourceCompositorProgram=>({version:1,status:'extracted',ops,passes:[],diagnostics:[],output:{kind:'convert',fromType:'INT',type:'RGBA',input:{kind:'ref',node:ops.at(-1)!.id,type:'INT'}}} as SourceCompositorProgram)

describe('fresh native MF Float to Integer literal domain',()=>{
 it('uses the production dispatcher for every mode, signed zero, half neighbors and normal boundaries',()=>{
  for(const mode of ['ROUND','FLOOR','CEILING','TRUNCATE'])for(const value of [-(2**24),-.5-2**-24,-.5,-.5+2**-25,-0,0,.5-2**-25,.5,.5+2**-24,2**-126,-(2**-126),2**24]){
   const op=operation(constant(value),mode)
   expect(literalFloatToIntNumber(value)).toBe(true);expect(build(op).isNode).toBe(true)
   const built=buildSourceCompositor(program([op]),new Map());expect(built.node.isNode).toBe(true);built.dispose();built.dispose()
  }
 })
 it('independently resolves only already emitted scalar Value/group constants',()=>{
  const value:SourceCompositorOperation={id:'value',kind:'value',type:'VALUE',value:-1.5,source:{path:['Artist','Group'],node:'Value',nodeType:'ShaderNodeValue',output:'Value'},properties:{},inputs:{}}
  const op=operation({kind:'ref',node:value.id,type:'VALUE'})
  expect(build(op,[value,op]).isNode).toBe(true)
  expect(()=>build(op,[op,value])).toThrow(/literal\/group constants/)
  expect(()=>build(op,[value,{...value},op])).toThrow(/literal\/group constants/)
  expect(()=>build(op,[{...value,type:'VECTOR',value:[.5,.5,.5]},op])).toThrow(/literal\/group constants/)
  expect(()=>build(op,[{...value,source:{...value.source,nodeType:'CompositorNodeImage'}},op])).toThrow(/literal\/group constants/)
  expect(()=>build(op,[{...value,source:{...value.source,output:'Alpha'}},op])).toThrow(/literal\/group constants/)
 })
 it('rejects forged schema, source versions/profiles/evaluators and modes',()=>{
  for(const patch of [{float_to_int_model:'unknown'},{float_to_int_input_model:'asserted-range'},{float_to_int_source_profile:'unmeasured'},
   {float_to_int_native_version:[5,2,0]},{float_to_int_native_version:[5,3,false]},{float_to_int_native_version:[5,3]},
   {single_value_device:'GPU'},{evaluation_device:'UNKNOWN'},{rounding_mode:'TRUNC'}]){
   const op=operation();Object.assign(op.properties,patch);expect(()=>build(op)).toThrow(/verified Blender 5.3/)
  }
  const sparse=operation();sparse.properties.float_to_int_native_version=[5,3,,];expect(()=>build(sparse)).toThrow(/verified Blender 5.3/)
  for(const patch of [{type:'VALUE'},{kind:'integer-math'},{source:{path:[],node:'Wrong',nodeType:'ShaderNodeMath',output:'Value'}},
   {inputs:{}},{inputs:{Float:{name:'Float',socketType:'RGBA',value:constant(.5)}}}])
   expect(()=>build({...operation(),...patch})).toThrow(/verified Blender 5.3/)
 })
 it('refuses subnormals, nonfinite/F64/overflow values and implicit color/vector conversion',()=>{
  for(const value of [2**-149,-(2**-149),2**24+2,-(2**24)-2,Infinity,-Infinity,NaN,.1])
   expect(()=>build(operation(constant(value)))).toThrow(/normal or zero/)
  for(const fromType of ['RGBA','VECTOR','INT','BOOLEAN']){
   const op=operation({kind:'convert',fromType,type:'VALUE',input:{kind:'constant',type:fromType,value:[.5,.5,.5,1]}})
   expect(()=>build(op)).toThrow(/implicit color\/vector conversions/)
  }
 })
 it('does not inspect image payloads or grant input proof from range annotations',()=>{
  const image={id:'image',kind:'image-input',type:'VALUE',source:{path:[],node:'Image',nodeType:'CompositorNodeImage',output:'Alpha'},inputs:{},properties:new Proxy({}, {get(){throw new Error('Unqualified image pixels were inspected')}})} as SourceCompositorOperation
  const op=operation({kind:'ref',node:'image',type:'VALUE'});op.properties.asserted_range=[0,1]
  expect(()=>build(op,[image,op])).toThrow(/fields, images/)
 })
 it('bounds input conversion depth and operation work before node allocation',()=>{
  let value=constant(.5)
  for(let index=0;index<9;index++)value={kind:'convert',type:'VALUE',fromType:'VALUE',input:value}
  expect(()=>build(operation(value))).toThrow(/literal\/group constants/)
  const op=operation();expect(()=>build(op,Array.from({length:2049},()=>op))).toThrow(/literal\/group constants/)
  const cycle={kind:'convert',type:'VALUE',fromType:'VALUE'} as CompositorValue;cycle.input=cycle
  expect(()=>build(operation(cycle))).toThrow(/literal\/group constants/)
 })
})
