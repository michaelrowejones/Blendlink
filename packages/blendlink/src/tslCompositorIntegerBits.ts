/* SPDX-License-Identifier: MIT */
/** Exact int32 compositor contracts. Hash kernels reuse the attributed Jenkins family. */
import * as TSL from 'three/tsl'
import { compositorHashUint1, compositorHashUint2 } from './tslNodeRecipe.js'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
type Node = any
const {Fn,If,int,uint}=TSL as unknown as Record<string,(...args:Node[])=>Node>
const MODEL='native-compositor-integer-bits-v1',PROFILE='darwin-arm64-compositor-integer-bits-v1'
const MODES:Record<string,string[]>={AND:['A','B'],OR:['A','B'],XOR:['A','B'],NOT:['A'],SHIFT:['A','Shift'],ROTATE:['A','Shift']}
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&!Object.is(value,-0)&&value>=-2147483648&&value<=2147483647
export function integerBitsLiteralTree(ref:unknown,ops:readonly SourceCompositorOperation[],current:SourceCompositorOperation):boolean{
 if(ops.length>2048)return false
 const prefix=new Map<string,SourceCompositorOperation>();let found=false,budget=64
 for(const op of ops){if(op===current){found=!prefix.has(op.id);break}if(prefix.has(op.id))return false;prefix.set(op.id,op)}
 if(!found)return false
 const visit=(v:any,depth=0):boolean=>{
  if(--budget<0||depth>8||!v||v.type!=='INT')return false
  if(v.kind==='constant')return integer(v.value)
  const source=v.kind==='ref'?prefix.get(v.node):undefined
  if(!source)return false
  if(source.kind==='utility-constant'&&source.type==='INT'&&source.source.nodeType==='FunctionNodeInputInt'&&source.source.output==='Integer'&&Object.keys(source.inputs).length===0)return integer(source.value)
  if(['bit-math','hash-value'].includes(source.kind)&&source.properties.integer_bits_model===MODEL)return Object.values(source.inputs).every(input=>visit(input.value,depth+1))
  return false
 }
 return visit(ref)
}
const kernel=(name:string,count:number,callback:(args:Node[])=>Node)=>Fn!(callback).setLayout({name:'scenetowebIntegerBits'+name+'V1',type:'int',inputs:Array.from({length:count},(_,i)=>({name:'arg'+i,type:'int'}))})
const kernels:Record<string,Node>={
 AND:kernel('And',2,([a,b])=>a.bitAnd(b)),OR:kernel('Or',2,([a,b])=>a.bitOr(b)),XOR:kernel('Xor',2,([a,b])=>a.bitXor(b)),NOT:kernel('Not',1,([a])=>a.bitNot()),
 SHIFT:kernel('Shift',2,([a,amount])=>{
  const result=int!(0).toVar(),bits=uint!(a)
  If!(amount.greaterThanEqual(int!(-31)).and(amount.lessThanEqual(int!(31))),()=>{
   If!(amount.greaterThanEqual(int!(0)),()=>{result.assign(int!(bits.shiftLeft(uint!(amount))))})
   .Else(()=>{result.assign(int!(bits.shiftRight(uint!(amount.negate()))))})
  })
  return result
 }),
 ROTATE:kernel('Rotate',2,([a,amount])=>{
  const shift=amount.mod(int!(32)).toVar(),bits=uint!(a),result=a.toVar()
  If!(shift.lessThan(int!(0)),()=>{shift.addAssign(int!(32))})
  If!(shift.notEqual(int!(0)),()=>{result.assign(int!(bits.shiftLeft(uint!(shift)).bitOr(bits.shiftRight(uint!(int!(32).sub(shift))))))})
  return result
 }),
 HASH:kernel('Hash',2,([a,seed])=>int!(compositorHashUint2(compositorHashUint1(uint!(a)),uint!(seed)))),
}
export function buildCompositorIntegerBits(op:SourceCompositorOperation,ops:readonly SourceCompositorOperation[],input:(name:string)=>TslEffectNode,fail:(message:string)=>never):TslEffectNode{
 const p=op.properties,v=p.integer_bits_version,hash=op.kind==='hash-value',mode=hash?'HASH':String(p.operation),names=hash?['Value','Seed']:MODES[mode]
 if(!['bit-math','hash-value'].includes(op.kind)||p.integer_bits_model!==MODEL||p.integer_bits_profile!==PROFILE
  ||!Array.isArray(v)||v.length!==3||![5,3,0].every((n,i)=>Object.hasOwn(v,i)&&v[i]===n)
  ||!['CPU','GPU'].includes(String(p.evaluation_device))||p.single_value_device!=='CPU'
  ||op.source.nodeType!==(hash?'FunctionNodeHashValue':'FunctionNodeBitMath')||op.source.output!==(hash?'Hash':'Value')||op.type!=='INT'
  ||(hash&&p.data_type!=='INT')||!names||Object.keys(op.inputs).length!==names.length
  ||!names.every(name=>op.inputs[name]?.socketType==='INT'&&integerBitsLiteralTree(op.inputs[name]?.value,ops,op)))
  return fail('Integer Bits requires its measured Blender 5.3 native schema and typed int32 literal/InputInt/group or qualified Integer Bits chain inputs; implicit conversions/fields are unqualified')
 return kernels[mode]!(...names.map(input))
}
