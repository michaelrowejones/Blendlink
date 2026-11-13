import {describe,expect,it} from 'vitest'
import {buildSourceCompositor} from './tslSourceCompositor.js'
import {compositorVectorMathModes,compositorVectorMathSimpleModes,vectorMathInputNames} from './tslCompositorVectorMath.js'
import type {SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
const constant=(type:string,value:any)=>({name:type,socketType:type,value:{kind:'constant' as const,type,value}})
const op=(mode='ADD'):SourceCompositorOperation=>({id:'math',kind:'vector-math',type:mode==='DOT_PRODUCT'?'VALUE':'VECTOR',source:{path:['Artist'],node:'Vector Math',nodeType:'ShaderNodeVectorMath',output:mode==='DOT_PRODUCT'?'Value':'Vector'},properties:{vector_math_model:'native-compositor-vector-math-literals-v1',vector_math_profile:'darwin-arm64-53-vector-math-v1',vector_math_version:[5,3,0],operation:mode,evaluation_device:'CPU',single_value_device:'CPU',native_gpu_backend:'METAL'},inputs:Object.fromEntries(vectorMathInputNames(mode).map(key=>[key,constant(key==='Scale'?'VALUE':'VECTOR',key==='Scale'?2:key==='Vector'?[.5,-1,.25]:[2,.5,4])]))})
const program=(operation:SourceCompositorOperation,prior:SourceCompositorOperation[]=[]):SourceCompositorProgram=>({version:1,status:'extracted',ops:[...prior,operation],passes:[],diagnostics:[],output:{kind:'convert',fromType:operation.type,type:'RGBA',input:{kind:'ref',node:operation.id,type:operation.type}}})
const build=(operation:SourceCompositorOperation,prior:SourceCompositorOperation[]=[])=>buildSourceCompositor(program(operation,prior),()=>null)
describe('exact-word compositor literal Vector Math',()=>{
 it('builds each admitted native mode through the public dispatcher',()=>{
  for(const mode of compositorVectorMathModes){const result=build(op(mode));expect(result.node.isNode).toBe(true);result.dispose();result.dispose()}
 })
 it('admits practical exact normal Float32 defaults while retaining compound arithmetic bounds',()=>{
  for(const mode of compositorVectorMathSimpleModes){const operation=op(mode);operation.inputs.Vector=constant('VECTOR',[Math.fround(.1),Math.fround(.8),Math.fround(1/3)]);build(operation).dispose()}
  for(const mode of ['MULTIPLY_ADD','CROSS_PRODUCT','DOT_PRODUCT','DIVIDE']){const operation=op(mode);operation.inputs.Vector=constant('VECTOR',[Math.fround(.1),1,2]);expect(()=>build(operation)).toThrow(/sixteenth-grid compound/)}
  const operation=op('MULTIPLY');operation.inputs.Vector=constant('VECTOR',[2**16,-(2**16),2**-32]);operation.inputs.Vector_001=constant('VECTOR',[2**16,2**-32,2**-32]);build(operation).dispose()
 })
 it('checks source identity, evaluator, schema and modes independently',()=>{
  for(const patch of [{vector_math_model:'unknown'},{vector_math_profile:'other'},{vector_math_version:[5,2,0]},{vector_math_version:[5,3,false]},{single_value_device:'GPU'},{evaluation_device:'unknown'},{evaluation_device:'GPU',native_gpu_backend:'OPENGL'},{operation:'NORMALIZE'}]){
   const operation=op();Object.assign(operation.properties,patch);expect(()=>build(operation)).toThrow(/Vector Math/)
  }
  for(const mutate of [(o:SourceCompositorOperation)=>o.source.nodeType='ShaderNodeMath',(o:SourceCompositorOperation)=>o.type='FLOAT_VECTOR2',(o:SourceCompositorOperation)=>delete o.inputs.Vector_001,(o:SourceCompositorOperation)=>o.inputs.extra=constant('VALUE',1)]){const operation=op();mutate(operation);expect(()=>build(operation)).toThrow(/Vector Math/)}
 })
 it('refuses off-grid, out-of-bounds, nonfinite, negative zero and unknown computed provenance',()=>{
  for(const a of [[.1,1,2],[2**17,1,2],[2**-33,1,2],[NaN,1,2],[Infinity,1,2],[-0,1,2],[.5,1]]){const operation=op();operation.inputs.Vector=constant('VECTOR',a);expect(()=>build(operation)).toThrow(/Vector Math/)}
  const operation=op();operation.inputs.Vector.value={kind:'ref',type:'VECTOR',node:'missing'};expect(()=>build(operation)).toThrow(/input provenance/)
 })
 it('rejects signed zero hazards and non-dyadic division without changing branch outputs',()=>{
  const multiply=op('MULTIPLY');multiply.inputs.Vector=constant('VECTOR',[0,1,1]);multiply.inputs.Vector_001=constant('VECTOR',[-1,1,1]);expect(()=>build(multiply)).toThrow(/safe signed zero/)
  const scale=op('SCALE');scale.inputs.Vector=constant('VECTOR',[1,-1,0]);scale.inputs.Scale=constant('VALUE',0);expect(()=>build(scale)).toThrow(/safe signed zero/)
  const ceil=op('CEIL');ceil.inputs.Vector=constant('VECTOR',[-.5,1,2]);expect(()=>build(ceil)).toThrow(/safe signed zero/)
  const divide=op('DIVIDE');divide.inputs.Vector_001=constant('VECTOR',[3,1,1]);expect(()=>build(divide)).toThrow(/power-of-two/)
  divide.inputs.Vector_001=constant('VECTOR',[0,1,1]);build(divide).dispose()
 })
 it('rederives prior literals and refuses forward/duplicate producer identities',()=>{
  const operation=op(),source:SourceCompositorOperation={id:'vector',kind:'value',type:'VECTOR',value:[.5,-1,.25],inputs:{},properties:{},source:{path:[],node:'Input',nodeType:'FunctionNodeInputVector',output:'Vector'}};operation.inputs.Vector.value={kind:'ref',node:'vector',type:'VECTOR'}
  build(operation,[source]).dispose();expect(()=>build(operation,[source,source])).toThrow();expect(()=>buildSourceCompositor({...program(operation),ops:[operation,source]},()=>null)).toThrow()
 })
})
