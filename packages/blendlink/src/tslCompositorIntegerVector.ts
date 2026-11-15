/* SPDX-License-Identifier: MIT */
import * as TSL from 'three/tsl'
import type {CompositorValue,SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'
const {ivec3,vec3,vec4}=TSL as unknown as Record<string,(...args:any[])=>TslEffectNode>
const MODEL='native-int3-constant-53-v1',PROFILE='darwin-arm64-53-int3-cpu-v1'
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isInteger(v)&&!Object.is(v,-0)&&v>=-2147483648&&v<=2147483647
const exactKeys=(v:object,keys:string[])=>Object.keys(v).sort().join()===keys.slice().sort().join()
function values(op:SourceCompositorOperation,fail:(message:string)=>never):number[]{
 const p=op.properties,source=op.source;
 if(op.kind!=='integer-vector'||op.type!=='INT_VECTOR3'||!record(p)||!record(op.inputs)||Object.keys(op.inputs).length
  ||!Array.isArray(op.value)||op.value.length!==3||Object.keys(op.value).join()!=='0,1,2'||!op.value.every(integer)
  ||!record(source)||!exactKeys(source,['path','node','nodeType','output'])||source.nodeType!=='FunctionNodeInputIntVector'||source.output!=='Vector'
  ||typeof source.node!=='string'||!source.node||!Array.isArray(source.path)||source.path.length<1||source.path.length>17||!Array.from(source.path).every(s=>typeof s==='string'&&s.length>0)
  ||!exactKeys(p,['evaluation_device','native_gpu_backend','single_value_device','integer_vector_model','integer_vector_profile','integer_vector_version','integer_vector_build','integer_vector_dimensions','integer_vector_precision','integer_vector_presentation'])
  ||p.evaluation_device!=='CPU'||p.single_value_device!=='CPU'||typeof p.native_gpu_backend!=='string'
  ||p.integer_vector_model!==MODEL||p.integer_vector_profile!==PROFILE||JSON.stringify(p.integer_vector_version)!=='[5,3,0]'
  ||p.integer_vector_build!=='02f0899d78e3'||p.integer_vector_dimensions!==3||p.integer_vector_precision!=='CPU_INT32'
  ||p.integer_vector_presentation!=='component-rne-f32-alpha-one-v1')
  return fail('Integer Vector requires its static native signed-int3 constructor and pinned Blender 5.3 CPU source schema')
 return op.value
}
const ref=(value:CompositorValue|undefined,op:SourceCompositorOperation)=>!!value&&record(value)&&exactKeys(value,['kind','node','type'])&&value.kind==='ref'&&value.type==='INT_VECTOR3'&&value.node===op.id
export function validateIntegerVectorGraph(program:SourceCompositorProgram,fail:(message:string)=>never):void{
 const family=program.ops.filter(op=>op.kind==='integer-vector'||op.type==='INT_VECTOR3')
 if(!family.length)return
 const op=family[0]!;values(op,fail)
 const out=program.output,v=out?.input
 const direct=out?.kind==='convert'&&out.fromType==='INT_VECTOR3'&&out.type==='RGBA'&&ref(v,op)
 const vector=out?.kind==='convert'&&out.fromType==='VECTOR'&&out.type==='RGBA'&&v?.kind==='convert'&&v.fromType==='INT_VECTOR3'&&v.type==='VECTOR'&&ref(v.input,op)
 if(program.ops.length!==1||program.passes.length||!out||!exactKeys(out,['kind','fromType','type','input'])||!direct&&!vector
  ||vector&&!exactKeys(v!,['kind','fromType','type','input']))
  fail('Integer Vector first scope requires one terminal constructor with direct RGBA or explicit float3-to-RGBA presentation; consumers and additional operations remain unqualified')
}
export function buildCompositorIntegerVector(op:SourceCompositorOperation,fail:(message:string)=>never):TslEffectNode{
 return ivec3(...values(op,fail))
}
export function buildCompositorInt3Presentation(value:CompositorValue,ops:readonly SourceCompositorOperation[],fail:(message:string)=>never):TslEffectNode{
 const op=ops.length===1?ops[0]:undefined
 if(!op||value.kind!=='convert'||value.fromType!=='INT_VECTOR3'||!['VECTOR','RGBA'].includes(value.type)||!ref(value.input,op)
  ||!exactKeys(value,['kind','fromType','type','input']))return fail('Integer Vector permits only explicit native int3-to-float3/RGBA presentation')
 // All signed int32 values are exact in JS binary64. Math.fround performs the
 // source component cast once on the host; no backend dynamic int→float cast
 // or loss of int3 identity is introduced into the serialized program.
 const components=values(op,fail).map(Math.fround)
 return value.type==='RGBA'?vec4(...components,1):vec3(...components)
}
