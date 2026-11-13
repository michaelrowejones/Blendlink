import {describe,expect,it} from 'vitest'
import {buildCompositorIntegerBits,integerBitsLiteralTree} from './tslCompositorIntegerBits.js'
import {buildSourceCompositor} from './tslSourceCompositor.js'
import type {SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
const input=(n:number)=>({name:'Integer',socketType:'INT',value:{kind:'constant' as const,type:'INT',value:n}})
const op=(mode='AND'):SourceCompositorOperation=>({id:'bits',kind:mode==='HASH'?'hash-value':'bit-math',type:'INT',source:{path:['Artist'],node:'Integer',nodeType:mode==='HASH'?'FunctionNodeHashValue':'FunctionNodeBitMath',output:mode==='HASH'?'Hash':'Value'},properties:{operation:mode,data_type:'INT',integer_bits_model:'native-compositor-integer-bits-v1',integer_bits_profile:'darwin-arm64-compositor-integer-bits-v1',integer_bits_version:[5,3,0],evaluation_device:'CPU',single_value_device:'CPU'},inputs:mode==='HASH'?{Value:input(-2147483648),Seed:input(2147483647)}:{A:input(-2147483648),...(mode==='NOT'?{}:mode==='SHIFT'||mode==='ROTATE'?{Shift:input(-2147483648)}:{B:input(2147483647)})}})
const build=(current:SourceCompositorOperation,ops=[current])=>buildCompositorIntegerBits(current,ops,()=>({})as never,m=>{throw Error(m)})
describe('measured compositor int32 family admission',()=>{
 it('dispatches all6BitMath modes and INT Hash without Float32 narrowing',()=>{
  for(const mode of ['AND','OR','XOR','NOT','SHIFT','ROTATE','HASH']){
   const current=op(mode),program:SourceCompositorProgram={version:1,status:'extracted',ops:[current],passes:[],diagnostics:[],output:{kind:'convert',fromType:'INT',type:'RGBA',input:{kind:'ref',node:current.id,type:'INT'}}}
   const built=buildSourceCompositor(program,()=>null);expect(built.node.isNode).toBe(true);built.dispose();built.dispose()
  }
 })
 it('requires measured profiles, source stages and schemas',()=>{
  for(const patch of [{integer_bits_model:'unknown'},{integer_bits_profile:'unknown'},{integer_bits_version:[5,2,0]},{single_value_device:'GPU'},{evaluation_device:'unknown'},{operation:'UNKNOWN'}]){const current=op();Object.assign(current.properties,patch);expect(()=>build(current)).toThrow(/Integer Bits/)}
  const current=op('HASH');current.properties.data_type='FLOAT';expect(()=>build(current)).toThrow(/Integer Bits/)
 })
 it('refuses implicit conversions, fields, nonint words and integer negativezero',()=>{
  for(const bad of [-2147483649,2147483648,.5,NaN,Infinity,-0]){const current=op();current.inputs.A=input(bad);expect(()=>build(current)).toThrow(/Integer Bits/)}
  const current=op();current.inputs.A.value={kind:'convert',fromType:'VALUE',type:'INT',input:{kind:'constant',type:'VALUE',value:1}};expect(()=>build(current)).toThrow(/Integer Bits/)
  current.inputs.A.value={kind:'ref',type:'INT',node:'field'};expect(()=>build(current)).toThrow(/Integer Bits/)
 })
 it('limits provenance to earlier typed InputInt/qualified familychains with bounded work',()=>{
  const current=op(),first=op('HASH');first.id='prior';current.inputs.A.value={kind:'ref',node:'prior',type:'INT'}
  expect(integerBitsLiteralTree(current.inputs.A.value,[first,current],current)).toBe(true)
  expect(integerBitsLiteralTree(current.inputs.A.value,[current,first],current)).toBe(false)
  expect(integerBitsLiteralTree(current.inputs.A.value,[first,first,current],current)).toBe(false)
  expect(integerBitsLiteralTree(current.inputs.A.value,Array.from({length:2049},()=>first),current)).toBe(false)
  first.inputs.Value.value={kind:'ref',node:'prior',type:'INT'};expect(integerBitsLiteralTree(current.inputs.A.value,[first,current],current)).toBe(false)
 })
})
