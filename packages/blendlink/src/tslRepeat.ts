/* SPDX-License-Identifier: MIT */
/** Bounded static Repeat control flow; no expression-tree unrolling or scene-time substitution. */
import * as TSL from 'three/tsl'
import type {TslIrExpression,TslExpression} from './tslNodeRecipe.js'
const {Fn,Loop,float,vec3}=TSL as unknown as Record<string,(...args:any[])=>any>
type State={type:'VALUE'|'VECTOR';initial:TslIrExpression;body:TslIrExpression}
let context:{states:TslExpression[];kinds:string[];iteration:TslExpression}|undefined
const object=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x)
function stateRef(x:Record<string,any>,states:State[]):boolean{return x.op==='repeat_state'&&Number.isInteger(x.index)&&x.index>=0&&x.index<states.length&&x.type===states[x.index]!.type}
function step(x:Record<string,any>):boolean{return ['const_float','const_vec3'].includes(x.op)||x.op==='typed_convert'&&x.fromType==='INT'&&['VALUE','VECTOR'].includes(x.toType)&&x.input?.op==='repeat_iteration'&&x.input.type==='INT'}
function bodyShape(x:Record<string,any>,states:State[],index:number):boolean{return stateRef(x,states)&&x.index===index||['math','vector_math'].includes(x.op)&&['ADD','SUBTRACT'].includes(x.operation)&&object(x.a)&&stateRef(x.a,states)&&x.a.index===index&&object(x.b)&&step(x.b)}
function inspect(root:unknown,states:State[],seed:boolean,fail:(reason:string)=>never):number{
 const pending=[{value:root,depth:0}],seen=new Set<object>();let count=0
 const allowed=new Set(seed?['const_float','const_vec3','combine']:['const_float','const_vec3','repeat_state','repeat_iteration','typed_convert','math','vector_math'])
 while(pending.length){const{value,depth}=pending.pop()!;if(!value||typeof value!=='object')continue
  if(depth>64||seen.has(value as object))return fail('Repeat has cyclic, shared or excessively deep serialized IR');seen.add(value as object)
  if(Array.isArray(value)){for(const item of value)pending.push({value:item,depth:depth+1});continue}
  const item=value as Record<string,any>
  if(typeof item.op==='string'){
   if(++count>256)return fail('Repeat exceeds bounded seed/body operation cost')
   if(!allowed.has(item.op))return fail(seed?'Repeat positive iterations require bounded literal seeds; UV fields including clamped SNAP have no qualified phase-margin producer contract':'Repeat operation/cost has no qualified bounded body contract')
   if(['const_float','const_vec3'].includes(item.op)){const values=item.op==='const_float'?[item.value]:item.value
    if(!Array.isArray(values)||values.length!==(item.op==='const_float'?1:3)||values.some(x=>typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>16||!Number.isInteger(x*16)||Object.is(x,-0)))return fail('Repeat constants need sixteenth-grid finite values within+/-16 without negative zero')}
   if(item.op==='repeat_state'&&!stateRef(item,states))return fail('Repeat state reference is outside its typed lexical zone')
   if(item.op==='repeat_iteration'&&item.type!=='INT')return fail('Repeat iteration reference must stay native INT')
   if(item.op==='typed_convert'&&!step(item))return fail('Repeat counter conversion has no qualified contract')
   if(['math','vector_math'].includes(item.op)&&!(seed?['MINIMUM','MAXIMUM','SNAP']:['ADD','SUBTRACT']).includes(item.operation))return fail('Repeat recurrence currently supports add/sub accumulation and permutation only')
  }
  for(const child of Object.values(item))pending.push({value:child,depth:depth+1})
 }
 return count
}
function seedShape(x:Record<string,any>):boolean{
 if(['const_float','const_vec3'].includes(x.op))return true
 if(x.op==='combine')return ['x','y','z'].every(k=>object(x[k])&&seedShape(x[k]))
 return false
}
function expressionType(x:Record<string,any>,states:State[],seed:boolean,fail:(reason:string)=>never):string{
 if(x.op==='const_float')return 'VALUE'
 if(x.op==='separate'){if(!object(x.input)||!['x','y','z'].includes(x.channel)||expressionType(x.input,states,seed,fail)!=='VECTOR')return fail('Repeat component read needs a vector and valid axis');return 'VALUE'}
 if(x.op==='combine'){if(!['x','y','z'].every(k=>object(x[k])&&expressionType(x[k],states,seed,fail)==='VALUE'))return fail('Repeat Combine needs scalar components');return 'VECTOR'}
 if(['const_vec3','uv','uv_active','combine'].includes(x.op))return 'VECTOR'
 if(x.op==='repeat_state'&&stateRef(x,states))return x.type
 if(x.op==='repeat_iteration')return 'INT'
 if(x.op==='typed_convert'&&step(x))return x.toType
 if(['math','vector_math'].includes(x.op)){
  const type=x.op==='math'?'VALUE':'VECTOR'
  if(!object(x.a)||!object(x.b)||expressionType(x.a,states,seed,fail)!==type||expressionType(x.b,states,seed,fail)!==type)return fail('Repeat arithmetic input state widths/types disagree')
  return type
 }
 return fail('Repeat expression has no qualified state type')
}
export function validateStaticRepeat(x:TslIrExpression,fail:(reason:string)=>never):State[]{
 if(Object.keys(x).some(k=>!['op','model','sourceProfile','sourceVersion','sourceBuild','iterations','output','states'].includes(k)))return fail('Repeat descriptor has unknown source schema fields')
 if(x.model!=='eevee-static-repeat-53-v1'||x.sourceProfile!=='darwin-arm64-eevee-metal-repeat-53-v1'||JSON.stringify(x.sourceVersion)!=='[5,3,0]'||x.sourceBuild!=='02f0899d78e3'||!Number.isInteger(x.iterations)||Number(x.iterations)<1||Number(x.iterations)>64||!Array.isArray(x.states)||x.states.length<1||x.states.length>4||!Number.isInteger(x.output)||Number(x.output)<0||Number(x.output)>=x.states.length)return fail('Repeat requires its qualified source schema and fixed iteration/state limits')
 const states=x.states as State[];let cost=0
 for(const[index,state]of states.entries()){if(!object(state)||!['VALUE','VECTOR'].includes(state.type)||!object(state.initial)||!object(state.body)||!bodyShape(state.body,states,index))return fail('Repeat requires own-state copy/add/sub; cross-state aliases and constant overwrites need separate native semantics')
  inspect(state.initial,states,true,fail)
  if(!seedShape(state.initial))return fail('Repeat positive iterations require bounded literal seeds; UV fields including clamped SNAP have no qualified phase-margin producer contract')
  cost+=inspect(state.body,states,false,fail)
  if(expressionType(state.initial,states,true,fail)!==state.type||expressionType(state.body,states,false,fail)!==state.type)return fail('Repeat state seed/update type disagrees with its native item')
 }
 if(cost*Number(x.iterations)>8192)return fail('Repeat exceeds8192 iteration-weighted operations')
 return states
}
export function staticRepeatCost(x:TslIrExpression,fail:(reason:string)=>never):number{const states=validateStaticRepeat(x,fail);return Number(x.iterations)*states.reduce((sum,state)=>sum+inspect(state.body,states,false,fail),0)}
export function buildStaticRepeat(x:TslIrExpression,build:(x:TslIrExpression)=>TslExpression,fail:(reason:string)=>never,signal?:AbortSignal):TslExpression{
 const cancelled=()=>{if(signal?.aborted)return fail('Repeat build was cancelled before bounded shader work')}
 cancelled()
 const snapshot=structuredClone(x),states=validateStaticRepeat(snapshot,fail),iterations=Number(snapshot.iterations),output=Number(snapshot.output),initial=states.map(state=>build(state.initial))
 return Fn!(()=>{
  const values=initial.map((node,index)=>(states[index]!.type==='VALUE'?float!(node):vec3!(node)).toVar())
  Loop!(iterations,({i}:{i:TslExpression})=>{
   const previous=context;context={states:values,kinds:states.map(s=>s.type),iteration:i}
   try{
    // Stage all next values before assigning ANY state. Sequential updates corrupt swaps.
    const next=states.map(state=>build(state.body).toVar())
    for(let index=0;index<values.length;index++)values[index]!.assign(next[index])
   }finally{context=previous}
  })
  return values[output]
 })()
}
export function buildRepeatReference(x:TslIrExpression,fail:(reason:string)=>never):TslExpression{
 if(!context)return fail('Repeat reference is outside its lexical body')
 if(x.op==='repeat_iteration'&&x.type==='INT')return context.iteration
 if(x.op==='repeat_state'&&Number.isInteger(x.index)&&Number(x.index)>=0&&Number(x.index)<context.states.length&&x.type===context.kinds[Number(x.index)])return context.states[Number(x.index)]!
 return fail('Repeat state/counter reference is outside its typed lexical body')
}
