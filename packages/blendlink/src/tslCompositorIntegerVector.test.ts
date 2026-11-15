/* SPDX-License-Identifier: MIT */
import {describe,expect,it} from 'vitest'
import {vec4} from 'three/tsl'
import {buildSourceCompositor} from './tslSourceCompositor.js'
import {buildCompositorInt3Presentation,buildCompositorIntegerVector} from './tslCompositorIntegerVector.js'
import type {CompositorValue,SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
const operation=(v=[-2147483648,2147483647,16777217]):SourceCompositorOperation=>({id:'n0',kind:'integer-vector',type:'INT_VECTOR3',value:v,
 source:{path:['Compositor'],node:'Integer Vector',nodeType:'FunctionNodeInputIntVector',output:'Vector'},inputs:{},
 properties:{evaluation_device:'CPU',native_gpu_backend:'METAL',single_value_device:'CPU',integer_vector_model:'native-int3-constant-53-v1',integer_vector_profile:'darwin-arm64-53-int3-cpu-v1',integer_vector_version:[5,3,0],integer_vector_build:'02f0899d78e3',integer_vector_dimensions:3,integer_vector_precision:'CPU_INT32',integer_vector_presentation:'component-rne-f32-alpha-one-v1'}})
const ref:CompositorValue={kind:'ref',node:'n0',type:'INT_VECTOR3'}
const edge=(type='RGBA'):CompositorValue=>({kind:'convert',type,fromType:'INT_VECTOR3',input:{...ref}})
const program=(op=operation(),output=edge()):SourceCompositorProgram=>({version:1,status:'extracted',ops:[op],passes:[],diagnostics:[],output})
const build=(p:SourceCompositorProgram)=>buildSourceCompositor(p,()=>vec4(0))
const fail=(message:string):never=>{throw Error(message)}
describe('static native compositor Integer Vector3',()=>{
 it('keeps a signed integer3 constructor distinct from both float3 and int2',()=>{
  const op=operation(),node=buildCompositorIntegerVector(op,fail)
  expect((node.isVarNode?node.node:node).nodeType).toBe('ivec3');expect(op.value).toEqual([-2147483648,2147483647,16777217]);expect(op.type).toBe('INT_VECTOR3')
 })
 it('rounds signed Int32 component presentations once on the host including ties to even',()=>{
  for(const [raw,wanted]of [
   [[-2147483648,2147483647,16777217],[-2147483648,2147483648,16777216]],
   [[16777219,-16777217,-16777219],[16777220,-16777216,-16777220]],
   [[0,-1,1],[0,-1,1]]
  ]){
   const node=buildCompositorInt3Presentation(edge(),[operation(raw)],fail)
   const literal=(node.isVarNode?node.node:node).value
   expect(literal.toArray()).toEqual([...wanted,1]);expect(Object.is(literal.x,-0)).toBe(false)
  }
 })
 it('builds terminal RGBA and explicit float3 presentation through the public dispatcher without resources',()=>{
  for(const output of [edge(),{kind:'convert',type:'RGBA',fromType:'VECTOR',input:edge('VECTOR')}as CompositorValue]){
   const built=build(program(operation(),output));expect(built.node.isNode).toBe(true);built.dispose();built.dispose()
  }
 })
 it('refuses scalar, Boolean, integer and other-width conversions instead of applying old means',()=>{
  for(const type of ['VALUE','INT','BOOLEAN','INT_VECTOR2','FLOAT_VECTOR2','VECTOR2','INT_VECTOR'])expect(()=>build(program(operation(),{kind:'convert',type:'RGBA',fromType:type,input:edge(type)}))).toThrow(/Integer Vector/)
 })
 it('refuses all unproved consumers and disconnected operations at admission',()=>{
  for(const kind of ['math','exposure','combine-vector','render-pass','image-info','value']){
   const p=program();p.ops.push({id:'extra',kind,type:'VALUE',value:1,inputs:{},properties:{},source:{path:['Compositor'],node:'Extra',nodeType:'ShaderNodeValue',output:'Value'}})
   expect(()=>build(p)).toThrow(/Integer Vector.*terminal/)
  }
  const p=program();p.output={kind:'constant',type:'RGBA',value:[1,1,1,1]};expect(()=>build(p)).toThrow(/Integer Vector.*terminal/)
 })
 it('refuses foreign reference identities, mislabeled widths and missing/extra typed edge fields',()=>{
  for(const mutate of [(p:SourceCompositorProgram)=>{p.output!.input!.node='foreign'},(p:SourceCompositorProgram)=>{p.output!.input!.type='INT_VECTOR2'},(p:SourceCompositorProgram)=>{(p.output!.input! as any).value=3},(p:SourceCompositorProgram)=>{p.output!.fromType='VECTOR'}]){
   const p=program();mutate(p);expect(()=>build(p)).toThrow(/Integer Vector/)
  }
 })
 it('rejects forged schema/profile and non-int32 values before constructing shader nodes',()=>{
  for(const mutate of [(o:SourceCompositorOperation)=>{o.value=[0,0,2147483648]},(o:SourceCompositorOperation)=>{o.value=[0,-0,1]},(o:SourceCompositorOperation)=>{o.value=[1,2]},(o:SourceCompositorOperation)=>{o.value=[true,0,1]},(o:SourceCompositorOperation)=>{o.value=[NaN,1,2]},(o:SourceCompositorOperation)=>{o.properties.evaluation_device='GPU'},(o:SourceCompositorOperation)=>{o.properties.integer_vector_dimensions=2},(o:SourceCompositorOperation)=>{o.properties.integer_vector_version=[5,2,0]},(o:SourceCompositorOperation)=>{o.properties.unproved=true},(o:SourceCompositorOperation)=>{o.source.output='Color'},(o:SourceCompositorOperation)=>{o.inputs.Value={name:'Value',socketType:'INT',value:{kind:'constant',type:'INT',value:1}}}]){
   const op=operation();mutate(op);expect(()=>build(program(op))).toThrow(/Integer Vector/)
  }
 })
 it('preserves legacy VECTOR3 scalar means for unrelated existing serialized programs',()=>{
  const op:SourceCompositorOperation={id:'v',kind:'value',type:'VECTOR',value:[3,6,9],source:{path:[],node:'Vector',nodeType:'FunctionNodeInputVector',output:'Vector'},properties:{},inputs:{}}
  const p:SourceCompositorProgram={version:1,status:'extracted',ops:[op],passes:[],diagnostics:[],output:{kind:'convert',fromType:'VALUE',type:'RGBA',input:{kind:'convert',fromType:'VECTOR',type:'VALUE',input:{kind:'ref',node:'v',type:'VECTOR'}}}}
  const built=build(p);expect(built.node.isNode).toBe(true);built.dispose()
 })
 it('rejects nonintegral, infinite, sparse and extra-property component arrays',()=>{
  const sparse=new Array(3);sparse[0]=1;sparse[2]=2
  const extra=[1,2,3];(extra as any).unproved=4
  for(const value of [[1.5,0,0],[Infinity,1,2],sparse,extra]){const op=operation();op.value=value;expect(()=>build(program(op))).toThrow(/Integer Vector/)}
 })
})
