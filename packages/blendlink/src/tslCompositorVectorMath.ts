/* SPDX-License-Identifier: MIT */
/** Source-derived exact-word compositor literal slice, independent of EEVEE admission. */
import * as TSL from 'three/tsl'
import {resolveTextureLiteral} from './tslCompositorProceduralTexture.js'
import type {SourceCompositorOperation} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'
const {abs,ceil,float,floor,max,min,select,sign,vec3}=TSL as unknown as Record<string,(...args:any[])=>TslEffectNode>
export const compositorVectorMathModes=['ADD','SUBTRACT','MULTIPLY','MULTIPLY_ADD','DIVIDE','SCALE','CROSS_PRODUCT','DOT_PRODUCT','MINIMUM','MAXIMUM','ABSOLUTE','FLOOR','CEIL','FRACTION','ROUND','SIGN']
export const compositorVectorMathSimpleModes=['ADD','SUBTRACT','MULTIPLY','SCALE','MINIMUM','MAXIMUM','ABSOLUTE','FLOOR','CEIL','FRACTION','ROUND','SIGN']
const unary=new Set(['ABSOLUTE','FLOOR','CEIL','FRACTION','ROUND','SIGN'])
export const vectorMathInputNames=(mode:string):string[]=>['Vector',...(unary.has(mode)?[]:mode==='SCALE'?['Scale']:mode==='MULTIPLY_ADD'?['Vector_001','Vector_002']:['Vector_001'])]
const dyadic=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=16&&Number.isInteger(x*16)&&!Object.is(x,-0)
const normalWord=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=2**16&&(x===0||Math.abs(x)>=2**-32)&&Math.fround(x)===x&&!Object.is(x,-0)
export function vectorMathAdmitted(mode:string,values:Record<string,number|number[]>):boolean{
 const a=values.Vector as number[],b=values.Vector_001 as number[]
 if(!Object.values(values).flat().every(compositorVectorMathSimpleModes.includes(mode)?normalWord:dyadic))return false
 if(mode==='CEIL'&&a.some(x=>x<0&&x>-1))return false
 if(['MULTIPLY','MULTIPLY_ADD','DOT_PRODUCT','CROSS_PRODUCT','SCALE'].includes(mode)){
  const pairs=mode==='SCALE'?a.map(x=>[x,values.Scale as number]):mode==='CROSS_PRODUCT'?a.flatMap((x,i)=>b.flatMap((y,j)=>i===j?[]:[[x,y]])):a.map((x,i)=>[x,b[i]!])
  if(pairs.some(([x,y])=>Object.is(x!*y!,-0)))return false
 }
 if(mode==='DIVIDE')for(let i=0;i<3;i++){const x=a[i]!,y=b[i]!;if(y!==0&&(!Number.isInteger(Math.log2(Math.abs(y)))||Object.is(x/y,-0)))return false}
 return true
}
export function buildCompositorVectorMath(op:SourceCompositorOperation,operations:readonly SourceCompositorOperation[],input:(key:string)=>TslEffectNode,fail:(message:string)=>never):TslEffectNode{
 const p=op.properties,mode=String(p?.operation),version=p?.vector_math_version,scalar=mode==='DOT_PRODUCT'
 if(op.kind!=='vector-math'||op.source.nodeType!=='ShaderNodeVectorMath'||p?.vector_math_model!=='native-compositor-vector-math-literals-v1'
  ||p.vector_math_profile!=='darwin-arm64-53-vector-math-v1'||!Array.isArray(version)||version.length!==3||![5,3,0].every((n,i)=>version[i]===n)
  ||!['CPU','GPU'].includes(String(p.evaluation_device))||p.single_value_device!=='CPU'||p.evaluation_device==='GPU'&&p.native_gpu_backend!=='METAL'
  ||!compositorVectorMathModes.includes(mode)||op.type!==(scalar?'VALUE':'VECTOR')||op.source.output!==(scalar?'Value':'Vector'))return fail('Vector Math requires its measured source profile, active typed schema and qualified mode')
 const names=vectorMathInputNames(mode),values:Record<string,number|number[]>={}
 if(Object.keys(op.inputs).length!==names.length||!names.every(key=>Object.hasOwn(op.inputs,key)))return fail('Vector Math requires the active native input schema')
 for(const key of names){const kind=key==='Scale'?'VALUE':'VECTOR',incoming=op.inputs[key]
  if(incoming?.socketType!==kind)return fail('Vector Math requires typed input provenance')
  const value=resolveTextureLiteral(incoming.value,operations,op,kind)
  if(value===null||kind==='VECTOR'&&(!Array.isArray(value)||value.length!==3)||kind==='VALUE'&&typeof value!=='number')return fail('Vector Math requires bounded literal/Value/CombineXYZ/group input provenance; fields and computed expressions need separate proof')
  values[key]=value
 }
 if(!vectorMathAdmitted(mode,values))return fail('Vector Math needs bounded normal Float32 simple-mode inputs, sixteenth-grid compound inputs, safe signed zero, and power-of-two nonzero divisors')
 const a=input('Vector'),b=()=>input('Vector_001')
 switch(mode){
  case 'ADD':return a.add(b())
  case 'SUBTRACT':return a.sub(b())
  case 'MULTIPLY':return a.mul(b())
  case 'MULTIPLY_ADD':return a.mul(b()).add(input('Vector_002'))
  case 'DIVIDE':{const v=b(),divide=(x:TslEffectNode,y:TslEffectNode)=>select!(y.equal(0),float!(0),x.div(select!(y.equal(0),float!(1),y)));return vec3!(divide(a.x,v.x),divide(a.y,v.y),divide(a.z,v.z))}
  case 'SCALE':return a.mul(input('Scale'))
  case 'DOT_PRODUCT':{const v=b();return a.x.mul(v.x).add(a.y.mul(v.y)).add(a.z.mul(v.z))}
  case 'CROSS_PRODUCT':{const v=b();return vec3!(a.y.mul(v.z).sub(a.z.mul(v.y)),a.z.mul(v.x).sub(a.x.mul(v.z)),a.x.mul(v.y).sub(a.y.mul(v.x)))}
  case 'MINIMUM':return min!(a,b())
  case 'MAXIMUM':return max!(a,b())
  case 'ABSOLUTE':return abs!(a)
  case 'FLOOR':return floor!(a)
  case 'CEIL':return ceil!(a)
  case 'FRACTION':return a.sub(floor!(a))
  case 'ROUND':return floor!(a.add(.5))
  case 'SIGN':return sign!(a)
  default:return fail('Vector Math mode requires separate native precision qualification')
 }
}
